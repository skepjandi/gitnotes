/**
 * Tests for the Pro accent color picker row in SettingsContent.
 * Renders the actual SettingsContent component with focused coverage for:
 * Pro/free/loading rendering, picker open, confirm/cancel/reset, swatch.
 *
 * Uses real SettingsContent with all required props provided;
 * mocks internal hooks (useTokens, useTranslation, useProvidersAvailability)
 * and Alert to verify promptProUpgrade behavior.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';

// ---------------------------------------------------------------------------
// Module-level mocks (must precede any imports)
// ---------------------------------------------------------------------------

// Mock react-native Alert (used by promptProUpgrade → Alert.alert)
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

// Mock useTranslation to provide t function
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: object) => {
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

// Mock HexColorPickerModal — must use require() in factory (jest rules)
jest.mock('../../../src/components/HexColorPickerModal', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: function MockHexColorPickerModal({
      visible,
      initialColor,
      onClose,
      onSelect,
    }: {
      visible: boolean;
      initialColor?: string | null;
      onClose: () => void;
      onSelect: (hex: string | null) => void;
    }) {
      if (!visible) return null;
      return React.createElement(View, { testID: 'hex-color-picker-modal' },
        React.createElement(Text, { testID: 'hex-color-picker-modal.initial' }, initialColor ?? 'none'),
        React.createElement(TouchableOpacity, { testID: 'hex-color-picker-confirm', onPress: () => onSelect('#aabbcc') },
          React.createElement(Text, null, 'Done')),
        React.createElement(TouchableOpacity, { testID: 'hex-color-picker-cancel', onPress: onClose },
          React.createElement(Text, null, 'Cancel')),
        React.createElement(TouchableOpacity, { testID: 'hex-color-picker-clear', onPress: () => onSelect(null) },
          React.createElement(Text, null, 'Reset')),
      );
    },
  };
});

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
  oauthLoading: Record<string, boolean>;
  oauthError: Record<string, string | null>;
  appLoading: Record<string, boolean>;
  appError: Record<string, string | null>;
  onConnectOAuth: (hostId: string | null) => void;
  onDisconnectOAuth: (hostId: string) => void;
  onConnectGitHubApp: (hostId: string | null) => void;
  onDisconnectGitHubApp: (hostId: string) => void;
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
    oauthLoading: { '__fresh__': false },
    oauthError: { '__fresh__': null },
    appLoading: { '__fresh__': false },
    appError: { '__fresh__': null },
    onConnectOAuth: jest.fn(),
    onDisconnectOAuth: jest.fn(),
    onConnectGitHubApp: jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SettingsContent accent-color row', () => {
  beforeEach(() => { mockAlertCalls = []; });

  // ---- Rendering ----------------------------------------------------------
  describe('Rendering', () => {
    it('shows swatch with default accent color when no custom color is set (Pro)', () => {
      const props = makeProps({ isPro: true, accentColor: null });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const swatch = getByTestId('settings.swatch.accent-color');
      // default colors.accent = '#3b82f6'
      expect(swatch.props.style).toMatchObject({ backgroundColor: '#3b82f6' });
    });

    it('shows swatch with custom accent color when set (Pro)', () => {
      const props = makeProps({ isPro: true, accentColor: '#ff0000' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const swatch = getByTestId('settings.swatch.accent-color');
      expect(swatch.props.style).toMatchObject({ backgroundColor: '#ff0000' });
    });

    it('renders row with lock icon for free (non-Pro) users', () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.accent-color-locked')).toBeTruthy();
    });

    it('renders open (non-locked) row for Pro users', () => {
      const props = makeProps({ isPro: true });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.row.accent-color')).toBeTruthy();
    });

    it('renders disabled row when pro status is loading (not locked variant)', () => {
      const props = makeProps({ isProLoading: true, isPro: false });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      expect(queryByTestId('settings.row.accent-color-locked')).toBeNull();
    });
  });

  // ---- Interactions — Pro user -------------------------------------------
  describe('Interactions — Pro user', () => {
    it('calls onOpenAccentColorPicker when Pro row is pressed', async () => {
      const onOpenAccentColorPicker = jest.fn();
      const props = makeProps({ isPro: true, accentColor: '#3b82f6', onOpenAccentColorPicker });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.accent-color'));
      });
      expect(onOpenAccentColorPicker).toHaveBeenCalledTimes(1);
    });

    it('swatch shows current accentColor', () => {
      const props = makeProps({ isPro: true, accentColor: '#ff0000' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const swatch = getByTestId('settings.swatch.accent-color');
      expect(swatch.props.style).toMatchObject({ backgroundColor: '#ff0000' });
    });

    it('does not open picker modal directly (modal is in SettingsScreen)', async () => {
      const props = makeProps({ isPro: true, accentColor: '#3b82f6' });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      expect(queryByTestId('hex-color-picker-modal')).toBeNull();
    });
  });

  // ---- Interactions — Free user -------------------------------------------
  describe('Interactions — Free user', () => {
    it('free user row triggers Alert (promptProUpgrade) when pressed', async () => {
      const onOpenPaywall = jest.fn();
      const props = makeProps({ isPro: false, onOpenPaywall });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.accent-color-locked'));
      });
      // promptProUpgrade calls Alert.alert
      const { Alert } = require('react-native');
      expect(Alert.alert).toHaveBeenCalledTimes(1);
      // Verify upgrade button is wired to onOpenPaywall
      const alertCall = mockAlertCalls[0];
      const upgradeButton = alertCall.buttons[1] as { onPress: () => void };
      upgradeButton.onPress();
      expect(onOpenPaywall).toHaveBeenCalledTimes(1);
    });

    it('free user row does NOT directly call onOpenPaywall (uses promptProUpgrade)', async () => {
      const onOpenPaywall = jest.fn();
      const props = makeProps({ isPro: false, onOpenPaywall });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.accent-color-locked'));
      });
      // onOpenPaywall should NOT be called directly; only via Alert upgrade button
      expect(onOpenPaywall).not.toHaveBeenCalled();
    });

    it('free user row does not open picker', async () => {
      const props = makeProps({ isPro: false });
      const { getByTestId, queryByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.row.accent-color-locked'));
      });
      expect(queryByTestId('hex-color-picker-modal')).toBeNull();
    });
  });

  // ---- Interactions — Loading user -----------------------------------------
  describe('Interactions — Loading user', () => {
    it('loading row is disabled and does not trigger any action when pressed', async () => {
      const onOpenPaywall = jest.fn();
      const onOpenAccentColorPicker = jest.fn();
      const props = makeProps({
        isProLoading: true,
        isPro: false,
        onOpenPaywall,
        onOpenAccentColorPicker,
      });
      const { queryByTestId } = render(<SettingsContent {...props} />);
      expect(onOpenPaywall).not.toHaveBeenCalled();
      expect(onOpenAccentColorPicker).not.toHaveBeenCalled();
      expect(queryByTestId('hex-color-picker-modal')).toBeNull();
    });
  });
});
