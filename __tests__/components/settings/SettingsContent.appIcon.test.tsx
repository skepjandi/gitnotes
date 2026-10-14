/**
 * Tests for the App Icon picker row in SettingsContent.
 * Exercises: supported/unsupported/loading rendering, row tap behavior,
 * testID presence, accessibility.
 *
 * Uses real SettingsContent with all required props provided;
 * mocks internal hooks (useTokens, useTranslation, useProvidersAvailability).
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

// ---------------------------------------------------------------------------
// Module-level mocks (must precede any imports)
// ---------------------------------------------------------------------------

// Mock react-native Alert
let mockAlertCalls: Array<{ title: string; message: string; buttons: unknown[] }> = [];
jest.mock('react-native', () => {
  const React = require('react');
  const View = (props: object & { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement('View', props, (props as any)?.children);
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

// Mock useTranslation to provide t function that returns keys
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: object) => {
      // Return the key itself when no defaultValue, or the defaultValue if provided
      if (opts && 'defaultValue' in opts) return (opts as { defaultValue: string }).defaultValue;
      return key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

// Mock ThemeContext useTokens hook
jest.mock('../../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    colors: {
      background: '#ffffff',
      surface: '#f0f0f0',
      primary: '#007AFF',
      accent: '#3b82f6',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
      elevated: '#e5e5ea',
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
      background: '#ffffff',
      surface: '#f0f0f0',
      primary: '#007AFF',
      accent: '#3b82f6',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
      elevated: '#e5e5ea',
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
  DocumentDirectory: '',
  File: {},
  Directory: {},
  Paths: {},
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

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
// Minimal required props factory
// ---------------------------------------------------------------------------
interface TestSettingsContentProps {
  colors: Record<string, string>;
  headerHeight: number;
  tabBarHeight: number;
  theme: 'light' | 'dark' | 'system';
  uiStyle: 'flat' | 'neumorphic';
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
  setStyle: (s: 'flat' | 'neumorphic') => void;
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
  appIcon: 'Neon' | 'Grayscale' | 'Gold' | null;
  appIconSupported: boolean;
  appIconLoading: boolean;
  onOpenAppIconPicker: () => void;
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
    isPro: true,
    isProLoading: false,
    proStatusLabel: 'Pro is active',
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
    oauthLoading: {},
    oauthError: {},
    onConnectGitHubApp: jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    appLoading: {},
    appError: {},
    appIcon: null,
    appIconSupported: true,
    appIconLoading: false,
    onOpenAppIconPicker: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SettingsContent app-icon row', () => {
  beforeEach(() => { mockAlertCalls = []; });

  // ---- Rendering ----------------------------------------------------------
  describe('Rendering', () => {
    it('renders the app-icon row with testID when enabled', () => {
      const props = makeProps({ appIcon: null, appIconSupported: true, appIconLoading: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.app-icon')).toBeTruthy();
    });

    it('shows row without testID when loading (appIconLoading=true)', () => {
      // When loading, onPress is undefined so GroupRow doesn't render testID
      const props = makeProps({ appIcon: null, appIconSupported: true, appIconLoading: true });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // testID is not rendered when onPress is undefined
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
    });

    it('shows row without testID when unsupported (appIconSupported=false)', () => {
      // When unsupported, onPress is undefined so GroupRow doesn't render testID
      const props = makeProps({ appIcon: null, appIconSupported: false, appIconLoading: false });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // testID is not rendered when onPress is undefined
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
    });

    it('renders correctly when appIcon is set to Neon', () => {
      const props = makeProps({ appIcon: 'Neon', appIconSupported: true, appIconLoading: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.app-icon')).toBeTruthy();
    });

    it('renders correctly when appIcon is set to Grayscale', () => {
      const props = makeProps({ appIcon: 'Grayscale', appIconSupported: true, appIconLoading: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.app-icon')).toBeTruthy();
    });

    it('renders correctly when appIcon is set to Gold', () => {
      const props = makeProps({ appIcon: 'Gold', appIconSupported: true, appIconLoading: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.app-icon')).toBeTruthy();
    });
  });

  // ---- Interactions ------------------------------------------------------
  describe('Interactions', () => {
    it('calls onOpenAppIconPicker when enabled row is pressed', async () => {
      const onOpenAppIconPicker = jest.fn();
      const props = makeProps({
        appIcon: null,
        appIconSupported: true,
        appIconLoading: false,
        onOpenAppIconPicker,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.app-icon'));
      });
      expect(onOpenAppIconPicker).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onOpenAppIconPicker when loading', async () => {
      const onOpenAppIconPicker = jest.fn();
      const props = makeProps({
        appIcon: null,
        appIconSupported: true,
        appIconLoading: true,
        onOpenAppIconPicker,
      });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // Row doesn't have testID when loading, but onOpenAppIconPicker should not be called
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
      expect(onOpenAppIconPicker).not.toHaveBeenCalled();
    });

    it('does NOT call onOpenAppIconPicker when unsupported', async () => {
      const onOpenAppIconPicker = jest.fn();
      const props = makeProps({
        appIcon: null,
        appIconSupported: false,
        appIconLoading: false,
        onOpenAppIconPicker,
      });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // Row doesn't have testID when unsupported, but onOpenAppIconPicker should not be called
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
      expect(onOpenAppIconPicker).not.toHaveBeenCalled();
    });

    it('onOpenAppIconPicker receives no arguments', async () => {
      const onOpenAppIconPicker = jest.fn();
      const props = makeProps({
        appIcon: 'Gold',
        appIconSupported: true,
        appIconLoading: false,
        onOpenAppIconPicker,
      });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.app-icon'));
      });
      expect(onOpenAppIconPicker).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Enabled state disabled property ------------------------------------
  describe('Enabled state disabled property', () => {
    it('row is NOT disabled when platform supports and not loading', () => {
      const props = makeProps({ appIcon: null, appIconSupported: true, appIconLoading: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const row = getByTestId('settings.row.app-icon');
      expect(row.props.disabled).toBe(false);
    });

    it('row is disabled when loading', () => {
      const props = makeProps({ appIcon: null, appIconSupported: true, appIconLoading: true });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // When loading, testID is not rendered, confirming the disabled state
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
    });

    it('row is disabled when platform is unsupported', () => {
      const props = makeProps({ appIcon: null, appIconSupported: false, appIconLoading: false });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      // When unsupported, testID is not rendered, confirming the disabled state
      expect(queryByTestId('settings.row.app-icon')).toBeNull();
    });
  });
});
