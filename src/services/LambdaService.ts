import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AwsLambdaConfig, PahcerConfig, TestStep } from './ConfigService';
import type { Workspace } from '../schemas/workspace';
import { PathHelper } from '../infrastructure/PathHelper';
import type { SeedResult } from './ResultProcessor';

interface LambdaInvokePayload {
  binary_base64: string;
  seeds: number[];
  contest_id: string;
  test_steps: TestStep[];
  score_regex: string;
  tool_names: string[];
  execution_id: string;
}

interface LambdaResponse {
  scores: Record<string, number | { error: string }>;
  vcpus: number;
  workers: number;
}

export class LambdaService {
  private getClientOptions(config: AwsLambdaConfig): {
    region: string;
    credentials?: AwsCredentialIdentityProvider;
  } {
    const options: { region: string; credentials?: AwsCredentialIdentityProvider } = {
      region: config.region,
    };
    if (config.profile) {
      options.credentials = fromIni({ profile: config.profile });
    }
    // profile 未指定時はデフォルトクレデンシャルチェーン
    return options;
  }

  private getLambdaClient(config: AwsLambdaConfig): LambdaClient {
    return new LambdaClient(this.getClientOptions(config));
  }

  private getS3Client(config: AwsLambdaConfig): S3Client {
    return new S3Client(this.getClientOptions(config));
  }

  async deployTools(
    pahcerConfig: PahcerConfig,
    workspace: Workspace,
  ): Promise<{ uploaded: string[] }> {
    const lambdaConfig = pahcerConfig.aws_lambda;
    if (!lambdaConfig) {
      throw new Error('[aws_lambda] section not found in pahcer_config.toml');
    }

    const contestId = pahcerConfig.problem?.problem_name;
    if (!contestId) {
      throw new Error('problem_name not found in pahcer_config.toml');
    }

    const toolsDir = path.join(workspace.targetDirectory, 'tools');
    const releaseDir = path.join(toolsDir, 'target', 'release');
    const srcBinDir = path.join(toolsDir, 'src', 'bin');

    // Detect available tool binaries
    const toolNames: string[] = [];
    try {
      const files = await fs.readdir(srcBinDir);
      for (const file of files) {
        if (file.endsWith('.rs')) {
          const name = file.slice(0, -3);
          const binaryPath = path.join(releaseDir, name);
          try {
            await fs.access(binaryPath);
            toolNames.push(name);
          } catch {
            // Binary not built, skip
          }
        }
      }
    } catch {
      throw new Error(`Tools source directory not found: ${srcBinDir}`);
    }

    if (toolNames.length === 0) {
      throw new Error(
        `No built tool binaries found in ${releaseDir}. Run 'cargo build --release' first.`,
      );
    }

    const s3 = this.getS3Client(lambdaConfig);

    for (const name of toolNames) {
      const binaryPath = path.join(releaseDir, name);
      const body = await fs.readFile(binaryPath);
      await s3.send(
        new PutObjectCommand({
          Bucket: lambdaConfig.tools_bucket,
          Key: `${contestId}/${name}`,
          Body: body,
        }),
      );
    }

    return { uploaded: toolNames };
  }

  async execute(
    pahcerConfig: PahcerConfig,
    workspace: Workspace,
    executionId: string,
    binaryPath: string,
    seeds: number[],
    onProgress: (results: SeedResult[]) => void,
    abortSignal?: AbortSignal,
  ): Promise<SeedResult[]> {
    const lambdaConfig = pahcerConfig.aws_lambda;
    if (!lambdaConfig) {
      throw new Error('[aws_lambda] section not found in pahcer_config.toml');
    }

    const contestId = pahcerConfig.problem?.problem_name;
    if (!contestId) {
      throw new Error('problem_name not found in pahcer_config.toml');
    }

    const testSteps = pahcerConfig.test?.test_steps || [];
    const scoreRegex =
      pahcerConfig.problem?.score_regex || '(?m)^\\s*Score\\s*=\\s*(?P<score>\\d+)\\s*$';

    // Detect tool names
    const toolNames = await this.detectToolNames(workspace);

    // Read and encode binary
    const MAX_BINARY_SIZE = 4.5 * 1024 * 1024; // 4.5MB (base64 → ~6MB payload limit)
    const binaryData = await fs.readFile(binaryPath);
    if (binaryData.length > MAX_BINARY_SIZE) {
      throw new Error(
        `Binary too large: ${(binaryData.length / 1024 / 1024).toFixed(1)}MB (limit: 4.5MB). Use release build with strip.`,
      );
    }
    const binaryBase64 = binaryData.toString('base64');

    // Split seeds into chunks
    const parallel = lambdaConfig.parallel || 10;
    const chunks = this.splitSeeds(seeds, parallel);

    const client = this.getLambdaClient(lambdaConfig);

    // Build base payload
    const basePayload: Omit<LambdaInvokePayload, 'seeds'> = {
      binary_base64: binaryBase64,
      contest_id: contestId,
      test_steps: testSteps,
      score_regex: scoreRegex,
      tool_names: toolNames,
      execution_id: executionId,
    };

    // Invoke all chunks in parallel
    const allResults: SeedResult[] = [];
    const promises = chunks.map(async (chunk) => {
      if (abortSignal?.aborted) return;

      const payload: LambdaInvokePayload = { ...basePayload, seeds: chunk };
      const command = new InvokeCommand({
        FunctionName: lambdaConfig.function_name,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload)),
      });

      const response = await client.send(command);

      // Check for Lambda platform-level errors (timeout, OOM, etc.)
      if (response.FunctionError) {
        const errorBody = Buffer.from(response.Payload || '').toString('utf-8');
        let errorMsg = `Lambda error (${response.FunctionError})`;
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed.errorMessage || errorMsg;
        } catch {
          // raw error string
          if (errorBody) errorMsg = errorBody;
        }
        const errorResults: SeedResult[] = chunk.map((seed) => ({
          seed,
          score: null,
          executionTime: 0,
          error: errorMsg,
        }));
        allResults.push(...errorResults);
        onProgress(errorResults);
        return;
      }

