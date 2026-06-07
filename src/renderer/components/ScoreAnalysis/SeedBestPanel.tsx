import type React from 'react';
import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  CircularProgress,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { apiClient } from '../../api/client';
import type { SeedRankingResponse, BestPerSeedResponse } from '../../../schemas/seedScore';

interface SeedBestPanelProps {
  workspaceId: string;
}

const fmtScore = (v: number | null): string =>
  v == null ? '-' : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);

const fmtTime = (ms: number | null): string => (ms == null ? '-' : `${ms.toFixed(0)} ms`);

/**
 * seed 別ベストスコアパネル。
 *  - 案3: seed 指定 → 全 execution を生スコアの良い順にランキング
 *  - 案2: 全 seed のベスト execution 一覧（ページング）
 */
const SeedBestPanel: React.FC<SeedBestPanelProps> = ({ workspaceId }) => {
  // --- 案3: seed 指定ランキング ---
  const [seedInput, setSeedInput] = useState('');
  const [ranking, setRanking] = useState<SeedRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);

  // --- 案2: 全 seed ベスト一覧 ---
  const [bestPerSeed, setBestPerSeed] = useState<BestPerSeedResponse | null>(null);
  const [bestLoading, setBestLoading] = useState(false);
  const [bestError, setBestError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const fetchRanking = useCallback(async () => {
    const seed = parseInt(seedInput, 10);
    if (Number.isNaN(seed)) {
      setRankingError('seed を数値で入力してください');
      return;
    }
    try {
      setRankingLoading(true);
      setRankingError(null);
      const result = await apiClient.seed.getRanking(workspaceId, seed);
      setRanking(result);
      if (result.entries.length === 0) {
        setRankingError(`seed=${seed} のスコアを持つ実行が見つかりませんでした`);
      }
    } catch (e) {
      setRankingError('ランキングの取得に失敗しました');
    } finally {
      setRankingLoading(false);
    }
  }, [seedInput, workspaceId]);

  const fetchBestPerSeed = useCallback(async () => {
    try {
      setBestLoading(true);
      setBestError(null);
      const result = await apiClient.seed.getBestPerSeed(workspaceId);
      setBestPerSeed(result);
      setPage(0);
      if (result.rows.length === 0) {
        setBestError('集計対象の実行データが見つかりませんでした');
      }
    } catch (e) {
      setBestError('ベスト一覧の取得に失敗しました');
    } finally {
      setBestLoading(false);
    }
  }, [workspaceId]);

  const pagedRows = bestPerSeed
    ? bestPerSeed.rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
    : [];

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <EmojiEventsIcon color="primary" />
        <Typography variant="h6">seed 別ベストスコア</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        生スコア (absolute) で比較します。
      </Typography>

      {/* 案3: seed 指定ランキング */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          label="seed"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fetchRanking();
          }}
          sx={{ width: 120 }}
        />
        <Button variant="contained" onClick={fetchRanking} disabled={rankingLoading}>
          ランキング取得
        </Button>
        {ranking && ranking.bestExecutionId && (
          <Chip
            icon={<EmojiEventsIcon />}
            color="success"
            label={`ベスト: ${ranking.bestExecutionId}`}
          />
        )}
      </Box>

      {rankingError && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {rankingError}
        </Alert>
      )}

      {rankingLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        ranking &&
        ranking.entries.length > 0 && (
          <TableContainer sx={{ maxHeight: 320, mb: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>順位</TableCell>
                  <TableCell>実行 ID</TableCell>
                  <TableCell align="right">スコア</TableCell>
                  <TableCell align="right">実行時間</TableCell>
                  <TableCell>コメント</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ranking.entries.map((e) => (
                  <TableRow key={e.executionId} selected={e.isBest} hover>
                    <TableCell>
                      {e.isError ? (
                        <Chip size="small" color="error" label="エラー" />
                      ) : e.rank === 1 ? (
                        <Chip size="small" color="success" icon={<EmojiEventsIcon />} label="1" />
                      ) : (
                        (e.rank ?? '-')
                      )}
                    </TableCell>
                    <TableCell>{e.executionId}</TableCell>
                    <TableCell align="right">{fmtScore(e.score)}</TableCell>
                    <TableCell align="right">{fmtTime(e.executionTime)}</TableCell>
                    <TableCell>{e.comment || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* 案2: 全 seed ベスト一覧 */}
      <Accordion
        sx={{ mt: 1 }}
        onChange={(_, expanded) => expanded && !bestPerSeed && fetchBestPerSeed()}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1">全 seed のベスト一覧</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ mb: 1 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={fetchBestPerSeed}
              disabled={bestLoading}
            >
              {bestPerSeed ? '再集計' : '集計'}
            </Button>
          </Box>

          {bestError && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {bestError}
            </Alert>
          )}

          {bestLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            bestPerSeed &&
            bestPerSeed.rows.length > 0 && (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                  <Chip
                    size="small"
                    label={`平均ベストスコア: ${fmtScore(bestPerSeed.averageBestScore)}`}
                  />
                  <Chip size="small" label={`集計 seed 数: ${bestPerSeed.rows.length}`} />
                </Box>
                <TableContainer sx={{ maxHeight: 480 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>seed</TableCell>
                        <TableCell>ベスト実行 ID</TableCell>
                        <TableCell align="right">ベストスコア</TableCell>
                        <TableCell align="right">実行時間</TableCell>
                        <TableCell>コメント</TableCell>
                        <TableCell align="right">実行数</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedRows.map((row) => (
                        <TableRow key={row.seed} hover>
                          <TableCell>{row.seed}</TableCell>
                          <TableCell>{row.bestExecutionId || '-'}</TableCell>
                          <TableCell align="right">{fmtScore(row.bestScore)}</TableCell>
                          <TableCell align="right">{fmtTime(row.executionTime)}</TableCell>
                          <TableCell>{row.comment || '-'}</TableCell>
                          <TableCell align="right">{row.executionCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={bestPerSeed.rows.length}
                  page={page}
                  onPageChange={(_, p) => setPage(p)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100, 200]}
                  labelRowsPerPage="表示件数"
                />
              </>
            )
          )}
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
};

export default SeedBestPanel;
