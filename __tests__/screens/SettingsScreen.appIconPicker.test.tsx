import React from 'react';
import { render, act } from '@testing-library/react-native';
import SettingsScreen from '@/screens/SettingsScreen';

type CapturedProps = { onOpenAppIconPicker?: () => void };

let captured: CapturedProps = {};

jest.mock('react-native', () => {
  const React = require('react');
  const View = (props: object & { children?: React.ReactNode }) =>
    React.createElement('View', props, (props as { children?: React.ReactNode })?.children);
  View.displayName = 'View';
  const Text = (props: object & { children?: React.ReactNode }) =>
    React.createElement('Text', props, (props as { children?: React.ReactNode })?.children);
  Text.displayName = 'Text';
  return {
    __esModule: true,
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove: jest.fn() }) },
    StyleSheet: { create: (s: object) => s, flatten: (s: object) => s },
    Platform: { OS: 'ios', select: (o: object) => o },
    PixelRatio: { get: () => 2 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    Image: View, Text, TouchableOpacity: View, Pressable: View,
    ScrollView: View, FlatList: View, SectionList: View,
    TextInput: View, Switch: View, ActivityIndicator: View,
    RefreshControl: View, Modal: View, KeyboardAvoidingView: View,
    AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) },
    Linking: { openURL: jest.fn() },
    View,
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    Alert: { alert: jest.fn() },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
    setTheme: jest.fn(),
    style: 'light',
    setStyle: jest.fn(),
  }),
  useTokens: () => ({
    radii: { sm: 4, md: 8, lg: 12 },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    type: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20 },
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
  }),
}));

const mockAuthState = {
  authState: { isAuthenticated: false, user: null },
  accounts: [],
  activeAccountId: null,
  accountSummaries: [] as Array<{
    accountId: string;
    account: { id: string; login: string };
    hosts: [];
    activeHostId: null;
  }>,
  setToken: jest.fn(),
  clearToken: jest.fn(),
  addAccount: jest.fn(),
  removeAccount: jest.fn(),
  switchAccount: jest.fn(),
  disconnectHost: jest.fn(),
  disconnectAllHosts: jest.fn(),
  disconnectGitHubOAuth: jest.fn(),
  disconnectGitHubApp: jest.fn(),
  disconnectGitHubPat: jest.fn(),
  refreshAccounts: jest.fn(),
};

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

const mockReposState = { repositories: [], addRepository: jest.fn(), removeRepository: jest.fn() };

jest.mock('@/contexts/RepoContext', () => ({
  useRepos: () => mockReposState,
}));

jest.mock('@/contexts/NoteContext', () => ({ useNotes: () => ({ clearAllNotes: jest.fn(), refreshNotes: jest.fn() }) }));
jest.mock('@/contexts/CanvasContext', () => ({ useCanvases: () => ({ refreshCanvases: jest.fn() }) }));
jest.mock('@/contexts/TodoContext', () => ({ useTodos: () => ({ refreshTodos: jest.fn() }) }));
jest.mock('@/contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({
    isLockEnabled: false,
    isBiometricAvailable: false,
    biometricKind: null,
    biometricLabel: '',
    lockTimeout: 0,
    setIsLockEnabled: jest.fn(),
    setLockTimeout: jest.fn(),
  }),
}));

jest.mock('@/hooks/useBackgroundSync', () => ({ useBackgroundSync: () => ({ isEnabled: false, toggle: jest.fn() }) }));
jest.mock('@/hooks/useForegroundSyncSettings', () => ({
  useForegroundSyncSettings: () => ({ syncPaused: false, setSyncPaused: jest.fn() }),
}));
jest.mock('@/hooks/useForegroundSyncHealth', () => ({
  useForegroundSyncHealth: () => ({
    status: 'ok', lastRunAt: 0, lastCompletedAt: 0, lastFailedAt: 0,
  }),
}));
jest.mock('@/services/ReviewPromptService', () => ({ openStoreListing: jest.fn() }));
jest.mock('@/services/PushNotificationService', () => ({}));

const mockAiStoreState = {
  isEnabled: false,
  selectedModelId: null,
  actionMode: 'auto' as const,
  chatRepoOwner: null,
  chatRepoName: null,
  providers: [],
  toggleAI: jest.fn(),
  dailyQuoteEnabled: false,
  toggleDailyQuote: jest.fn(),
  aiPersonalizationEnabled: false,
  toggleAiPersonalization: jest.fn(),
  githubToolsEnabled: false,
  toggleGithubTools: jest.fn(),
  dailyQuotePersonalizationEnabled: false,
  toggleDailyQuotePersonalization: jest.fn(),
  setActionMode: jest.fn(),
  updateProvider: jest.fn(),
};