      let result: Record<string, unknown>;
      try {
        const resultStr = Buffer.from(response.Payload || '').toString('utf-8');
        result = JSON.parse(resultStr) as Record<string, unknown>;
      } catch {
        const errorResults: SeedResult[] = chunk.map((seed) => ({
          seed,
          score: null,
          executionTime: 0,
          error: 'Failed to parse Lambda response',
        }));
        allResults.push(...errorResults);
        onProgress(errorResults);
        return;
      }

      if (result.errorMessage) {
        const errorResults: SeedResult[] = chunk.map((seed) => ({
          seed,
          score: null,
          executionTime: 0,
          error: result.errorMessage as string,
        }));
        allResults.push(...errorResults);
        onProgress(errorResults);
        return;
      }

      const scores = (result.scores || {}) as Record<string, unknown>;
      const chunkResults: SeedResult[] = chunk.map((seed) => {
        const val = scores[String(seed)] as Record<string, unknown> | undefined;
        if (!val || typeof val !== 'object') {
          return { seed, score: null, executionTime: 0, error: 'No result returned' };
        }
        if ('error' in val && !('score' in val)) {
          return { seed, score: null, executionTime: 0, error: String(val.error) };
        }
        const score = typeof val.score === 'number' ? val.score : null;
        const execTime = typeof val.execution_time === 'number' ? val.execution_time : 0;
        return { seed, score, executionTime: execTime };
      });

      allResults.push(...chunkResults);
      onProgress(chunkResults);
    });

    await Promise.all(promises);

    // Sort by seed
    allResults.sort((a, b) => a.seed - b.seed);
    return allResults;
  }

  /**
   * S3 から各 seed の stdout をダウンロードして case_outputs/ に保存
   */
  async downloadCaseOutputs(
    pahcerConfig: PahcerConfig,
    workspace: Workspace,
    executionId: string,
    seeds: number[],
  ): Promise<void> {
    const lambdaConfig = pahcerConfig.aws_lambda;
    if (!lambdaConfig) return;

    const contestId = pahcerConfig.problem?.problem_name;
    if (!contestId) return;

    const s3 = this.getS3Client(lambdaConfig);
    const caseOutputsDir = PathHelper.getCaseOutputsDirectory(
      workspace.targetDirectory,
      executionId,
    );
    await fs.mkdir(caseOutputsDir, { recursive: true });

    // Batch downloads to avoid S3 throttling (50 concurrent)
    const CONCURRENCY = 50;
    for (let i = 0; i < seeds.length; i += CONCURRENCY) {
      const batch = seeds.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (seed) => {
          try {
            const key = `results/${contestId}/${executionId}/${String(seed).padStart(4, '0')}.json`;
            const response = await s3.send(
              new GetObjectCommand({
                Bucket: lambdaConfig.tools_bucket,
                Key: key,
              }),
            );
            const body = await response.Body?.transformToString();
            if (body) {
              const data = JSON.parse(body);
              // output = solution's stdout (file redirected), stdout = all stdout including vis
              const content = data.output || data.stdout;
              if (content) {
                const outputPath = path.join(
                  caseOutputsDir,
                  `${String(seed).padStart(4, '0')}.txt`,
                );
                await fs.writeFile(outputPath, content);
              }
            }
          } catch {
            // S3 object not found or parse error — skip
          }
        }),
      );
    }
  }

  private async detectToolNames(workspace: Workspace): Promise<string[]> {
    const srcBinDir = path.join(workspace.targetDirectory, 'tools', 'src', 'bin');
    const toolNames: string[] = [];
    try {
      const files = await fs.readdir(srcBinDir);
      for (const file of files) {
        if (file.endsWith('.rs')) {
          toolNames.push(file.slice(0, -3));
        }
      }
    } catch {
      // No tools directory
    }
    return toolNames;
  }

  private splitSeeds(seeds: number[], nChunks: number): number[][] {
    const chunks: number[][] = [];
    const chunkSize = Math.floor(seeds.length / nChunks);
    const remainder = seeds.length % nChunks;
    let idx = 0;
    for (let i = 0; i < nChunks; i++) {
      const size = chunkSize + (i < remainder ? 1 : 0);
      if (size > 0) {
        chunks.push(seeds.slice(idx, idx + size));
        idx += size;
      }
    }
    return chunks;
  }
}
