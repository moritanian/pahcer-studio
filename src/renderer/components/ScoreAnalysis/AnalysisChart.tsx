import type React from 'react';
import { useState, useDeferredValue, useEffect } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import GraphSettings from './graph/GraphSettings';
import ScoreGraph from './graph/ScoreGraph';
import type { TestExecution } from '../../../schemas/execution';
import type { AnalysisResponse } from '../../../schemas/analysis';

interface AnalysisChartProps {
  workspaceId: string;
  analysisResult: AnalysisResponse | null;
  executions: TestExecution[];
  selectedExecutionIds: string[];
}

interface GraphSettingsState {
  xAxis: string;
  inputFilter: string;
  sortByScore: boolean;
  useLogScale: boolean;
  useRelativeScore: boolean;
}

const DEFAULT_SETTINGS: GraphSettingsState = {
  xAxis: 'seed',
  inputFilter: '',
  sortByScore: false,
  useLogScale: false,
  useRelativeScore: false,
};

const loadSettings = (workspaceId: string): GraphSettingsState => {
  try {
    const raw = localStorage.getItem(`scoreAnalysis.graphSettings.${workspaceId}`);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
};

const AnalysisChart: React.FC<AnalysisChartProps> = ({
  workspaceId,
  analysisResult,
  executions,
  selectedExecutionIds,
}) => {
  // 初期値は localStorage から復元
  const [initial] = useState(() => loadSettings(workspaceId));
  const [xAxis, setXAxis] = useState(initial.xAxis);
  const [inputFilter, setInputFilter] = useState(initial.inputFilter);
  const [sortByScore, setSortByScore] = useState(initial.sortByScore);
  const [useLogScale, setUseLogScale] = useState(initial.useLogScale);
  const [useRelativeScore, setUseRelativeScore] = useState(initial.useRelativeScore);

  // 設定変更時に localStorage へ保存
  useEffect(() => {
    const settings: GraphSettingsState = {
      xAxis,
      inputFilter,
      sortByScore,
      useLogScale,
      useRelativeScore,
    };
    try {
      localStorage.setItem(`scoreAnalysis.graphSettings.${workspaceId}`, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [workspaceId, xAxis, inputFilter, sortByScore, useLogScale, useRelativeScore]);

  // グラフ描画用の遅延値（入力中の再レンダリングを防止）
  const deferredXAxis = useDeferredValue(xAxis);
  const deferredInputFilter = useDeferredValue(inputFilter);

  return (
    <Paper
      sx={{
        p: 2,
        mb: 3,
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '600px',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          mb: 2,
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6">分析結果</Typography>
        <GraphSettings
          xAxis={xAxis}
          inputFilter={inputFilter}
          sortByScore={sortByScore}
          onXAxisChange={setXAxis}
          onInputFilterChange={setInputFilter}
          onToggleSortByScore={setSortByScore}
          useLogScale={useLogScale}
          onToggleLogScale={setUseLogScale}
          useRelativeScore={useRelativeScore}
          onToggleRelativeScore={setUseRelativeScore}
        />
      </Box>

      {/* グラフの描画 */}
      <Box
        sx={{
          width: '100%',
          overflow: 'visible',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ScoreGraph
          analysisResult={analysisResult}
          executions={executions}
          selectedExecutionIds={selectedExecutionIds}
          inputFilter={deferredInputFilter}
          sortByScore={sortByScore}
          useRelativeScore={useRelativeScore}
          useLogScale={useLogScale}
          xAxis={deferredXAxis}
        />
      </Box>
    </Paper>
  );
};

export default AnalysisChart;
