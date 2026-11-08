import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../ConfigService';
import type { Workspace } from '../../schemas/workspace';

describe('ConfigService.createTempConfigForTest', () => {
  let dir: string;
  let workspace: Workspace;
  const service = new ConfigService();

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-service-'));
    workspace = { id: 'ws', targetDirectory: dir, useWsl: false } as Workspace;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the stdout template and seed range of the setting file', async () => {
    const settingFile = path.join(dir, 'custom.toml');
    await fs.writeFile(
      settingFile,
      [
        '[test]',
        'start_seed = 100',
        'end_seed = 200',
        'out_dir = "./pahcer"',
        '[[test.test_steps]]',
        'program = "./a.out"',
        'stdin = "./tools/in/{SEED04}.txt"',
        'stdout = "./analysis/out/{SEED04}.txt"',
        '[[test.test_steps]]',
        'program = "./vis"',
      ].join('\n'),
    );

    const result = await service.createTempConfigForTest(null, null, workspace, settingFile);

    expect(result?.outDir).toBe('./pahcer');
    expect(result?.caseOutput).toEqual({
      stdoutTemplate: './analysis/out/{SEED04}.txt',
      startSeed: 100,
      endSeed: 200,
    });
  });

  it('applies the requested seed range', async () => {
    await fs.writeFile(
      path.join(dir, 'pahcer_config.toml'),
      [
        '[test]',
        'start_seed = 0',
        'end_seed = 100',
        '[[test.test_steps]]',
        'program = "./a.out"',
        'stdout = "./tools/out/{SEED04}.txt"',
      ].join('\n'),
    );

    const result = await service.createTempConfigForTest(10, 300, workspace);

    expect(result?.caseOutput).toEqual({
      stdoutTemplate: './tools/out/{SEED04}.txt',
      startSeed: 300,
      endSeed: 310,
    });
  });

  it('returns null caseOutput when no step writes per-seed stdout', async () => {
    await fs.writeFile(
      path.join(dir, 'pahcer_config.toml'),
      ['[test]', '[[test.test_steps]]', 'program = "./a.out"'].join('\n'),
    );

    const result = await service.createTempConfigForTest(null, null, workspace);

    expect(result?.caseOutput).toBeNull();
  });
});
