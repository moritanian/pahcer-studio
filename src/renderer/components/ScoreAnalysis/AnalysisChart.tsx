import type React from 'react';
import { useState, useDeferredValue } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import GraphSettings from './graph/GraphSettings';
import ScoreGraph from './graph/ScoreGraph';
import type { TestExecution } from '../../../schemas/execution';
import type { AnalysisResponse } from '../../../schemas/analysis';

interface AnalysisChartProps {
  analysisResult: AnalysisResponse | null;
  executions: TestExecution[];
  selectedExecutionIds: string[];
}

const AnalysisChart: React.FC<AnalysisChartProps> = ({
  analysisResult,
  executions,
  selectedExecutionIds,
}) => {
  // UI入力用の状態（即座に更新）
  const [xAxis, setXAxis] = useState('seed');
  const [inputFilter, setInputFilter] = useState('');
  const [sortByScore, setSortByScore] = useState(false);
  const [useLogScale, setUseLogScale] = useState(false);
  const [useRelativeScore, setUseRelativeScore] = useState(false);

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
