import React from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

let mockAlertCalls: Array<{ title: string; message: string; buttons: unknown[] }> = [];
jest.mock('react-native', () => {
  const React = require('react');
  const View = (props: object & { children?: React.ReactNode }) =>
    React.createElement('View', props, (props as { children?: React.ReactNode })?.children);
  View.displayName = 'View';
  return {
    __esModule: true,
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove: jest.fn() }) },
    StyleSheet: { create: (s: object) => s, flatten: (s: object) => s },
    Platform: { OS: 'ios', select: (o: object) => o },
    PixelRatio: { get: () => 2 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    Image: View, Text: View, TouchableOpacity: View, Pressable: View,
    ScrollView: View, FlatList: View, SectionList: View,
    TextInput: View, Switch: View, ActivityIndicator: View,
    RefreshControl: View, Modal: View, KeyboardAvoidingView: View,
    Linking: { openURL: jest.fn() },
    View,
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    Alert: {
      alert: jest.fn((title: string, message: string, buttons: unknown[]) => {
        mockAlertCalls.push({ title, message, buttons });
      }),
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: object) => {
      if (opts && 'defaultValue' in opts) return (opts as { defaultValue: string }).defaultValue;
      return key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

jest.mock('../../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF', accent: '#3b82f6',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
    setTheme: jest.fn(),
    style: 'light',
    setStyle: jest.fn(),
    accentColor: null,
    setAccentColor: jest.fn(),
  }),
  useTokens: () => ({
    radii: { sm: 4, md: 8, lg: 12 },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    type: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20 },
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF', accent: '#3b82f6',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
  }),
}));

jest.mock('../../../src/hooks/useProviderAvailability', () => ({
  useProvidersAvailability: jest.fn(() => ({})),
}));

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

