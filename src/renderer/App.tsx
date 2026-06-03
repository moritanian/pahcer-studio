import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import type { Workspace } from '../schemas/workspace';
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
      style={{ flex: 1, minHeight: 0 }}
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

const TAB_SLUGS = ['run', 'history', 'analysis'] as const;
type TabSlug = (typeof TAB_SLUGS)[number];

function App() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // URL パスからタブを判定 (例: /w/:id/run → 0)
  const tabIndex = (() => {
    const m = location.pathname.match(/^\/w\/[^/]+\/([^/]+)/);
    const slug = m?.[1] as TabSlug | undefined;
    const idx = slug ? TAB_SLUGS.indexOf(slug) : -1;
    return idx >= 0 ? idx : 0;
  })();

  // ワークスペースの状態
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // URL パラメータから workspace をロード
  useEffect(() => {
    if (!workspaceId) {
      // workspace ID がない場合は一覧ページへリダイレクト
      navigate('/workspaces', { replace: true });
      return;
    }

    // 既に同じ workspace を読み込み済みなら再フェッチしない。
    // navigate の identity は URL (タブ) が変わるたびに変化するため、
    // ガードがないとタブ切替のたびにこの effect が再実行され、
    // loading=true → 子要素 unmount → remount で選択状態が失われてしまう。
    if (currentWorkspace?.id === workspaceId) return;

    const loadWorkspace = async () => {
      try {
        setLoading(true);
        // workspace ID から workspace を取得
        const workspace = await apiClient.workspace.get(workspaceId);
        setCurrentWorkspace(workspace);
      } catch (error) {
        console.error('Failed to load workspace:', error);
        // workspace が見つからない場合は一覧ページへ
        navigate('/workspaces', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, [workspaceId, currentWorkspace?.id, navigate]);

  // URL にタブが含まれていない場合はデフォルトを補う
  useEffect(() => {
    if (!workspaceId) return;
    const m = location.pathname.match(/^\/w\/[^/]+\/?([^/]*)/);
    const slug = m?.[1];
    if (!slug || !TAB_SLUGS.includes(slug as TabSlug)) {
      navigate(`/w/${workspaceId}/${TAB_SLUGS[0]}`, { replace: true });
    }
  }, [workspaceId, location.pathname, navigate]);

  // ローディング中は何も表示しない
  if (loading || !currentWorkspace) {
    return null;
  }

  // タブ変更ハンドラー (URL を更新)
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    if (!workspaceId) return;
    const slug = TAB_SLUGS[newValue] ?? TAB_SLUGS[0];
    navigate(`/w/${workspaceId}/${slug}`, { replace: true });
  };

  // ワークスペース選択ハンドラー
  const handleWorkspaceSelect = async (path: string, useWsl: boolean) => {
    try {
      // workspace を作成または取得
      const workspace = await apiClient.workspace.create(path, useWsl);
      setIsSelectorOpen(false);
      // workspace ID を含む URL にナビゲート
      navigate(`/w/${workspace.id}/${TAB_SLUGS[0]}`);
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EventSourceProvider>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
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
                <TestExecutionForm workspaceId={currentWorkspace.id} />
              </TabPanel>
              <TabPanel value={tabIndex} index={1}>
                <TestExecutionList workspaceId={currentWorkspace.id} key={currentWorkspace.id} />
              </TabPanel>
              <TabPanel value={tabIndex} index={2}>
                <ScoreAnalysis workspaceId={currentWorkspace.id} key={currentWorkspace.id} />
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