jest.mock('@/stores/aiStore', () => ({
  useAIStore: (selector: (state: typeof mockAiStoreState) => unknown) => selector(mockAiStoreState),
}));
jest.mock('@/stores/templateStore', () => ({
  useTemplateStore: () => ({
    customTemplates: [],
    getState: () => ({ customTemplates: [] }),
    updateTemplate: jest.fn(),
  }),
}));
jest.mock('@/stores/floatingGitButtonStore', () => ({
  useFloatingGitButtonStore: (selector: (state: { visible: boolean; toggle: jest.Mock }) => unknown) =>
    selector({ visible: false, toggle: jest.fn() }),
}));
jest.mock('@/stores/proStore', () => ({
  useProStore: (selector: (state: { trialActive: boolean; trialEndsAt: number | null }) => unknown) =>
    selector({ trialActive: false, trialEndsAt: null }),
}));
jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getHostToken: jest.fn(),
    getHostUseSsh: jest.fn(() => Promise.resolve(false)),
  },
}));
jest.mock('@/services/AuthService', () => ({
  AuthService: {
    isAuthenticated: jest.fn(() => true),
    getToken: jest.fn(() => Promise.resolve('token')),
    validateToken: jest.fn(() => Promise.resolve({ ok: true, user: { login: 'test' } })),
  },
}));
jest.mock('@/services/git/gitHostFactory', () => ({
  getGitHostService: jest.fn(),
  gitHubHostService: {},
  gitLabService: {},
}));
jest.mock('@/services/TemplateRepoPreferenceService', () => ({
  TemplateRepoPreferenceService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('@/services/TemplateMarkdownService', () => ({
  serializeTemplate: jest.fn(() => ''),
  templateSlug: jest.fn(() => 'slug'),
}));
jest.mock('@/services/RepoFileSyncService', () => ({
  RepoFileSyncService: { syncRepoFiles: jest.fn(() => Promise.resolve({ synced: [], removed: [], failed: [] })) },
}));
jest.mock('@/services/git/CloneMigrationService', () => ({
  CloneMigrationService: { migrateRepos: jest.fn(() => Promise.resolve({})) },
}));
jest.mock('@/services/RepoImportService', () => ({
  importRepoAtAdd: jest.fn(() => Promise.resolve({ ok: true, counts: {} })),
}));
jest.mock('@/services/git/activeBranchStore', () => ({ getActiveBranch: jest.fn(() => Promise.resolve('main')) }));
jest.mock('@/services/git/lfs', () => ({ LfsService: { listPending: jest.fn(() => Promise.resolve([])) } }));
jest.mock('@/services/OnboardingService', () => ({
  OnboardingService: { resetOnboarding: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/utils/haptics', () => ({
  HapticService: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));
jest.mock('@/utils/proAlerts', () => ({ promptProUpgrade: jest.fn() }));
jest.mock('@/hooks/useProGate', () => ({ useProStatus: jest.fn(() => ({ isPro: true })) }));
jest.mock('@/services/TierLimits', () => ({ FREE_TIER_MAX_REPOS: 5, FREE_TIER_MAX_ACCOUNTS: 3 }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@react-navigation/native-stack', () => ({}));
jest.mock('query-string', () => ({ default: { stringify: jest.fn() } }));
jest.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
jest.mock('expo-file-system/legacy', () => ({
  DocumentDirectory: '', File: {}, Directory: {}, Paths: {},
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/ForegroundSyncService', () => ({
  getForegroundSyncHealth: jest.fn(() => ({
    status: 'ok', lastRunAt: 0, lastCompletedAt: 0, lastFailedAt: 0,
  })),
  subscribeForegroundSync: jest.fn(() => () => undefined),
  setForegroundSyncPaused: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));
jest.mock('@/components/ui', () => ({
  ScreenHeader: ({ children }: { children: React.ReactNode }) => children,
  useScreenHeaderHeight: () => 44,
  useTabBarHeight: () => 49,
  Modal: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
    visible ? children ?? null : null,
  Group: ({ children }: { children: React.ReactNode }) => children,
  GroupRow: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/ui/SafeAreaView', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/settings/SettingsContent', () => ({
  SettingsContent: (props: CapturedProps) => {
    captured = props;
    return null;
  },
}));
jest.mock('@/components/settings/SettingsModals', () => ({
  SettingsModals: () => null,
  SSHKeyModal: () => null,
}));
jest.mock('@/components/ConnectHostModal', () => ({ ConnectHostModal: () => null }));
jest.mock('@/components/ai/ModelSelector', () => ({ ModelSelector: () => null }));
jest.mock('@/components/ai/ProviderConfigModal', () => ({ ProviderConfigModal: () => null }));
jest.mock('@/components/ai/ChatRepoPickerModal', () => ({ ChatRepoPickerModal: () => null }));
jest.mock('@/components/settings/CloneProgressModal', () => ({ CloneProgressModal: () => null }));
jest.mock('@/components/settings/OAuthPermissionModal', () => ({ OAuthPermissionModal: () => null }));
jest.mock('@/components/HexColorPickerModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/settings/RewardCatalogModal', () => ({ __esModule: true, default: () => null }));

function openAppIconPicker() {
  const rendered = render(<SettingsScreen />);
  act(() => {
    captured.onOpenAppIconPicker?.();
  });
  return rendered;
}

describe('SettingsScreen app-icon picker section headings', () => {
  it('insets both section headings from the group surface border', () => {
    const { getByText } = openAppIconPicker();

    const proIcons = getByText('Pro Icons').props.style as { paddingHorizontal?: number };
    const referralRewards = getByText('Referral Rewards').props.style as { paddingHorizontal?: number };

    expect(proIcons.paddingHorizontal).toBe(16);
    expect(referralRewards.paddingHorizontal).toBe(16);
  });
});
