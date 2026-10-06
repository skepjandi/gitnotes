/**
 * Regression test: global GitHub App install action must be available even when
 * accountSummaries is non-empty.
 *
 * Root cause: SettingsContent.tsx only renders settings.button.install-github-app
 * inside the `accountSummaries.length === 0` branch. When a user already has
 * accounts connected, the global "Install GitHub App" action (which calls
 * onConnectGitHubApp(null) for a fresh install) disappears — only per-host
 * "Install" buttons remain. This test proves the button is absent for existing
 * accounts in current production code.
 *
 * Test IDs:
 *   settings.button.install-github-app  → global GitHub App install (null host)
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

// ---------------------------------------------------------------------------
// Module-level mocks (must precede any imports)
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
  onConnectOAuth: (hostId: string | null) => void;
  onDisconnectOAuth: (hostId: string) => void;
  oauthLoading: Record<string, boolean>;
  oauthError: Record<string, string | null>;
  onConnectGitHubApp: (hostId: string | null) => void;
  onDisconnectGitHubApp: (hostId: string) => void;
  appLoading: Record<string, boolean>;
  appError: Record<string, string | null>;
  appCredentials: Record<string, unknown | null>;
}

// Minimal AccountSummaryViewModel shape that matches SettingsContent's internal types
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
    onConnectOAuth: jest.fn(),
    onDisconnectOAuth: jest.fn(),
    oauthLoading: { '__fresh__': false },
    oauthError: { '__fresh__': null },
    onConnectGitHubApp: jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    appLoading: { '__fresh__': false },
    appError: { '__fresh__': null },
    appCredentials: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Global GitHub App install action with existing accounts', () => {
  beforeEach(() => {
    mockAlertCalls = [];
  });

  /**
   * REGRESSION PROOF: When accountSummaries is empty (fresh install), the global
   * "Install GitHub App" button must be visible.
   */
  it('renders global install-github-app button when accountSummaries is empty', () => {
    const onConnectGitHubApp = jest.fn();
    const props = makeProps({
      accountSummaries: [],
      onConnectGitHubApp,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);
    expect(getByTestId('settings.button.install-github-app')).toBeTruthy();
  });

  /**
   * REGRESSION PROOF: When accountSummaries is empty and the user presses the
   * global install button, onConnectGitHubApp(null) must be called.
   */
  it('calls onConnectGitHubApp(null) when global install-github-app is pressed (empty accounts)', async () => {
    const onConnectGitHubApp = jest.fn();
    const props = makeProps({
      accountSummaries: [],
      onConnectGitHubApp,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    await act(async () => {
      fireEvent.press(getByTestId('settings.button.install-github-app'));
    });
    expect(onConnectGitHubApp).toHaveBeenCalledTimes(1);
    expect(onConnectGitHubApp).toHaveBeenCalledWith(null);
  });

  /**
   * REGRESSION TEST (FAILS on current production code):
   *
   * When accountSummaries has at least one connected account, the global GitHub
   * App install action (settings.button.install-github-app) must STILL be visible.
   * The button allows installing the GitHub App for an additional account via
   * onConnectGitHubApp(null).
   *
   * Current bug: SettingsContent.tsx only renders this button inside the
   * `accountSummaries.length === 0` branch, so it disappears once the user
   * has any connected account.
   */
  it('renders global install-github-app button when accountSummaries is non-empty', () => {
    const onConnectGitHubApp = jest.fn();
    const summary = makeAccountSummary();
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
      activeAccountId: summary.accountId,
      onConnectGitHubApp,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);
    // This assertion FAILS in production — the button is only rendered when accountSummaries.length === 0
    expect(getByTestId('settings.button.install-github-app')).toBeTruthy();
  });

  /**
   * Free user with existing accounts: GitHub App install via __new__ identity is gated.
   * The button is visible (per commit 41d3c0c9), but pressing it triggers the paywall
   * because Free limits one account/host identity and __new__ requires Pro.
   */
  it('Free user with existing accounts calls onOpenPaywall (not onConnectGitHubApp) when global install-github-app is pressed', async () => {
    const onOpenPaywall = jest.fn();
    const onConnectGitHubApp = jest.fn();
    const summary = makeAccountSummary();
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
      activeAccountId: summary.accountId,
      isPro: false,
      onOpenPaywall,
      onConnectGitHubApp,
    });
    const { getByTestId } = render(<SettingsContent {...props} />);

    await act(async () => {
      fireEvent.press(getByTestId('settings.button.install-github-app'));
    });
    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
    expect(onConnectGitHubApp).not.toHaveBeenCalled();
  });
});
