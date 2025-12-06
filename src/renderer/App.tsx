import { useState, useEffect } from 'react';
import {
  AppBar,
  Box,
  CssBaseline,
  Tabs,
  Tab,
  Typography,
  ThemeProvider,
  createTheme,
  Button,
  Tooltip,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import './styles/App.css';
import TestExecutionForm from './components/TestExecutionForm';
import TestExecutionList from './components/TestExecutionList';
import ScoreAnalysis from './components/ScoreAnalysis';
import WorkspaceSelector from './components/WorkspaceSelector';
import type { AppSettings } from '../services/WorkspaceService';
import type { Workspace } from '../schemas/execution';
import { apiClient } from './api/client';
import { EventSourceProvider } from './contexts/EventSourceContext';

// タブパネルのインターフェース
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

// タブパネルコンポーネント
function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      style={{ height: 'calc(100vh - 60px)' }}
      {...other}
    >
      <Box sx={{ p: 0, height: '100%' }}>{children}</Box>
    </div>
  );
}

// テーマの作成
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  components: {
    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 'bold',
          '&.Mui-selected': {
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff',
          },
          borderRight: '1px solid rgba(255, 255, 255, 0.2)',
          minHeight: '36px',
          minWidth: '120px',
          maxWidth: '120px',
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          backgroundColor: '#ffffff',
        },
        flexContainer: {
          justifyContent: 'flex-start',
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        regular: {
          minHeight: '48px',
          '@media (min-width: 600px)': {
            minHeight: '48px',
          },
        },
      },
    },
  },
});

function App() {
  // 現在選択されているタブのインデックス
  const [tabIndex, setTabIndex] = useState(0);

  // ワークスペースの状態
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  // 初期化時に設定（履歴）を読み込む
  useEffect(() => {
    const initWorkspace = async () => {
      try {
        const settings = (await apiClient.settings.get()) as AppSettings;
        const history = settings.projects;
        if (history && history.length > 0) {
          // 最新の履歴（最初の要素）を選択
          const latest = history[0];
          setCurrentWorkspace({ targetDirectory: latest.path, useWsl: latest.useWsl });

          // バックエンドにワークスペースを設定
          await apiClient.workspace.set({
            targetDirectory: latest.path,
            useWsl: latest.useWsl,
          });
        } else {
          // 履歴がない場合はセレクターを開く
          setIsSelectorOpen(true);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        setIsSelectorOpen(true);
      }
    };

    initWorkspace();
  }, []);

  // タブ変更ハンドラー
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
  };

  // ワークスペース選択ハンドラー
  const handleWorkspaceSelect = async (path: string, useWsl: boolean) => {
    setCurrentWorkspace({ targetDirectory: path, useWsl });
    setIsSelectorOpen(false);

    // バックエンドにワークスペース変更を通知
    try {
      await apiClient.workspace.set({ targetDirectory: path, useWsl });
    } catch (error) {
      console.error('Failed to set workspace:', error);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EventSourceProvider>
        <Box sx={{ flexGrow: 1 }}>
          <AppBar position="static">
            <Box sx={{ display: 'flex', alignItems: 'center', pr: 2 }}>
              <Typography
                variant="subtitle1"
                component="div"
                sx={{
                  px: 2,
                  py: 1,
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                }}
              >
                pahcer-studio
              </Typography>
              <Tabs
                value={tabIndex}
                onChange={handleTabChange}
                aria-label="basic tabs example"
                textColor="inherit"
                variant="standard"
                sx={{
                  borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
                  flexGrow: 1,
                }}
              >
                <Tab label="テスト実行" sx={{ borderTopLeftRadius: '4px' }} />
                <Tab label="テスト履歴" />
                <Tab label="スコア分析" />
              </Tabs>

              {/* ワークスペース表示と変更ボタン */}
              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ opacity: 0.8, mr: 1 }}>
                  {currentWorkspace ? currentWorkspace.targetDirectory : 'ワークスペース未選択'}
                  {currentWorkspace?.useWsl && ' (WSL)'}
                </Typography>
                <Tooltip title="ワークスペースを変更">
                  <Button
                    color="inherit"
                    variant="outlined"
                    size="small"
                    startIcon={<FolderOpenIcon />}
                    onClick={() => setIsSelectorOpen(true)}
                    sx={{ borderColor: 'rgba(255,255,255,0.5)' }}
                  >
                    変更
                  </Button>
                </Tooltip>
              </Box>
            </Box>
          </AppBar>

          {/* ワークスペース選択時のメインコンテンツ */}
          {currentWorkspace ? (
            <>
              <TabPanel value={tabIndex} index={0}>
                <TestExecutionForm />
              </TabPanel>
              <TabPanel value={tabIndex} index={1}>
                <TestExecutionList key={currentWorkspace.targetDirectory} />
              </TabPanel>
              <TabPanel value={tabIndex} index={2}>
                <ScoreAnalysis key={currentWorkspace.targetDirectory} />
              </TabPanel>
            </>
          ) : null}

          {/* ワークスペース選択ダイアログ */}
          <WorkspaceSelector
            open={isSelectorOpen || !currentWorkspace}
            onSelect={handleWorkspaceSelect}
            onClose={currentWorkspace ? () => setIsSelectorOpen(false) : undefined}
            currentPath={currentWorkspace?.targetDirectory}
          />
        </Box>
      </EventSourceProvider>
    </ThemeProvider>
  );
}

export default App;
