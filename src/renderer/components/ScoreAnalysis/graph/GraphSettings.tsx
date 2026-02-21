import type React from 'react';
import { Box, TextField, Checkbox, FormControlLabel } from '@mui/material';

interface GraphSettingsProps {
  xAxis: string;
  inputFilter: string;
  sortByScore: boolean;
  onXAxisChange: (value: string) => void;
  onInputFilterChange: (value: string) => void;
  onToggleSortByScore: (value: boolean) => void;
  useLogScale: boolean;
  onToggleLogScale: (value: boolean) => void;
  useRelativeScore: boolean;
  onToggleRelativeScore: (value: boolean) => void;
}

const GraphSettings: React.FC<GraphSettingsProps> = ({
  xAxis,
  inputFilter,
  sortByScore,
  onXAxisChange,
  onInputFilterChange,
  onToggleSortByScore,
  useLogScale,
  onToggleLogScale,
  useRelativeScore,
  onToggleRelativeScore,
}) => {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        label="X軸(入力変数またはseed)"
        value={xAxis}
        onChange={(e) => onXAxisChange(e.target.value)}
        size="small"
        sx={{ minWidth: 120 }}
        placeholder="入力変数または数式"
      />

      <TextField
        label="入力フィルター"
        value={inputFilter}
        onChange={(e) => onInputFilterChange(e.target.value)}
        size="small"
        sx={{ minWidth: 120 }}
      />

      <FormControlLabel
        control={
          <Checkbox checked={useLogScale} onChange={(e) => onToggleLogScale(e.target.checked)} />
        }
        label="ログスケール (Y軸)"
      />

      <FormControlLabel
        control={
          <Checkbox
            checked={useRelativeScore}
            onChange={(e) => onToggleRelativeScore(e.target.checked)}
          />
        }
        label="相対スコアを使用"
      />

      <FormControlLabel
        control={
          <Checkbox checked={sortByScore} onChange={(e) => onToggleSortByScore(e.target.checked)} />
        }
        label="Y軸の値でX軸をソート"
      />
    </Box>
  );
};

export default GraphSettings;
