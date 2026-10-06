/**
 * Free/Pro Identity Gate consumer regression tests.
 *
 * Covers the UI-layer paywall decisions driven by `isPro` and the
 * `canCreateAdditionalIdentity()` policy seam:
 *
 * - Free user with existing account: Add Host → onAddHostLocked (paywall), NOT onAddHost
 * - Free user with existing account: Connect OAuth (fresh) → onOpenPaywall, NOT onConnectOAuth(null)
 * - Free user with existing account: Install GitHub App (fresh) → onOpenPaywall, NOT onConnectGitHubApp(null)
 * - Pro user with existing account: Add Host → onAddHost (direct)
 * - Pro user with existing account: Connect OAuth (fresh) → onConnectOAuth(null)
 * - Pro user with existing account: Install GitHub App (fresh) → onConnectGitHubApp(null)
 * - Same-host credential operations (OAuth, App, PAT, SSH) remain allowed for Free users
 * - Same-host SSH toggle remains functional for Free users
 *
 * These tests render SettingsContent with minimal mocks and assert
 * callback invocations and testID presence rather than snapshots.
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
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    type: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20 },
    radii: { sm: 4, md: 8, lg: 12 },
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
// Shared prop factory
// ---------------------------------------------------------------------------

function makeAccountSummaryView(hostId: string, accountId: string) {
  return {
    accountId,
    account: { id: accountId, login: accountId, name: accountId, avatarUrl: null },
    hosts: [{ id: hostId, provider: 'github' as const, hostLogin: accountId, instanceBaseUrl: null }],
    activeHostId: hostId,
  };
}

function makeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    colors: {
      background: '#ffffff', surface: '#f0f0f0', primary: '#007AFF', accent: '#3b82f6',
      text: '#000000', textSecondary: '#666666', border: '#cccccc', error: '#FF3B30', elevated: '#e5e5ea',
    },
    headerHeight: 100,
    tabBarHeight: 80,
    theme: 'light' as const,
    uiStyle: 'flat' as const,
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
    actionMode: 'auto' as const,
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

describe('Free/Pro identity gate consumer behavior', () => {
  describe('Add Host button (accountSummaries.length > 0)', () => {
    it('Free user (isPro=false) with existing account sees locked testID', () => {
      const props = makeProps({
        isPro: false,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.connect-host-locked')).toBeTruthy();
    });

    it('Free user (isPro=false) with existing account does NOT show unlocked connect-host button', () => {
      const props = makeProps({
        isPro: false,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
      });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      expect(queryByTestId('settings.button.connect-host')).toBeNull();
    });

    it('Free user (isPro=false) with existing account calls onAddHostLocked (paywall), NOT onAddHost', async () => {
      const onAddHost = jest.fn();
      const onAddHostLocked = jest.fn();
      const props = makeProps({
        isPro: false,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onAddHost,
        onAddHostLocked,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.connect-host-locked'));
      });

      expect(onAddHostLocked).toHaveBeenCalledTimes(1);
      expect(onAddHost).not.toHaveBeenCalled();
    });

    it('Pro user (isPro=true) with existing account sees unlocked connect-host button', () => {
      const props = makeProps({
        isPro: true,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
      });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.button.connect-host')).toBeTruthy();
    });

    it('Pro user (isPro=true) with existing account calls onAddHost directly', async () => {
      const onAddHost = jest.fn();
      const props = makeProps({
        isPro: true,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onAddHost,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-host'));
      });

      expect(onAddHost).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fresh OAuth button (accountSummaries.length > 0)', () => {
    it('Free user (isPro=false) with existing account calls onOpenPaywall when pressing fresh OAuth button', async () => {
      const onConnectOAuth = jest.fn();
      const onOpenPaywall = jest.fn();
      const props = makeProps({
        isPro: false,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onConnectOAuth,
        onOpenPaywall,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-github-oauth-existing'));
      });

      expect(onOpenPaywall).toHaveBeenCalledTimes(1);
      expect(onConnectOAuth).not.toHaveBeenCalled();
    });

    it('Pro user (isPro=true) with existing account calls onConnectOAuth(null) when pressing fresh OAuth button', async () => {
      const onConnectOAuth = jest.fn();
      const props = makeProps({
        isPro: true,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onConnectOAuth,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.connect-github-oauth-existing'));
      });

      expect(onConnectOAuth).toHaveBeenCalledTimes(1);
      expect(onConnectOAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('Fresh GitHub App button (accountSummaries.length > 0)', () => {
    it('Free user (isPro=false) with existing account calls onOpenPaywall when pressing Install GitHub App', async () => {
      const onConnectGitHubApp = jest.fn();
      const onOpenPaywall = jest.fn();
      const props = makeProps({
        isPro: false,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onConnectGitHubApp,
        onOpenPaywall,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.install-github-app'));
      });

      expect(onOpenPaywall).toHaveBeenCalledTimes(1);
      expect(onConnectGitHubApp).not.toHaveBeenCalled();
    });

    it('Pro user (isPro=true) with existing account calls onConnectGitHubApp(null) when pressing Install GitHub App', async () => {
      const onConnectGitHubApp = jest.fn();
      const props = makeProps({
        isPro: true,
        accountSummaries: [makeAccountSummaryView('gh-1', 'account-1')],
        onConnectGitHubApp,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.button.install-github-app'));
      });

      expect(onConnectGitHubApp).toHaveBeenCalledTimes(1);
      expect(onConnectGitHubApp).toHaveBeenCalledWith(null);
    });
  });

  describe('Same-host credential operations (always allowed for Free)', () => {
    const GITHUB_HOST_ID = 'gh-1';

    function makeHostCredentialProps(hostId: string, credentialKinds: Array<'token' | 'oauth' | 'github_app' | 'ssh'> = []) {
      return makeProps({
        isPro: false, // Free user
        accountSummaries: [makeAccountSummaryView(hostId, 'account-1')],
        hostCredentialKinds: { [hostId]: credentialKinds },
        hostUseSsh: { [hostId]: credentialKinds.includes('ssh') },
        oauthConnected: { [hostId]: credentialKinds.includes('oauth') },
        appCredentials: credentialKinds.includes('github_app')
          ? {
              [hostId]: {
                kind: 'github_app' as const,
                installationId: 123,
                accountLogin: 'testuser',
                selectedRepositories: [],
              },
            }
          : {},
        onConnectOAuth: jest.fn(),
        onDisconnectOAuth: jest.fn(),
        onConnectGitHubApp: jest.fn(),
        onDisconnectGitHubApp: jest.fn(),
        onDisconnectPat: jest.fn(),
        onToggleSSH: jest.fn(),
      });
    }

    it('Free user can add OAuth credential on same existing host (onConnectOAuth called with hostId)', async () => {
      const onConnectOAuth = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['token']);
      (props as Record<string, unknown>).onConnectOAuth = onConnectOAuth;
      const { getByTestId } = render(<SettingsContent {...props} />);

      const oauthButton = getByTestId(`settings.button.connect-oauth.${GITHUB_HOST_ID}`);
      await act(async () => {
        fireEvent.press(oauthButton);
      });

      expect(onConnectOAuth).toHaveBeenCalledTimes(1);
      expect(onConnectOAuth).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });

    it('Free user can add GitHub App credential on same existing host (onConnectGitHubApp called with hostId)', async () => {
      const onConnectGitHubApp = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['token']);
      (props as Record<string, unknown>).onConnectGitHubApp = onConnectGitHubApp;
      const { getByTestId } = render(<SettingsContent {...props} />);

      const appButton = getByTestId(`settings.button.connect-github-app.${GITHUB_HOST_ID}`);
      await act(async () => {
        fireEvent.press(appButton);
      });

      expect(onConnectGitHubApp).toHaveBeenCalledTimes(1);
      expect(onConnectGitHubApp).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });

    it('Free user can remove PAT credential on same existing host (onDisconnectPat called with hostId)', async () => {
      const onDisconnectPat = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['token', 'oauth']);
      (props as Record<string, unknown>).onDisconnectPat = onDisconnectPat;
      const { getByTestId } = render(<SettingsContent {...props} />);

      const patButton = getByTestId('settings.button.remove-pat.gh-1');
      await act(async () => {
        fireEvent.press(patButton);
      });

      expect(onDisconnectPat).toHaveBeenCalledTimes(1);
      expect(onDisconnectPat).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });

    it('Free user can toggle SSH on same existing host (onToggleSSH called with hostId)', async () => {
      const onToggleSSH = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['ssh']);
      (props as Record<string, unknown>).onToggleSSH = onToggleSSH;
      const { getByTestId } = render(<SettingsContent {...props} />);

      const sshToggle = getByTestId(`settings.toggle.ssh.${GITHUB_HOST_ID}`);
      await act(async () => {
        fireEvent(sshToggle, 'valueChange', true);
      });

      expect(onToggleSSH).toHaveBeenCalledTimes(1);
      expect(onToggleSSH).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });

    it('Free user can disconnect OAuth on same existing host (onDisconnectOAuth called with hostId)', async () => {
      const onDisconnectOAuth = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['oauth']);
      (props as Record<string, unknown>).onDisconnectOAuth = onDisconnectOAuth;
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      });

      const oauthButton = getByTestId(`settings.button.connect-oauth.${GITHUB_HOST_ID}`);
      await act(async () => {
        fireEvent.press(oauthButton);
      });

      expect(onDisconnectOAuth).toHaveBeenCalledTimes(1);
      expect(onDisconnectOAuth).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });

    it('Free user can disconnect GitHub App on same existing host (onDisconnectGitHubApp called with hostId)', async () => {
      const onDisconnectGitHubApp = jest.fn();
      const props = makeHostCredentialProps(GITHUB_HOST_ID, ['github_app']);
      (props as Record<string, unknown>).onDisconnectGitHubApp = onDisconnectGitHubApp;
      const { getByTestId } = render(<SettingsContent {...props} />);

      const appButton = getByTestId(`settings.button.remove-github-app.${GITHUB_HOST_ID}`);
      await act(async () => {
        fireEvent.press(appButton);
      });

      expect(onDisconnectGitHubApp).toHaveBeenCalledTimes(1);
      expect(onDisconnectGitHubApp).toHaveBeenCalledWith(GITHUB_HOST_ID);
    });
  });

  describe('All four credential kinds coexist on same host', () => {
    it('renders all four credential rows simultaneously for one host', () => {
      const GITHUB_HOST_ID = 'gh-1';
      const props = makeProps({
        isPro: true,
        accountSummaries: [makeAccountSummaryView(GITHUB_HOST_ID, 'account-1')],
        hostCredentialKinds: { [GITHUB_HOST_ID]: ['token', 'oauth', 'github_app', 'ssh'] },
        hostUseSsh: { [GITHUB_HOST_ID]: true },
        oauthConnected: { [GITHUB_HOST_ID]: true },
        appCredentials: {
          [GITHUB_HOST_ID]: {
            kind: 'github_app' as const,
            installationId: 123,
            accountLogin: 'testuser',
            selectedRepositories: [],
          },
        },
        onDisconnectPat: jest.fn(),
        onDisconnectOAuth: jest.fn(),
        onDisconnectGitHubApp: jest.fn(),
        onToggleSSH: jest.fn(),
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      expect(getByTestId('settings.row.host.gh-1.ssh')).toBeTruthy();
      expect(getByTestId('settings.row.host.gh-1.oauth')).toBeTruthy();
      expect(getByTestId('settings.row.host.gh-1.github-app')).toBeTruthy();
      expect(getByTestId('settings.row.host.gh-1.pat')).toBeTruthy();
    });
  });
});
