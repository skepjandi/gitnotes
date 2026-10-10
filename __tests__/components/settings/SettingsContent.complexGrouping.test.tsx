/**
 * Focused regression tests for Settings Complex grouping.
 *
 * Structure contract:
 *   <Group title={t('settings.complex')} testID="settings.group.complex">
 *     <Group title={t('accounts.title')}>   <- INSIDE Complex
 *       Connect Host / OAuth / GitHub App controls
 *     </Group>
 *     <Group title={t('settings.repositories')}>  <- INSIDE Complex
 *       Repository picker
 *     </Group>
 *     <Group title={t('settings.syncEngine')}>    <- INSIDE Complex
 *       Sync engine controls per repo
 *     </Group>
 *     <Group title={t('settings.templates')}>     <- INSIDE Complex
 *       Templates repo controls
 *     </Group>
 *     <Group title={t('settings.noteRendering')}> <- INSIDE Complex
 *       Note rendering controls
 *     </Group>
 *   </Group>
 *
 * Groups OUTSIDE Complex (remain accessible at top level):
 *   Appearance, Language, Security, Sync, AI, etc.
 *
 * Uses the same mock scaffold as SettingsContent.style.test.tsx to keep
 * mocks consistent and avoid duplicating enormous mock blocks.
 */

import React from 'react';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types (mirrors SettingsContent.style.test.tsx)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsContent Complex grouping — structural containment', () => {
  beforeEach(() => {
    mockAlertCalls = [];
  });

  // -----------------------------------------------------------------
  // Helper: resolve the complex group ReactTestInstance for within()
  // RTL 13: within() accepts ReactTestInstance directly (not DOM nodes)
  // -----------------------------------------------------------------
  function getComplexRoot(rendered: ReturnType<typeof render>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = (rendered as any).root as ReactTestInstance | undefined;
    if (!root) return null;
    // root is a ReactTestInstance — find the element with testID='settings.group.complex'
    try {
      const all = root.findAllByProps({ testID: 'settings.group.complex' });
      return all.length > 0 ? all[0] : null;
    } catch {
      return null;
    }
  }

  type ReactTestInstance = import('@testing-library/react-native').ReactTestInstance;

  // -----------------------------------------------------------------
  // INSIDE Complex — fresh identity (no accounts)
  // -----------------------------------------------------------------
  describe('Inside Complex — fresh identity (accountSummaries=[])', () => {
    it('renders settings.group.complex', () => {
      const { getByTestId } = render(<SettingsContent {...makeProps()} />);
      expect(getByTestId('settings.group.complex')).toBeTruthy();
    });

    it('connect-host button is a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.connect-host')).toBeTruthy();
    });

    it('connect-github-oauth button is a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.connect-github-oauth')).toBeTruthy();
    });

    it('install-github-app button is a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.install-github-app')).toBeTruthy();
    });

    it('repo-picker button is a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.repo-picker')).toBeTruthy();
    });

    it('templates-repo-picker button is a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.templates-repo-picker')).toBeTruthy();
    });

    it('render-style-settings button is NOT a descendant of settings.group.complex (Note Rendering is outside Complex)', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.button.render-style-settings')).toBeNull();
      const { getByTestId } = rendered;
      expect(getByTestId('settings.button.render-style-settings')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------
  // INSIDE Complex — handler preservation (fresh identity)
  // -----------------------------------------------------------------
  describe('Inside Complex — handler preservation (accountSummaries=[])', () => {
    it('onConnectOAuth fires when connect-github-oauth is pressed', async () => {
      const onConnectOAuth = jest.fn();
      const props = makeProps({ onConnectOAuth });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-github-oauth'));
      });
      expect(onConnectOAuth).toHaveBeenCalledWith(null);
    });

    it('onConnectGitHubApp fires when install-github-app is pressed', async () => {
      const onConnectGitHubApp = jest.fn();
      const props = makeProps({ onConnectGitHubApp });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.install-github-app'));
      });
      expect(onConnectGitHubApp).toHaveBeenCalledWith(null);
    });

    it('onAddHost fires when connect-host is pressed', async () => {
      const onAddHost = jest.fn();
      const props = makeProps({ onAddHost });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-host'));
      });
      expect(onAddHost).toHaveBeenCalledTimes(1);
    });

    it('onOpenRepoPicker fires when repo-picker is pressed', async () => {
      const onOpenRepoPicker = jest.fn();
      const props = makeProps({ onOpenRepoPicker });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.repo-picker'));
      });
      expect(onOpenRepoPicker).toHaveBeenCalledTimes(1);
    });

    it('onOpenTemplatesRepoPicker fires when templates-repo-picker is pressed', async () => {
      const onOpenTemplatesRepoPicker = jest.fn();
      const props = makeProps({ onOpenTemplatesRepoPicker });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.templates-repo-picker'));
      });
      expect(onOpenTemplatesRepoPicker).toHaveBeenCalledTimes(1);
    });

    it('onOpenRenderStyleSettings fires when render-style-settings is pressed (outside Complex)', async () => {
      const onOpenRenderStyleSettings = jest.fn();
      const props = makeProps({ onOpenRenderStyleSettings });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.render-style-settings'));
      });
      expect(onOpenRenderStyleSettings).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------
  // INSIDE Complex — with accounts populated
  // -----------------------------------------------------------------
  describe('Inside Complex — with accounts (accountSummaries populated)', () => {
    const accountSummariesWithHost = [
      {
        accountId: 'acc1',
        account: { id: 'acc1', login: 'testuser', name: 'Test User', avatarUrl: null },
        hosts: [
          {
            id: 'host1',
            provider: 'github' as const,
            hostLogin: 'testuser',
            instanceBaseUrl: null,
          },
        ],
        activeHostId: 'host1',
      },
    ];

    it('connect-github-oauth-existing button is a descendant of settings.group.complex when accounts exist', () => {
      const props = makeProps({ accountSummaries: accountSummariesWithHost });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.connect-github-oauth-existing')).toBeTruthy();
    });

    it('connect-host button is a descendant of settings.group.complex when accounts exist', () => {
      const props = makeProps({ accountSummaries: accountSummariesWithHost, isPro: true });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.connect-host')).toBeTruthy();
    });

    it('remove-token button is a descendant of settings.group.complex when accounts exist', () => {
      const multiHostSummary = accountSummariesWithHost.map(s => ({
        ...s,
        hosts: [
          ...s.hosts,
          { id: 'host2', provider: 'github' as const, hostLogin: 'other', instanceBaseUrl: null },
        ],
      }));
      const props = makeProps({ accountSummaries: multiHostSummary, isPro: true });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      expect(getByTestId('settings.button.remove-token')).toBeTruthy();
    });

    it('onConnectOAuth fires when connect-github-oauth-existing is pressed (Pro user)', async () => {
      const onConnectOAuth = jest.fn();
      const props = makeProps({ accountSummaries: accountSummariesWithHost, isPro: true, onConnectOAuth });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-github-oauth-existing'));
      });
      expect(onConnectOAuth).toHaveBeenCalledWith(null);
    });

    it('onAddHost fires when connect-host is pressed (Pro user with existing accounts)', async () => {
      const onAddHost = jest.fn();
      const props = makeProps({ accountSummaries: accountSummariesWithHost, isPro: true, onAddHost });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-host'));
      });
      expect(onAddHost).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------
  // OUTSIDE Complex — still accessible (not nested inside Complex)
  // -----------------------------------------------------------------
  describe('Outside Complex — still accessible', () => {
    it('dark mode toggle is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.theme')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.theme')).toBeTruthy();
    });

    it('language picker button is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.button.language-picker')).toBeNull();
      expect(rendered.getByTestId('settings.button.language-picker')).toBeTruthy();
    });

    it('floating-git-button toggle is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.floating-git-button')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.floating-git-button')).toBeTruthy();
    });

    it('pause-sync toggle is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.pause-sync')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.pause-sync')).toBeTruthy();
    });

    it('background-sync toggle is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.background-sync')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.background-sync')).toBeTruthy();
    });

    it('biometric-lock toggle is NOT a descendant of settings.group.complex (Security group)', () => {
      const props = makeProps({ isPro: true, isBiometricAvailable: true, isBiometricLockEnabled: false });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.biometric-lock')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.biometric-lock')).toBeTruthy();
    });

    it('AI toggle is NOT a descendant of settings.group.complex', () => {
      const props = makeProps({ isPro: true, isAIEnabled: false });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.toggle.ai')).toBeNull();
      expect(rendered.getByTestId('settings.toggle.ai')).toBeTruthy();
    });

    it('pro row is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.row.pro')).toBeNull();
      expect(rendered.getByTestId('settings.row.pro')).toBeTruthy();
    });

    it('basic style option is NOT a descendant of settings.group.complex', () => {
      const rendered = render(<SettingsContent {...makeProps()} />);
      const complexRoot = getComplexRoot(rendered);
      const { queryByTestId } = within(complexRoot!);
      expect(queryByTestId('settings.option.style.basic')).toBeNull();
      expect(rendered.getByTestId('settings.option.style.basic')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------
  // OUTSIDE Complex — handler preservation
  // -----------------------------------------------------------------
  describe('Outside Complex — handler preservation', () => {
    it('setTheme fires when dark mode toggle is pressed (outside Complex)', async () => {
      const setTheme = jest.fn();
      const props = makeProps({ setTheme });
      const { getByTestId } = render(<SettingsContent {...props} />);
      // Dark mode toggle is global, not inside complex
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.theme'), 'valueChange', true);
      });
      expect(setTheme).toHaveBeenCalledWith('dark');
    });

    it('onToggleAI fires when AI toggle is pressed (outside Complex)', async () => {
      const onToggleAI = jest.fn();
      const props = makeProps({ isPro: true, isAIEnabled: false, onToggleAI });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.ai'), 'valueChange', true);
      });
      expect(onToggleAI).toHaveBeenCalledTimes(1);
    });

    it('onToggleBiometricLock fires when biometric toggle is pressed (outside Complex)', async () => {
      const onToggleBiometricLock = jest.fn();
      const props = makeProps({ isPro: true, isBiometricAvailable: true, isBiometricLockEnabled: false, onToggleBiometricLock });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.biometric-lock'), 'valueChange', true);
      });
      expect(onToggleBiometricLock).toHaveBeenCalledWith(true);
    });

    it('onToggleFloatingGitButton fires when floating-git-button toggle is pressed (outside Complex)', async () => {
      const onToggleFloatingGitButton = jest.fn();
      const props = makeProps({ floatingGitButtonVisible: false, onToggleFloatingGitButton });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.floating-git-button'), 'valueChange', true);
      });
      expect(onToggleFloatingGitButton).toHaveBeenCalledTimes(1);
    });

    it('onToggleSyncPaused fires when pause-sync toggle is pressed (outside Complex)', async () => {
      const onToggleSyncPaused = jest.fn();
      const props = makeProps({ syncPaused: false, onToggleSyncPaused });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent(getByTestId('settings.toggle.pause-sync'), 'valueChange', true);
      });
      expect(onToggleSyncPaused).toHaveBeenCalledWith(true);
    });

    it('setStyle fires when basic style option is pressed (outside Complex)', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ uiStyle: 'neo-brutalist', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.basic'));
      });
      expect(setStyle).toHaveBeenCalledWith('flat');
    });
  });

  // -----------------------------------------------------------------
  // Sync Engine — inside Complex, shows when repositories > 0
  // -----------------------------------------------------------------
  describe('Inside Complex — Sync Engine (repositories > 0)', () => {
    it('onSyncRepo fires when sync button on repo row is pressed', async () => {
      const onSyncRepo = jest.fn();
      const repositories = [{ id: 'repo1', name: 'test-repo', path: 'test-repo' }];
      const props = makeProps({ repositories, onSyncRepo });
      const rendered = render(<SettingsContent {...props} />);
      const complexRoot = getComplexRoot(rendered);
      expect(complexRoot).not.toBeNull();
      const { getByTestId } = within(complexRoot!);
      await act(async () => {
        fireEvent.press(getByTestId('settings.button.sync-repo'));
      });
      expect(onSyncRepo).toHaveBeenCalledTimes(1);
    });
  });
});
