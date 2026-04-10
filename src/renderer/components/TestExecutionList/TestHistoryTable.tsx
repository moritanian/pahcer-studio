import type React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  CircularProgress,
  Box,
  TablePagination,
  IconButton,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import type { TestExecution, TestExecutionStatus } from '../../../schemas/execution';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import FilterListIcon from '@mui/icons-material/FilterList';
import TimelapseIcon from '@mui/icons-material/Timelapse';
import AssessmentIcon from '@mui/icons-material/Assessment';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import { apiClient } from '../../api/client';
import TextField from '@mui/material/TextField';

interface TestHistoryTableProps {
  workspaceId: string;
  executions: TestExecution[];
  loading: boolean;
  selectedExecution: TestExecution | null;
  onExecutionSelect: (execution: TestExecution) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}

const TestHistoryTable: React.FC<TestHistoryTableProps> = ({
  workspaceId,
  executions,
  loading,
  selectedExecution,
  onExecutionSelect,
  onRefresh,
  onError,
}) => {
  // テーブル内部の状態
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(-1); // -1 = auto
  const [autoRows, setAutoRows] = useState(25);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // テーブルコンテナの高さと実際の行高さから表示可能な行数を計算
  const calcFitRows = useCallback(() => {
    const container = tableContainerRef.current;
    if (!container) return 25;

    const tbody = container.querySelector('tbody');
    const firstRow = tbody?.querySelector('tr');
    const thead = container.querySelector('thead');

    const rowHeight = firstRow?.getBoundingClientRect().height || 33;
    const headerHeight = thead?.getBoundingClientRect().height || 33;
    const available = container.clientHeight - headerHeight;
    return Math.max(1, Math.floor(available / rowHeight));
  }, []);

  useEffect(() => {
    const updateAutoRows = () => {
      setAutoRows(calcFitRows());
    };
    const timer = setTimeout(updateAutoRows, 100);
    const observer = new ResizeObserver(updateAutoRows);
    if (tableContainerRef.current) {
      observer.observe(tableContainerRef.current);
    }
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [calcFitRows, executions]);

  const effectiveRowsPerPage = rowsPerPage === -1 ? autoRows : rowsPerPage;

  // フィルター
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [testCountFilter, setTestCountFilter] = useState<string>('');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [executionToDelete, setExecutionToDelete] = useState<TestExecution | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingExecutionId, setEditingExecutionId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState('');
  const [updating, setUpdating] = useState(false);

  // テーブルヘッダーの定義
  const columnDefinitions = [
    {
      key: 'id',
      label: 'ID',
      minWidth: 50,
      tooltip: '実行ID',
      icon: <InfoIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'comment',
      label: 'コメント',
      minWidth: 120,
    },
    {
      key: 'startTime',
      label: '開始時間',
      minWidth: 80,
      tooltip: '実行開始時間',
      icon: <TimelapseIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'status',
      label: 'ステータス',
      minWidth: 80,
    },
    {
      key: 'score',
      label: 'スコア',
      minWidth: 80,
      tooltip: '平均スコア',
      icon: <AssessmentIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'relativeScore',
      label: '相対スコア',
      minWidth: 90,
      tooltip: '最高スコアに対する相対スコア (%)',
      icon: <AssessmentIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'logScore',
      label: 'Log₁₀',
      minWidth: 80,
      tooltip: 'Log10(平均スコア)',
      icon: <AssessmentIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'maxTime',
      label: '最大時間',
      minWidth: 80,
      tooltip: '最大実行時間 (ミリ秒)',
      icon: <TimelapseIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'testCount',
      label: 'テスト数',
      minWidth: 80,
      tooltip: '成功数 / 総テスト数',
      icon: <PlaylistAddCheckIcon fontSize="small" sx={{ opacity: 0.6 }} />,
    },
    {
      key: 'actions',
      label: '操作',
      minWidth: 60,
    },
  ];

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteClick = (event: React.MouseEvent, execution: TestExecution) => {
    event.stopPropagation();
    setExecutionToDelete(execution);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!executionToDelete?.id) return;

    setDeleting(true);
    try {
      await apiClient.execution.delete(workspaceId, executionToDelete.id);
      setDeleteDialogOpen(false);
      setExecutionToDelete(null);
      // 削除成功後にリフレッシュ
      await onRefresh();
    } catch (err) {
      console.error('Error deleting execution:', err);
      onError('テスト実行の削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setExecutionToDelete(null);
  };

  const handleCommentDoubleClick = (execution: TestExecution) => {
    setEditingExecutionId(execution.id);
    setEditingComment(execution.comment || '');
  };

  const handleCommentSave = async (executionId: string) => {
    if (updating) return;

    setUpdating(true);
    try {
      await apiClient.execution.update(workspaceId, executionId, {
        comment: editingComment || null,
      });
      setEditingExecutionId(null);
      setEditingComment('');
      await onRefresh();
    } catch (err) {
      console.error('Error updating execution:', err);
      onError('テスト実行の更新に失敗しました');
    } finally {
      setUpdating(false);
    }
  };

  const handleCommentCancel = () => {
    setEditingExecutionId(null);
    setEditingComment('');
  };

  const getStatusColor = (status: TestExecutionStatus | undefined) => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'RUNNING':
        return 'info';
      case 'FAILED':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: TestExecutionStatus | undefined) => {
    switch (status) {
      case 'COMPLETED':
        return '完了';
      case 'RUNNING':
        return '実行中';
      case 'FAILED':
        return '失敗';
      case 'IDLE':
        return '待機中';
      default:
        return status || '不明';
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ja-JP');
  };

  const filteredExecutions = executions.filter((exec) => {
    if (statusFilter !== 'all' && exec.status !== statusFilter) return false;
    if (testCountFilter) {
      const count = exec.totalCount ?? 0;
      if (count !== parseInt(testCountFilter, 10)) return false;
    }
    return true;
  });

  const currentPageData = filteredExecutions.slice(page * effectiveRowsPerPage, page * effectiveRowsPerPage + effectiveRowsPerPage);

  if (loading) {
    return (
      <Paper
        elevation={2}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          borderRadius: 2,
        }}
      >
        <CircularProgress />
      </Paper>
    );
  }

  return (
    <Paper
      elevation={2}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          borderBottom: '1px solid rgba(224, 224, 224, 1)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterListIcon fontSize="small" sx={{ opacity: 0.6 }} />
          <Select
            size="small"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            sx={{ height: 28, fontSize: '0.8rem', minWidth: 100 }}
          >
            <MenuItem value="all">全ステータス</MenuItem>
            <MenuItem value="COMPLETED">完了</MenuItem>
            <MenuItem value="FAILED">失敗</MenuItem>
            <MenuItem value="RUNNING">実行中</MenuItem>
          </Select>
          <TextField
            size="small"
            placeholder="テスト数"
            value={testCountFilter}
            onChange={(e) => { setTestCountFilter(e.target.value.replace(/[^0-9]/g, '')); setPage(0); }}
            sx={{ width: 80, '& .MuiInputBase-root': { height: 28, fontSize: '0.8rem' } }}
          />
        </Box>
        <Tooltip title="更新">
          <IconButton size="small" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <CircularProgress size={20} /> : <RefreshIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <TableContainer ref={tableContainerRef} sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
        <Table stickyHeader size="small" padding="none">
          <TableHead>
            <TableRow sx={{ backgroundColor: 'rgba(0, 0, 0, 0.04)' }}>
              {columnDefinitions.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    fontWeight: 'bold',
                    py: 0.5,
                    px: 1,
                    minWidth: column.minWidth,
                  }}
                >
                  {column.tooltip ? (
                    <Tooltip title={column.tooltip} arrow>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {column.label}
                        {column.icon}
                      </Box>
                    </Tooltip>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {currentPageData.map((execution) => (
              <TableRow
                key={execution.id}
                hover
                sx={{
                  '&:last-child td, &:last-child th': { border: 0 },
                  cursor: 'pointer',
                  backgroundColor:
                    selectedExecution?.id === execution.id ? 'rgba(0, 0, 0, 0.08)' : 'inherit',
                }}
                onClick={() => onExecutionSelect(execution)}
              >
                <TableCell sx={{ fontFamily: 'monospace', py: 0.5, px: 1 }}>
                  {execution.id || '-'}
                </TableCell>
                <TableCell
                  sx={{ py: 0.5, px: 1, cursor: 'text' }}
                  onDoubleClick={() => handleCommentDoubleClick(execution)}
                >
                  {editingExecutionId === execution.id ? (
                    <TextField
                      size="small"
                      value={editingComment}
                      onChange={(e) => setEditingComment(e.target.value)}
                      onBlur={() => handleCommentSave(execution.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCommentSave(execution.id);
                        } else if (e.key === 'Escape') {
                          handleCommentCancel();
                        }
                      }}
                      autoFocus
                      disabled={updating}
                      sx={{
                        '& .MuiInputBase-root': {
                          height: '28px',
                          fontSize: '0.875rem',
                        },
                      }}
                    />
                  ) : (
                    execution.comment || '-'
                  )}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>{formatDate(execution.startTime)}</TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  <Chip
                    label={getStatusLabel(execution.status)}
                    color={getStatusColor(execution.status)}
                    size="small"
                    sx={{ fontWeight: 'medium', height: '20px' }}
                  />
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  {execution.averageScore
                    ? Math.round(execution.averageScore).toLocaleString('ja-JP')
                    : '-'}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  {execution.averageRelativeScore !== undefined &&
                  execution.averageRelativeScore !== null
                    ? `${(execution.averageRelativeScore * 100).toFixed(2)}%`
                    : '-'}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  {execution.averageScore && execution.averageScore > 0
                    ? Math.log10(execution.averageScore).toFixed(4)
                    : '-'}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  {execution.maxExecutionTime ? `${execution.maxExecutionTime.toFixed(2)}ms` : '-'}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  {execution.acceptedCount != null && execution.totalCount != null
                    ? `${execution.acceptedCount}/${execution.totalCount}`
                    : '-'}
                </TableCell>
                <TableCell sx={{ py: 0.5, px: 1 }}>
                  <Tooltip title="削除" disableFocusListener>
                    <IconButton
                      size="small"
                      onClick={(e) => handleDeleteClick(e, execution)}
                      color="error"
                      disabled={deleting}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[
          { value: -1, label: `auto (${autoRows})` },
          10, 25, 50,
        ]}
        component="div"
        count={filteredExecutions.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={(_, newPage) => {
          // auto 時は effectiveRowsPerPage でページ計算
          const maxPage = Math.max(0, Math.ceil(filteredExecutions.length / effectiveRowsPerPage) - 1);
          setPage(Math.min(newPage, maxPage));
        }}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        labelRowsPerPage="表示件数:"
        labelDisplayedRows={() => {
          const from = page * effectiveRowsPerPage + 1;
          const to = Math.min((page + 1) * effectiveRowsPerPage, filteredExecutions.length);
          return `${from}-${to} / ${filteredExecutions.length}`;
        }}
        sx={{ py: 0 }}
        backIconButtonProps={{
          disabled: page === 0,
          onClick: () => setPage(Math.max(0, page - 1)),
        }}
        nextIconButtonProps={{
          disabled: (page + 1) * effectiveRowsPerPage >= filteredExecutions.length,
          onClick: () => setPage(page + 1),
        }}
      />

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-dialog-title"
      >
        <DialogTitle id="delete-dialog-title">テスト実行の削除</DialogTitle>
        <DialogContent>
          <Typography>
            このテスト実行を削除してもよろしいですか？
            <br />
            ID: {executionToDelete?.id}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleting}>
            キャンセル
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" disabled={deleting}>
            {deleting ? <CircularProgress size={16} /> : '削除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default TestHistoryTable;
