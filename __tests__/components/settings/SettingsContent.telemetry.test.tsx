/**
 * Tests for the telemetry opt-out control in SettingsContent.
 *
 * The control is a privacy affordance: it must be reachable by assistive
 * technology, it must say what turning it off actually stops (EAS diagnostics
 * and GitNotēs usage counters), and it must report a save failure without
 * pretending the change was stored.
 *
 * Test IDs:
 *   settings.row.telemetry         → the privacy row
 *   settings.toggle.telemetry      → the switch itself
 *   settings.error.telemetry   → the save-failure message row
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
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

function makeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    proStatusLabel: 'Pro',
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
    appIcon: null,
    appIconSupported: false,
    appIconLoading: false,
    onOpenAppIconPicker: jest.fn(),
    onConnectOAuth: jest.fn(),
    onDisconnectOAuth: jest.fn(),
    oauthLoading: {},
    oauthError: {},
    onConnectGitHubApp: jest.fn(),
    onDisconnectGitHubApp: jest.fn(),
    appLoading: {},
    appError: {},
    appCredentials: {},
    hostCredentialKinds: {},
    onDisconnectPat: jest.fn(),
    patLoading: {},
    patError: {},
    referralProgress: 0,
    referralUnlockedCount: 0,
    onOpenRewardCatalog: jest.fn(),
    telemetryEnabled: true,
    onToggleTelemetry: jest.fn(),
    telemetrySaveError: null,
    ...overrides,
  };
}

describe('SettingsContent telemetry opt-out', () => {
  it('renders the switch with the privacy row', () => {
    const { getByTestId } = render(<SettingsContent {...makeProps()} />);

    expect(getByTestId('settings.row.telemetry')).toBeTruthy();
    expect(getByTestId('settings.toggle.telemetry')).toBeTruthy();
  });

  it('exposes the control as a labelled switch', () => {
    const { getByTestId } = render(<SettingsContent {...makeProps()} />);
    const toggle = getByTestId('settings.toggle.telemetry');

    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityLabel).toBe('Share optional telemetry');
  });

  it('explains that the switch covers EAS diagnostics and usage counters', () => {
    const { getByTestId } = render(<SettingsContent {...makeProps()} />);
    const toggle = getByTestId('settings.toggle.telemetry');

    expect(toggle.props.accessibilityHint).toContain('EAS diagnostics');
    expect(toggle.props.accessibilityHint).toContain('usage counters');
  });

  it('reports the checked state of the switch', () => {
    const { getByTestId, rerender } = render(<SettingsContent {...makeProps({ telemetryEnabled: true })} />);
    expect(getByTestId('settings.toggle.telemetry').props.accessibilityState).toEqual({ checked: true });

    rerender(<SettingsContent {...makeProps({ telemetryEnabled: false })} />);
    expect(getByTestId('settings.toggle.telemetry').props.accessibilityState).toEqual({ checked: false });
  });

  it('reports the opt-out intent when the switch is turned off', () => {
    const onToggleTelemetry = jest.fn();
    const { getByTestId } = render(
      <SettingsContent {...makeProps({ telemetryEnabled: true, onToggleTelemetry })} />,
    );

    fireEvent(getByTestId('settings.toggle.telemetry'), 'valueChange', false);

    expect(onToggleTelemetry).toHaveBeenCalledTimes(1);
    expect(onToggleTelemetry).toHaveBeenCalledWith(false);
  });

  it('reports the opt-in intent when the switch is turned on', () => {
    const onToggleTelemetry = jest.fn();
    const { getByTestId } = render(
      <SettingsContent {...makeProps({ telemetryEnabled: false, onToggleTelemetry })} />,
    );

    fireEvent(getByTestId('settings.toggle.telemetry'), 'valueChange', true);

    expect(onToggleTelemetry).toHaveBeenCalledTimes(1);
    expect(onToggleTelemetry).toHaveBeenCalledWith(true);
  });

  it('shows no save error when the preference was stored', () => {
    const { queryByTestId } = render(<SettingsContent {...makeProps({ telemetrySaveError: null })} />);

    expect(queryByTestId('settings.error.telemetry')).toBeNull();
  });

  it('shows a safe save error when the preference could not be stored', () => {
    const { getByTestId } = render(
      <SettingsContent
        {...makeProps({ telemetrySaveError: "Couldn't save your privacy choice. It stays off for this session." })}
      />,
    );

    expect(getByTestId('settings.error.telemetry')).toBeTruthy();
  });
});
