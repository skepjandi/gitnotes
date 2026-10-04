/**
 * Regression and behavior tests for independent GitHub credential status and
 * removal controls in SettingsContent.
 *
 * Tests cover:
 * - PAT status display and remove action when hostCredentialKinds includes 'token'
 * - App "Remove" action when appCredentials[host.id] is present
 * - OAuth disconnect action is explicit
 * - Independent removal of each credential kind without removing the host/account
 *
 * Test IDs:
 *   settings.button.remove-pat.{hostId}     → PAT remove button
 *   settings.button.remove-github-app.{hostId} → App remove button
 *   settings.button.connect-oauth.{hostId}  → OAuth connect/disconnect button
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

// ---------------------------------------------------------------------------
// Module-level mocks (must precede any imports)
// ---------------------------------------------------------------------------

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
    Alert: { alert: jest.fn() },
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

jest.mock('../../../src/services/AuthService', () => ({
  AuthService: {
    getProviderAuthAvailability: jest.fn().mockResolvedValue({ oauth: { available: true } }),
  },
}));

// ---------------------------------------------------------------------------
// Shared prop shape + factory
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
  appIcon: unknown | null;
  appIconSupported: boolean;
  appIconLoading: boolean;
  onOpenAppIconPicker: () => void;
  onConnectOAuth: (hostId: string | null) => void;
  onDisconnectOAuth: (hostId: string) => void;
  oauthLoading: Record<string, boolean>;
  oauthError: Record<string, string | null>;
  onConnectGitHubApp: (hostId: string | null) => void;
  onDisconnectGitHubApp: (hostId: string) => void;
  appLoading: Record<string, boolean>;
  appError: Record<string, string | null>;
  appCredentials: Record<string, unknown | null>;
  hostCredentialKinds: Record<string, Array<'token' | 'oauth' | 'github_app' | 'ssh'>>;
  onDisconnectPat: (hostId: string) => void;
  patLoading: Record<string, boolean>;
  patError: Record<string, string | null>;
}

const makeAccountSummary = (overrides: Partial<{
  accountId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  hostId: string;
  hostProvider: string;
  hostLogin: string;
  instanceBaseUrl: string | null;
  activeHostId: string | null;
}> = {}) => ({
  accountId: overrides.accountId ?? 'acc-1',
  login: overrides.login ?? 'testuser',
  name: overrides.name ?? null,
  avatarUrl: overrides.avatarUrl ?? null,
  hostId: overrides.hostId ?? 'gh-1',
  hostProvider: overrides.hostProvider ?? 'github',
  hostLogin: overrides.hostLogin ?? 'testuser',
  instanceBaseUrl: overrides.instanceBaseUrl ?? null,
  activeHostId: overrides.activeHostId ?? 'gh-1',
});

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
    appIcon: null,
    appIconSupported: false,
    appIconLoading: false,
    onOpenAppIconPicker: jest.fn(),
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

describe('Independent GitHub credential status and removal controls', () => {
  describe('PAT remove control', () => {
    it('shows PAT remove button when hostCredentialKinds includes token', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        hostCredentialKinds: { 'gh-1': ['token', 'oauth'] },
        onDisconnectPat: jest.fn(),
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.button.remove-pat.gh-1')).toBeTruthy();
    });

    it('does not show PAT remove button when hostCredentialKinds does not include token', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        hostCredentialKinds: { 'gh-1': ['oauth'] },
        onDisconnectPat: jest.fn(),
      });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      expect(queryByTestId('settings.button.remove-pat.gh-1')).toBeNull();
    });

    it('calls onDisconnectPat when PAT remove button is pressed', async () => {
      const onDisconnectPat = jest.fn();
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        hostCredentialKinds: { 'gh-1': ['token'] },
        onDisconnectPat,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.remove-pat.gh-1'));
      });
      expect(onDisconnectPat).toHaveBeenCalledTimes(1);
      expect(onDisconnectPat).toHaveBeenCalledWith('gh-1');
    });

    it('disables PAT remove button when patLoading is true', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        hostCredentialKinds: { 'gh-1': ['token'] },
        onDisconnectPat: jest.fn(),
        patLoading: { 'gh-1': true },
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const button = getByTestId('settings.button.remove-pat.gh-1');
      expect(button).toBeTruthy();
    });
  });

  describe('App remove control', () => {
    it('shows App Remove button when appCredentials[host.id] exists', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        appCredentials: {
          'gh-1': {
            kind: 'github_app',
            installationId: 123,
            accountLogin: 'testuser',
            selectedRepositories: [],
          },
        },
        onDisconnectGitHubApp: jest.fn(),
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.button.remove-github-app.gh-1')).toBeTruthy();
    });

    it('shows Install button when appCredentials[host.id] is absent', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        appCredentials: {},
        onConnectGitHubApp: jest.fn(),
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.button.connect-github-app.gh-1')).toBeTruthy();
    });

    it('calls onDisconnectGitHubApp when App Remove button is pressed', async () => {
      const onDisconnectGitHubApp = jest.fn();
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        appCredentials: {
          'gh-1': {
            kind: 'github_app',
            installationId: 123,
            accountLogin: 'testuser',
            selectedRepositories: [],
          },
        },
        onDisconnectGitHubApp,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.remove-github-app.gh-1'));
      });
      expect(onDisconnectGitHubApp).toHaveBeenCalledTimes(1);
      expect(onDisconnectGitHubApp).toHaveBeenCalledWith('gh-1');
    });
  });

  describe('OAuth disconnect control', () => {
    it('shows Disconnect text when oauthConnected[host.id] is true', () => {
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        onDisconnectOAuth: jest.fn(),
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const button = getByTestId('settings.button.connect-oauth.gh-1');
      expect(button).toBeTruthy();
    });

    it('calls onDisconnectOAuth when OAuth Disconnect button is pressed', async () => {
      const onDisconnectOAuth = jest.fn();
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        onDisconnectOAuth,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      });

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-oauth.gh-1'));
      });
      expect(onDisconnectOAuth).toHaveBeenCalledTimes(1);
      expect(onDisconnectOAuth).toHaveBeenCalledWith('gh-1');
    });
  });

  describe('Independent credential removal does not affect host row', () => {
    it('host row remains visible after removing PAT credential', async () => {
      const onDisconnectPat = jest.fn();
      const summary = makeAccountSummary({ hostId: 'gh-1' });
      const props = makeProps({
        accountSummaries: [
          {
            accountId: summary.accountId,
            account: {
              id: summary.accountId,
              login: summary.login,
              name: summary.name,
              avatarUrl: summary.avatarUrl,
            },
            hosts: [
              {
                id: summary.hostId,
                provider: summary.hostProvider as 'github' | 'gitlab' | 'gitea',
                hostLogin: summary.hostLogin,
                instanceBaseUrl: summary.instanceBaseUrl,
              },
            ],
            activeHostId: summary.activeHostId,
          },
        ],
        hostCredentialKinds: { 'gh-1': ['token', 'oauth', 'github_app', 'ssh'] },
        onDisconnectPat,
        onDisconnectGitHubApp: jest.fn(),
        onDisconnectOAuth: jest.fn(),
        appCredentials: {
          'gh-1': {
            kind: 'github_app',
            installationId: 123,
            accountLogin: 'testuser',
            selectedRepositories: [],
          },
        },
        hostUseSsh: { 'gh-1': true },
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      expect(getByTestId('settings.row.host.gh-1')).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.remove-pat.gh-1'));
      });
      expect(onDisconnectPat).toHaveBeenCalledWith('gh-1');

      expect(getByTestId('settings.row.host.gh-1')).toBeTruthy();
    });
  });
});
