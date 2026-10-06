/**
 * Regression and behavior tests for fresh-identity entry points in SettingsContent.
 *
 * Covers:
 * - OAuth "Connect with GitHub" fresh-identity button for Free users with existing accounts
 *   → should show lock icon and trigger paywall, NOT call onConnectOAuth(null)
 * - GitHub App "Install" fresh-identity button for Free users with existing accounts
 *   → should show lock icon and trigger paywall, NOT call onConnectGitHubApp(null)
 * - Pro users: same buttons should call the handlers directly
 * - Existing-host OAuth/App controls remain enabled for Free (hostId !== null path)
 *
 * Test IDs referenced:
 *   settings.button.connect-github-oauth-existing  → OAuth fresh-identity row (existing accounts)
 *   settings.button.install-github-app            → GitHub App fresh-identity row
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

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
  FREE_TIER_MAX_ACCOUNTS: 1,
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

function makeProps(overrides: Partial<React.ComponentProps<typeof SettingsContent> & {
  isPro?: boolean;
  isProLoading?: boolean;
  accountSummaries?: Array<ReturnType<typeof makeAccountSummaryView>>;
  onConnectOAuth?: jest.Mock;
  onConnectGitHubApp?: jest.Mock;
  onAddHost?: jest.Mock;
  onAddHostLocked?: jest.Mock;
  onOpenPaywall?: jest.Mock;
  oauthLoading?: Record<string, boolean>;
  appLoading?: Record<string, boolean>;
}> = {}) {
  const isPro = overrides.isPro ?? false;
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
    onAddHost: overrides.onAddHost ?? jest.fn(),
    onAddHostLocked: overrides.onAddHostLocked ?? jest.fn(),
    accountSummaries: overrides.accountSummaries ?? [],
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
    isPro,
    isProLoading: overrides.isProLoading ?? false,
    proStatusLabel: isPro ? 'Pro' : 'Upgrade',
    onOpenPaywall: overrides.onOpenPaywall ?? jest.fn(),
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
    onConnectOAuth: overrides.onConnectOAuth ?? jest.fn(),
    onDisconnectOAuth: jest.fn(),
    oauthLoading: overrides.oauthLoading ?? { '__fresh__': false },
    oauthError: { '__fresh__': null },
    onConnectGitHubApp: overrides.onConnectGitHubApp ?? jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    appLoading: overrides.appLoading ?? { '__fresh__': false },
    appError: { '__fresh__': null },
    appCredentials: {},
    hostCredentialKinds: {},
    onDisconnectPat: jest.fn(),
    patLoading: {},
    patError: {},
    ...overrides,
  } as React.ComponentProps<typeof SettingsContent>;
}

// ---------------------------------------------------------------------------
// Tests: Fresh identity entry points
// ---------------------------------------------------------------------------

describe('Fresh identity entry points — Free user with existing accounts', () => {
  const existingAccountSummary = [makeAccountSummaryView('gh-host-1', 'acc-1')];

  it('OAuth existing-accounts button calls onOpenPaywall (not onConnectOAuth) for non-Pro users', async () => {
    const onConnectOAuth = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      onConnectOAuth,
      onOpenPaywall,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.connect-github-oauth-existing');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
    expect(onConnectOAuth).not.toHaveBeenCalled();
  });

  it('GitHub App install button calls onOpenPaywall (not onConnectGitHubApp) for non-Pro users with existing accounts', async () => {
    const onConnectGitHubApp = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      onConnectGitHubApp,
      onOpenPaywall,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.install-github-app');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
    expect(onConnectGitHubApp).not.toHaveBeenCalled();
  });

  it('GitHub App install button is pressable for non-Pro users with existing accounts', async () => {
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    expect(getByTestId('settings.button.install-github-app')).toBeTruthy();
  });
});

describe('Fresh identity entry points — Pro user', () => {
  const existingAccountSummary = [makeAccountSummaryView('gh-host-1', 'acc-1')];

  it('OAuth existing-accounts button calls onConnectOAuth(null) for Pro users', async () => {
    const onConnectOAuth = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = makeProps({
      isPro: true,
      accountSummaries: existingAccountSummary,
      onConnectOAuth,
      onOpenPaywall,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.connect-github-oauth-existing');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onConnectOAuth).toHaveBeenCalledTimes(1);
    expect(onConnectOAuth).toHaveBeenCalledWith(null);
    expect(onOpenPaywall).not.toHaveBeenCalled();
  });

  it('GitHub App install button calls onConnectGitHubApp(null) for Pro users', async () => {
    const onConnectGitHubApp = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = makeProps({
      isPro: true,
      accountSummaries: existingAccountSummary,
      onConnectGitHubApp,
      onOpenPaywall,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.install-github-app');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onConnectGitHubApp).toHaveBeenCalledTimes(1);
    expect(onConnectGitHubApp).toHaveBeenCalledWith(null);
    expect(onOpenPaywall).not.toHaveBeenCalled();
  });
});

describe('Fresh identity entry points — Free user with NO accounts (first identity allowed)', () => {
  it('OAuth button with no accounts renders and is pressable', async () => {
    const onConnectOAuth = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: [],
      onConnectOAuth,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.connect-github-oauth');
    expect(button).toBeTruthy();
    await act(async () => {
      fireEvent.press(button);
    });
    expect(onConnectOAuth).toHaveBeenCalledWith(null);
  });

  it('GitHub App install button is always rendered (outside accounts conditional) and calls onConnectGitHubApp(null) for non-Pro users with NO accounts (first identity allowed)', async () => {
    const onConnectGitHubApp = jest.fn();
    const onOpenPaywall = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: [],
      onConnectGitHubApp,
      onOpenPaywall,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.install-github-app');
    expect(button).toBeTruthy();
    await act(async () => {
      fireEvent.press(button);
    });
    expect(onConnectGitHubApp).toHaveBeenCalledTimes(1);
    expect(onConnectGitHubApp).toHaveBeenCalledWith(null);
    expect(onOpenPaywall).not.toHaveBeenCalled();
  });

  it('Connect Host button with no accounts renders and calls onAddHost', async () => {
    const onAddHost = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: [],
      onAddHost,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.connect-host');
    expect(button).toBeTruthy();
    await act(async () => {
      fireEvent.press(button);
    });
    expect(onAddHost).toHaveBeenCalledTimes(1);
  });
});

describe('Connect Host button — Free vs Pro with existing accounts', () => {
  const existingAccountSummary = [makeAccountSummaryView('gh-host-1', 'acc-1')];

  it('Connect Host calls onAddHostLocked (not onAddHost) for non-Pro users with existing accounts', async () => {
    const onAddHost = jest.fn();
    const onAddHostLocked = jest.fn();
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      onAddHost,
      onAddHostLocked,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.row.connect-host-locked');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onAddHostLocked).toHaveBeenCalledTimes(1);
    expect(onAddHost).not.toHaveBeenCalled();
  });

  it('Connect Host calls onAddHost for Pro users with existing accounts', async () => {
    const onAddHost = jest.fn();
    const onAddHostLocked = jest.fn();
    const props = makeProps({
      isPro: true,
      accountSummaries: existingAccountSummary,
      onAddHost,
      onAddHostLocked,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    const button = getByTestId('settings.button.connect-host');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(onAddHost).toHaveBeenCalledTimes(1);
    expect(onAddHostLocked).not.toHaveBeenCalled();
  });
});

describe('Existing-host credential controls remain enabled for Free users', () => {
  const existingAccountSummary = [makeAccountSummaryView('gh-host-1', 'acc-1')];

  it('OAuth disconnect button is present for Free users on existing host', async () => {
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      hostCredentialKinds: { 'gh-host-1': ['oauth'] },
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    expect(getByTestId('settings.button.connect-oauth.gh-host-1')).toBeTruthy();
  });

  it('PAT remove button is present for Free users on existing host', async () => {
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      hostCredentialKinds: { 'gh-host-1': ['token'] },
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    expect(getByTestId('settings.button.remove-pat.gh-host-1')).toBeTruthy();
  });

  it('GitHub App Remove button is present for Free users on existing host', async () => {
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      appCredentials: {
        'gh-host-1': {
          kind: 'github_app',
          installationId: 123,
          accountLogin: 'testuser',
          selectedRepositories: [],
        },
      },
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    expect(getByTestId('settings.button.remove-github-app.gh-host-1')).toBeTruthy();
  });

  it('SSH toggle is present for Free users on existing host', async () => {
    const props = makeProps({
      isPro: false,
      accountSummaries: existingAccountSummary,
      hostUseSsh: { 'gh-host-1': false },
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    expect(getByTestId('settings.row.host.gh-host-1.ssh')).toBeTruthy();
  });
});