jest.mock('expo-file-system/legacy', () => ({
  DocumentDirectory: '', File: {}, Directory: {}, Paths: {},
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('../../../src/services/ai/AIMemoryIndexService', () => ({
  aiMemoryIndex: { build: jest.fn() },
}));

jest.mock('../../../src/services/TierLimits', () => ({
  FREE_TIER_MAX_REPOS: 5,
  FREE_TIER_MAX_ACCOUNTS: 3,
}));

jest.mock('../../../src/i18n', () => ({
  SUPPORTED_LANGUAGES: [],
  getLanguagePreference: jest.fn(() => Promise.resolve('en')),
  setLanguage: jest.fn(),
}));

jest.mock('../../../src/components/settings/settingsStyles', () => ({
  settingsStyles: {},
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@react-navigation/native-stack', () => ({}));

jest.mock('query-string', () => ({ default: { stringify: jest.fn() } }));

interface TestSettingsContentProps {
  colors: Record<string, string>;
  headerHeight: number;
  tabBarHeight: number;
  theme: 'light' | 'dark' | 'system';
  uiStyle: 'flat' | 'neumorphic' | 'neo-brutalist' | 'retrofuturistic';
  accounts: unknown[];
  activeAccountId: string | null;
  authState: { isAuthenticated: boolean };
  repositories: unknown[];
  syncingRepo: string | null;
  cloningRepo: string | null;
  templatesRepoPref: unknown | null;
  isSyncingExistingTemplates: boolean;
  isAIEnabled: boolean;
  selectedModelName: string;
  actionMode: 'auto' | 'confirm';
  chatStorageLabel: string;
  providers: unknown[];
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  setStyle: (s: 'flat' | 'neumorphic' | 'neo-brutalist' | 'retrofuturistic') => void;
  onOpenConnectToken: () => void;
  onOpenAddAccount: () => void;
  onSwitchAccount: (id: string) => void | Promise<void>;
  onRemoveAccount: (id: string, login: string) => void;
  onRemoveToken: () => void;
  onDisconnectHost: (hostId: string) => void;
  onAddHost: (preset?: string) => void;
  onAddHostLocked: () => void;
  accountSummaries: unknown[];
  onOpenRepoPicker: () => void;
  onSyncRepo: (repo: unknown) => void;
  onRemoveRepo: (repo: unknown) => void;
  lfsPending: Record<string, { count: number; bytes: number }>;
  lfsDownloadingRepo: string | null;
  onDownloadLfsObjects: (repo: unknown) => void;
  onOpenTemplatesRepoPicker: () => void;
  onSyncExistingTemplates: () => void;
  onClearTemplatesRepo: () => void;
  onOpenRenderStyleSettings: () => void;
  onClearData: () => void;
  onResetOnboarding: () => void;
  onStartQuickSetup: () => void;
  isPro: boolean;
  isProLoading: boolean;
  proStatusLabel: string;
  onOpenPaywall: () => void;
  accentColor: string | null;
  setAccentColor: (color: string | null) => void;
  onOpenAccentColorPicker: () => void;
  onManageTemplates: () => void;
  onToggleAI: () => void;
  onOpenModelSelector: () => void;
  onToggleActionMode: () => void;
  onOpenChatRepoPicker: () => void;
  onProviderPress: (provider: unknown) => void;
  onAddProvider: () => void;
  dailyQuoteEnabled: boolean;
  onToggleDailyQuote: () => void;
  aiPersonalizationEnabled: boolean;
  onToggleAiPersonalization: () => void;
  githubToolsEnabled: boolean;
  onToggleGithubTools: () => void;
  dailyQuotePersonalizationEnabled: boolean;
  onToggleDailyQuotePersonalization: () => void;
  dailyQuoteSourceVisible: boolean;
  onToggleDailyQuoteSourceVisible: () => void;
  isBiometricLockEnabled: boolean;
  isBiometricAvailable: boolean;
  biometricKind: unknown;
  biometricLabel: string;
  lockTimeout: number;
  onToggleBiometricLock: (v: boolean) => void;
  onSetLockTimeout: (v: number) => void;
  isBackgroundSyncEnabled: boolean;
  onToggleBackgroundSync: () => void;
  floatingGitButtonVisible: boolean;
  onToggleFloatingGitButton: () => void;
  syncPaused: boolean;
  onToggleSyncPaused: (value: boolean) => void;
  syncHealth: { status: string; lastRunAt: number; lastCompletedAt: number; lastFailedAt: number; consecutiveFailures: number };
  onToggleSSH: (hostId: string) => void;
  hostUseSsh: Record<string, boolean>;
  onConnectOAuth: (hostId: string | null) => void;
  onDisconnectOAuth: (hostId: string) => void;
  oauthLoading: Record<string, boolean>;
  oauthError: Record<string, string | null>;
  onConnectGitHubApp: (hostId: string | null) => void;
  onDisconnectGitHubApp: (hostId: string) => void;
  appLoading: Record<string, boolean>;
  appError: Record<string, string | null>;
  appCredentials: Record<string, unknown>;
  hostCredentialKinds: Record<string, Array<'token' | 'oauth' | 'github_app' | 'ssh'>>;
  onDisconnectPat: (hostId: string) => void;
  patLoading: Record<string, boolean>;
  patError: Record<string, string | null>;
}

function makeProps(overrides: Partial<TestSettingsContentProps> = {}): TestSettingsContentProps {
  return {
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF', accent: '#3b82f6',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
    headerHeight: 100,
    tabBarHeight: 80,
    theme: 'light',
    uiStyle: 'flat',
    accounts: [],
    activeAccountId: null,
    authState: { isAuthenticated: false },
    repositories: [],
    syncingRepo: null,
    cloningRepo: null,
    templatesRepoPref: null,
    isSyncingExistingTemplates: false,
    isAIEnabled: false,
    selectedModelName: '',
    actionMode: 'auto',
    chatStorageLabel: '',
    providers: [],
    setTheme: jest.fn(),
    setStyle: jest.fn(),
    onOpenConnectToken: jest.fn(),
    onOpenAddAccount: jest.fn(),
    onSwitchAccount: jest.fn(),
    onRemoveAccount: jest.fn(),
    onRemoveToken: jest.fn(),
    onDisconnectHost: jest.fn(),
    onAddHost: jest.fn(),
    onAddHostLocked: jest.fn(),
    accountSummaries: [],
    onOpenRepoPicker: jest.fn(),
    onSyncRepo: jest.fn(),
    onRemoveRepo: jest.fn(),
    lfsPending: {},
    lfsDownloadingRepo: null,
    onDownloadLfsObjects: jest.fn(),
    onOpenTemplatesRepoPicker: jest.fn(),
    onSyncExistingTemplates: jest.fn(),
    onClearTemplatesRepo: jest.fn(),
    onOpenRenderStyleSettings: jest.fn(),
    onClearData: jest.fn(),
    onResetOnboarding: jest.fn(),
    onStartQuickSetup: jest.fn(),
    isPro: false,
    isProLoading: false,
    proStatusLabel: 'Upgrade',
    onOpenPaywall: jest.fn(),
    accentColor: null,
    setAccentColor: jest.fn(),
    onOpenAccentColorPicker: jest.fn(),
    onManageTemplates: jest.fn(),
    onToggleAI: jest.fn(),
    onOpenModelSelector: jest.fn(),
    onToggleActionMode: jest.fn(),
    onOpenChatRepoPicker: jest.fn(),
    onProviderPress: jest.fn(),
    onAddProvider: jest.fn(),
    dailyQuoteEnabled: false,
    onToggleDailyQuote: jest.fn(),
    aiPersonalizationEnabled: false,
    onToggleAiPersonalization: jest.fn(),
    githubToolsEnabled: false,
    onToggleGithubTools: jest.fn(),
    dailyQuotePersonalizationEnabled: false,
    onToggleDailyQuotePersonalization: jest.fn(),
    dailyQuoteSourceVisible: false,
    onToggleDailyQuoteSourceVisible: jest.fn(),
    isBiometricLockEnabled: false,
    isBiometricAvailable: false,
    biometricKind: null,
    biometricLabel: '',
    lockTimeout: 0,
    onToggleBiometricLock: jest.fn(),
    onSetLockTimeout: jest.fn(),
    isBackgroundSyncEnabled: false,
    onToggleBackgroundSync: jest.fn(),
    floatingGitButtonVisible: false,
    onToggleFloatingGitButton: jest.fn(),
    syncPaused: false,
    onToggleSyncPaused: jest.fn(),
    syncHealth: { status: 'ok', lastRunAt: 0, lastCompletedAt: 0, lastFailedAt: 0, consecutiveFailures: 0 },
    onToggleSSH: jest.fn(),
    hostUseSsh: {},
    onConnectOAuth: jest.fn(),
    onDisconnectOAuth: jest.fn(),
    oauthLoading: { '__fresh__': false },
    oauthError: { '__fresh__': null },
    onConnectGitHubApp: jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    appLoading: { '__fresh__': false },
    appError: { '__fresh__': null },
    appCredentials: {},
    hostCredentialKinds: {},
    onDisconnectPat: jest.fn(),
    patLoading: {},
    patError: {},
    ...overrides,
  };
}

type ReactTestInstance = import('@testing-library/react-native').ReactTestInstance;

function getQuickSetupRoot(rendered: ReturnType<typeof render>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = (rendered as any).root as ReactTestInstance | undefined;
  if (!root) return null;
  try {
    const all = root.findAllByProps({ testID: 'settings.group.quick-setup' });
    return all.length > 0 ? all[0] : null;
  } catch {
    return null;
  }
}

describe('SettingsContent Quick Setup grouping', () => {
  beforeEach(() => {
    mockAlertCalls = [];
  });

  describe('Quick Setup group', () => {
    it('renders settings.group.quick-setup', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.group.quick-setup')).toBeTruthy();
    });

    it('renders settings.button.quick-setup inside quick-setup group', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const qsRoot = getQuickSetupRoot(rendered);
      expect(qsRoot).not.toBeNull();
      const { getByTestId } = within(qsRoot!);
      expect(getByTestId('settings.button.quick-setup')).toBeTruthy();
    });

    it('onStartQuickSetup fires when quick-setup button is pressed', async () => {
      const onStartQuickSetup = jest.fn();
      const props = makeProps({ onStartQuickSetup });
      const rendered = render(<SettingsContent {...props} />);
      const qsRoot = getQuickSetupRoot(rendered);
      const { getByTestId } = within(qsRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.quick-setup'));
      });
      expect(onStartQuickSetup).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accounts group — no longer wrapped by a separate mode grouping', () => {
    it('connect-host button is accessible at top level (not inside a wrapper group)', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.button.connect-host')).toBeTruthy();
    });

    it('connect-github-oauth button is accessible at top level', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.button.connect-github-oauth')).toBeTruthy();
    });

    it('install-github-app button is accessible at top level', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.button.install-github-app')).toBeTruthy();
    });

    it('onConnectOAuth fires when connect-github-oauth is pressed', async () => {
      const onConnectOAuth = jest.fn();
      const props = makeProps({ onConnectOAuth });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-github-oauth'));
      });
      expect(onConnectOAuth).toHaveBeenCalledWith(null);
    });

    it('onAddHost fires when connect-host is pressed', async () => {
      const onAddHost = jest.fn();
      const props = makeProps({ onAddHost });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-host'));
      });
      expect(onAddHost).toHaveBeenCalledTimes(1);
    });
  });

  describe('Top-level groups remain accessible', () => {
    it('dark mode toggle is accessible (outside any wrapper)', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.toggle.theme')).toBeTruthy();
    });

    it('language picker button is accessible', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.button.language-picker')).toBeTruthy();
    });

    it('render-style-settings button is accessible', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.button.render-style-settings')).toBeTruthy();
    });

    it('floating-git-button toggle is accessible', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.toggle.floating-git-button')).toBeTruthy();
    });

    it('AI toggle is accessible', () => {
      const props = makeProps({ isPro: true, isAIEnabled: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.toggle.ai')).toBeTruthy();
    });
  });

  describe('Top-level group handler preservation', () => {
    it('setTheme fires when dark mode toggle is pressed', async () => {
      const setTheme = jest.fn();
      const props = makeProps({ setTheme });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.theme'), 'valueChange', true);
      });
      expect(setTheme).toHaveBeenCalledWith('dark');
    });

    it('onToggleAI fires when AI toggle is pressed', async () => {
      const onToggleAI = jest.fn();
      const props = makeProps({ isPro: true, isAIEnabled: false, onToggleAI });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.ai'), 'valueChange', true);
      });
      expect(onToggleAI).toHaveBeenCalledTimes(1);
    });

    it('onOpenRenderStyleSettings fires when render-style-settings is pressed', async () => {
      const onOpenRenderStyleSettings = jest.fn();
      const props = makeProps({ onOpenRenderStyleSettings });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.render-style-settings'));
      });
      expect(onOpenRenderStyleSettings).toHaveBeenCalledTimes(1);
    });
  });
});
