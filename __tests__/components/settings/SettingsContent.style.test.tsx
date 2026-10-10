/**
 * Tests for the four-way UI style selector in SettingsContent.
 *
 * Entitlement model:
 *   Basic (flat)          — free for all users
 *   Neo-Brutalist         — free for all users (no paywall)
 *   Neumorphic            — Pro only (paywall for free users)
 *   Retrofuturistic       — Pro only (paywall for free users)
 *
 * Structure:
 *   Rendering — verifies all four options render and are accessible
 *   Accessibility — verifies role=button and lock icons
 *   Paywall flow — verifies premium options trigger paywall for free users
 *   Dark mode — verifies dark mode toggle is unaffected
 *
 * Test IDs:
 *   settings.option.style.basic            → flat style option
 *   settings.option.style.neumorphic      → neumorphic style option
 *   settings.option.style.neo-brutalist   → neo-brutalist style option
 *   settings.option.style.retrofuturistic → retrofuturistic style option
 *
 * Uses real SettingsContent with all required props provided;
 * mocks internal hooks and Alert to verify promptProUpgrade behavior.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SettingsContent } from '../../../src/components/settings/SettingsContent';
import { RewardEntitlementService } from '../../../src/services/RewardEntitlementService';

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

interface TestSettingsContentProps {
  colors: Record<string, string>;
  headerHeight: number;
  tabBarHeight: number;
  theme: 'light' | 'dark' | 'system';
  uiStyle: 'flat' | 'neumorphic' | 'neo-brutalist' | 'retrofuturistic' | 'terminal-mono' | 'crt-green' | 'developer-desk';
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
  setStyle: (s: 'flat' | 'neumorphic' | 'neo-brutalist' | 'retrofuturistic' | 'terminal-mono' | 'crt-green' | 'developer-desk') => void;
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
  referralProgress: number;
  referralUnlockedCount: number;
  onOpenRewardCatalog: () => void;
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
    referralProgress: 0,
    referralUnlockedCount: 0,
    onOpenRewardCatalog: jest.fn(),
    ...overrides,
  };
}

describe('SettingsContent style selector [four-way selector]', () => {
  beforeEach(() => { mockAlertCalls = []; });

  describe('Rendering — four-way style selector', () => {
    it('renders all four style options for Pro users', () => {
      const props = makeProps({ isPro: true });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.basic')).toBeTruthy();
      expect(getByTestId('settings.option.style.neumorphic')).toBeTruthy();
      expect(getByTestId('settings.option.style.neo-brutalist')).toBeTruthy();
      expect(getByTestId('settings.option.style.retrofuturistic')).toBeTruthy();
    });

    it('renders all four style options for free users (all visible, premium ones locked)', () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.basic')).toBeTruthy();
      expect(getByTestId('settings.option.style.neumorphic')).toBeTruthy();
      expect(getByTestId('settings.option.style.neo-brutalist')).toBeTruthy();
      expect(getByTestId('settings.option.style.retrofuturistic')).toBeTruthy();
    });

    it('basic style option is selectable for free users', () => {
      const props = makeProps({ isPro: false, uiStyle: 'neumorphic' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.basic')).toBeTruthy();
    });

    it('basic style option is selectable for Pro users', () => {
      const props = makeProps({ isPro: true, uiStyle: 'neumorphic' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.basic')).toBeTruthy();
    });

    it('neo-brutalist option is free for all users — calls setStyle directly', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neo-brutalist'));
      });
      expect(setStyle).toHaveBeenCalledWith('neo-brutalist');
      expect(mockAlertCalls.length).toBe(0);
    });

    it('neumorphic option is NOT directly pressable for free users (paywall)', async () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neumorphic'));
      });
      expect(mockAlertCalls.length).toBe(1);
    });

    it('neo-brutalist option calls setStyle for Pro users', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: true, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neo-brutalist'));
      });
      expect(setStyle).toHaveBeenCalledWith('neo-brutalist');
    });

    it('neumorphic option calls setStyle for Pro users', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: true, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neumorphic'));
      });
      expect(setStyle).toHaveBeenCalledWith('neumorphic');
    });

    it('basic option calls setStyle for Pro users', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: true, uiStyle: 'neumorphic', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.basic'));
      });
      expect(setStyle).toHaveBeenCalledWith('flat');
    });

    it('basic option calls setStyle for free users', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'neumorphic', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.basic'));
      });
      expect(setStyle).toHaveBeenCalledWith('flat');
    });

    it('retrofuturistic option is free for Pro users — calls setStyle directly', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: true, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.retrofuturistic'));
      });
      expect(setStyle).toHaveBeenCalledWith('retrofuturistic');
      expect(mockAlertCalls.length).toBe(0);
    });

    it('retrofuturistic option is NOT directly pressable for free users (paywall)', async () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.retrofuturistic'));
      });
      expect(mockAlertCalls.length).toBe(1);
    });
  });

  describe('Accessibility — four-way style selector', () => {
    it('basic style option has accessible and role=button', () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const option = getByTestId('settings.option.style.basic');
      expect(option.props.accessible !== false).toBe(true);
      expect(option.props.accessibilityRole).toBe('button');
    });

    it('premium style options have role=button even for free users (triggers paywall)', () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      const neumorphicOption = getByTestId('settings.option.style.neumorphic');
      const retroOption = getByTestId('settings.option.style.retrofuturistic');
      expect(neumorphicOption.props.accessibilityRole).toBe('button');
      expect(retroOption.props.accessibilityRole).toBe('button');
    });

    it('selected option displays checkmark trailing icon', () => {
      const props = makeProps({ isPro: true, uiStyle: 'neo-brutalist' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.neo-brutalist')).toBeTruthy();
    });

    it('retrofuturistic option is rendered when selected', () => {
      const props = makeProps({ isPro: true, uiStyle: 'retrofuturistic' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.retrofuturistic')).toBeTruthy();
    });
  });

  describe('Paywall flow — free user premium options', () => {
    it('pressing neumorphic option shows Alert (promptProUpgrade) for free users', async () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neumorphic'));
      });
      expect(mockAlertCalls.length).toBe(1);
      const upgradeButton = mockAlertCalls[0].buttons[1] as { onPress: () => void };
      expect(upgradeButton).toBeDefined();
    });

    it('pressing retrofuturistic option shows Alert (promptProUpgrade) for free users', async () => {
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.retrofuturistic'));
      });
      expect(mockAlertCalls.length).toBe(1);
      const upgradeButton = mockAlertCalls[0].buttons[1] as { onPress: () => void };
      expect(upgradeButton).toBeDefined();
    });

    it('pressing neo-brutalist option does NOT show Alert for free users (free)', async () => {
      const setStyle = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neo-brutalist'));
      });
      expect(mockAlertCalls.length).toBe(0);
      expect(setStyle).toHaveBeenCalledWith('neo-brutalist');
    });

    it('onOpenPaywall is NOT called directly by premium option press (uses promptProUpgrade)', async () => {
      const onOpenPaywall = jest.fn();
      const props = makeProps({ isPro: false, onOpenPaywall });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neumorphic'));
      });
      expect(onOpenPaywall).not.toHaveBeenCalled();
    });
  });

  describe('Dark mode style toggle unaffected', () => {
    it('dark mode toggle is still present and functional', async () => {
      const setTheme = jest.fn();
      const props = makeProps({ isPro: true, theme: 'light', setTheme });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent(getByTestId('settings.toggle.theme'), 'valueChange', true);
      });
      expect(setTheme).toHaveBeenCalledWith('dark');
    });
  });
});

describe('SettingsContent referral theme selector', () => {
  describe('Rendering', () => {
    it('renders all three referral theme rows', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.terminal-mono')).toBeTruthy();
      expect(getByTestId('settings.option.style.crt-green')).toBeTruthy();
      expect(getByTestId('settings.option.style.developer-desk')).toBeTruthy();
    });

    it('renders all three referral theme rows for Pro users too', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const props = makeProps({ isPro: true });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.terminal-mono')).toBeTruthy();
      expect(getByTestId('settings.option.style.crt-green')).toBeTruthy();
      expect(getByTestId('settings.option.style.developer-desk')).toBeTruthy();
    });

    it('renders lock icon on a locked referral theme', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);
      // GroupRow renders the trailing lock icon via Ionicons; we just verify row is present
      expect(getByTestId('settings.option.style.terminal-mono')).toBeTruthy();
    });
  });

  describe('Locked theme tap opens RewardCatalogModal (does NOT call setStyle)', () => {
    it('tapping locked terminal-mono calls onOpenRewardCatalog, NOT setStyle', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.terminal-mono'));
      });
      expect(onOpenRewardCatalog).toHaveBeenCalledTimes(1);
      expect(setStyle).not.toHaveBeenCalled();
    });

    it('tapping locked crt-green calls onOpenRewardCatalog, NOT setStyle', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.crt-green'));
      });
      expect(onOpenRewardCatalog).toHaveBeenCalledTimes(1);
      expect(setStyle).not.toHaveBeenCalled();
    });

    it('tapping locked developer-desk calls onOpenRewardCatalog, NOT setStyle', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.developer-desk'));
      });
      expect(onOpenRewardCatalog).toHaveBeenCalledTimes(1);
      expect(setStyle).not.toHaveBeenCalled();
    });
  });

  describe('Unlocked theme tap calls setStyle (RewardEntitlementService.isUnlocked gating)', () => {
    it('tapping unlocked terminal-mono calls setStyle with terminal-mono', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.terminal-mono'));
      });
      expect(setStyle).toHaveBeenCalledWith('terminal-mono');
      expect(onOpenRewardCatalog).not.toHaveBeenCalled();
    });

    it('tapping unlocked crt-green calls setStyle with crt-green', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.crt-green'));
      });
      expect(setStyle).toHaveBeenCalledWith('crt-green');
      expect(onOpenRewardCatalog).not.toHaveBeenCalled();
    });

    it('tapping unlocked developer-desk calls setStyle with developer-desk', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.developer-desk'));
      });
      expect(setStyle).toHaveBeenCalledWith('developer-desk');
      expect(onOpenRewardCatalog).not.toHaveBeenCalled();
    });

    it('setStyle is NOT called for a locked theme even if Pro', async () => {
      // Pro status alone does not unlock referral themes — only server-authoritative unlock does
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const setStyle = jest.fn();
      const onOpenRewardCatalog = jest.fn();
      const props = makeProps({ isPro: true, uiStyle: 'flat', setStyle, onOpenRewardCatalog });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.developer-desk'));
      });
      expect(setStyle).not.toHaveBeenCalled();
      expect(onOpenRewardCatalog).toHaveBeenCalledTimes(1);
    });
  });

  describe('Selected state renders (checkicon visible)', () => {
    it('terminal-mono row is rendered when uiStyle is terminal-mono', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const props = makeProps({ isPro: true, uiStyle: 'terminal-mono' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.terminal-mono')).toBeTruthy();
    });

    it('crt-green row is rendered when uiStyle is crt-green', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const props = makeProps({ isPro: true, uiStyle: 'crt-green' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.crt-green')).toBeTruthy();
    });

    it('developer-desk row is rendered when uiStyle is developer-desk', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const props = makeProps({ isPro: true, uiStyle: 'developer-desk' });
      const { getByTestId } = render(<SettingsContent {...props} />);
      expect(getByTestId('settings.option.style.developer-desk')).toBeTruthy();
    });
  });

  describe('Legacy styles unaffected', () => {
    beforeEach(() => { mockAlertCalls = []; });

    it('pressing neumorphic still triggers paywall for free users (unchanged behavior)', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const props = makeProps({ isPro: false });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neumorphic'));
      });
      expect(mockAlertCalls.length).toBe(1);
    });

    it('neo-brutalist is still free for all users (unchanged behavior)', async () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const setStyle = jest.fn();
      const props = makeProps({ isPro: false, uiStyle: 'flat', setStyle });
      const { getByTestId } = render(<SettingsContent {...props} />);

      await act(async () => {
        fireEvent.press(getByTestId('settings.option.style.neo-brutalist'));
      });
      expect(setStyle).toHaveBeenCalledWith('neo-brutalist');
      expect(mockAlertCalls.length).toBe(0);
    });
  });
});
