import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  TextField,
  Checkbox,
  FormControlLabel,
  Typography,
  Box,
  Divider,
  Chip,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteIcon from '@mui/icons-material/Delete';
import TerminalIcon from '@mui/icons-material/Terminal';
import type { AppSettings, WorkspaceHistory } from '../../../services/WorkspaceService';

interface WorkspaceSelectorProps {
  open: boolean;
  onSelect: (path: string, useWsl: boolean) => void;
  onClose?: () => void;
  currentPath?: string;
}

const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  open,
  onSelect,
  onClose,
  currentPath,
}) => {
  const [history, setHistory] = useState<WorkspaceHistory[]>([]);
  const [manualPath, setManualPath] = useState('');
  const [manualUseWsl, setManualUseWsl] = useState(false);

  // 設定（履歴）を読み込む
  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  const loadHistory = async () => {
    try {
      const settings = (await window.electronAPI.settings.get()) as AppSettings;
      // projectsフィールドから履歴を取得
      const history = settings.projects || [];
      // 日付順（新しい順）にソート
      const sortedHistory = [...history].sort((a, b) => b.lastOpened - a.lastOpened);
      setHistory(sortedHistory);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const saveHistory = async (newHistory: WorkspaceHistory[]) => {
    try {
      // 現在の設定を取得してマージ（将来的な他の設定項目を保持するため）
      const currentSettings = (await window.electronAPI.settings.get()) as AppSettings;
      const newSettings: AppSettings = {
        ...currentSettings,
        projects: newHistory,
      };
      await window.electronAPI.settings.update(newSettings);
      setHistory(newHistory);
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const handleSelect = (path: string, useWsl: boolean) => {
    // 履歴を更新
    const now = Date.now();
    const existingIndex = history.findIndex((h) => h.path === path);
    const newHistory = [...history];

    if (existingIndex >= 0) {
      // 既存の履歴を更新
      newHistory[existingIndex] = { ...newHistory[existingIndex], useWsl, lastOpened: now };
    } else {
      // 新しい履歴を追加
      newHistory.push({ path, useWsl, lastOpened: now });
    }

    // ソートして保存
    newHistory.sort((a, b) => b.lastOpened - a.lastOpened);
    saveHistory(newHistory);

    onSelect(path, useWsl);
  };

  const handleDeleteHistory = (e: React.MouseEvent, pathToDelete: string) => {
    e.stopPropagation();
    const newHistory = history.filter((h) => h.path !== pathToDelete);
    saveHistory(newHistory);
  };

  // WSLパスかどうかを判定するヘルパー関数
  const isWslPath = (path: string): boolean => {
    return path.startsWith('\\\\wsl$\\') || path.startsWith('\\\\wsl.localhost\\');
  };

  const handleBrowse = async () => {
    try {
      const path = await window.electronAPI.dialog.openDirectory();
      if (path) {
        setManualPath(path);
        if (isWslPath(path)) {
          setManualUseWsl(true);
        }
      }
    } catch (error) {
      console.error('Failed to open directory dialog:', error);
    }
  };

  const handleManualSubmit = () => {
    if (manualPath) {
      handleSelect(manualPath, manualUseWsl);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableEscapeKeyDown={!onClose}>
      <DialogTitle>ワークスペースを選択</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 4 }}>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            新しいワークスペースを開く
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              label="パスを入力"
              value={manualPath}
              onChange={(e) => {
                const path = e.target.value;
                setManualPath(path);
                // WSLパスの自動検出
                if (isWslPath(path)) {
                  setManualUseWsl(true);
                }
              }}
              placeholder="C:\Projects\MyProject または ~/projects/my-project"
              size="small"
            />
            <Button
              variant="outlined"
              onClick={handleBrowse}
              startIcon={<FolderOpenIcon />}
              sx={{ whiteSpace: 'nowrap', height: '40px' }}
            >
              参照
            </Button>
          </Box>
          <Box
            sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={manualUseWsl}
                  onChange={(e) => setManualUseWsl(e.target.checked)}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TerminalIcon fontSize="small" />
                  <Typography variant="body2">WSLで開く</Typography>
                </Box>
              }
            />
            <Button variant="contained" onClick={handleManualSubmit} disabled={!manualPath}>
              開く
            </Button>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          最近開いたワークスペース
        </Typography>
        <List>
          {history.map((item) => (
            <ListItem
              key={item.path}
              disablePadding
              secondaryAction={
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={(e) => handleDeleteHistory(e, item.path)}
                  size="small"
                >
                  <DeleteIcon />
                </IconButton>
              }
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                mb: 1,
              }}
            >
              <ListItemButton
                onClick={() => handleSelect(item.path, item.useWsl)}
                selected={currentPath === item.path}
                sx={{
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                }}
              >
                <ListItemText
                  primary={item.path}
                  secondary={new Date(item.lastOpened).toLocaleString()}
                  primaryTypographyProps={{
                    variant: 'body1',
                    fontWeight: 'medium',
                  }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
                  {item.useWsl && (
                    <Chip
                      icon={<TerminalIcon style={{ fontSize: 16 }} />}
                      label="WSL"
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                </Box>
              </ListItemButton>
            </ListItem>
          ))}
          {history.length === 0 && (
            <Typography variant="body2" color="textSecondary" align="center" sx={{ py: 4 }}>
              履歴はありません
            </Typography>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
};

export default WorkspaceSelector;
