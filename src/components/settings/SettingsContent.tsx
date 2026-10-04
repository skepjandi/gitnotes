import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Group, GroupRow, Modal, Toggle } from '../ui';
import { HintIcon } from '../ui/HintIcon';
import { aiMemoryIndex } from '../../services/ai/AIMemoryIndexService';
import { HapticService } from '../../utils/haptics';
import { promptProUpgrade } from '../../utils/proAlerts';
import { FREE_TIER_MAX_REPOS } from '../../services/TierLimits';
import {
  SUPPORTED_LANGUAGES,
  getLanguagePreference,
  setLanguage,
  type LanguageCode,
} from '../../i18n';
import { ReminderSection } from './ReminderSection';
import ContextMenu from '../ContextMenu';
import { HostCredentialRow } from './HostCredentialRow';
import { settingsStyles as styles } from './settingsStyles';
import type { GitRepository } from '../../services/GitService';
import type { TemplateRepoPreference } from '../../services/TemplateRepoPreferenceService';
import type { AIProviderConfig } from '../../models/AIProvider';
import { TIMEOUT_OPTIONS, type BiometricKind, type LockTimeout } from '../../contexts/BiometricLockContext';
import type { ForegroundSyncHealth } from '../../services/ForegroundSyncService';
import { AuthService } from '../../services/AuthService';
import type { GitHubAppCredentialRecord } from '../../services/git/contracts/GitHubAppCredential';
import { useProvidersAvailability } from '../../hooks/useProviderAvailability';
import { describeAvailability } from '../../services/ai/providerAvailabilityCopy';
import type { GitHostProvider } from '../../services/git/GitHost';
import { GIT_HOST_LABELS } from '../../services/git/GitHost';
import { useTokens } from '../../contexts/ThemeContext';
import type { AppIconName } from '../../services/AppIconService';
import type { ThemeStyle } from '../../theme/tokens';

type ThemeColors = {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  accent: string;
};

type Account = {
  id: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
};

type AccountSummaryViewModel = {
  accountId: string;
  account: Account;
  hosts: Array<{
    id: string;
    provider: GitHostProvider;
    hostLogin: string;
    instanceBaseUrl: string | null;
  }>;
  activeHostId: string | null;
};

type AuthState = {
  isAuthenticated: boolean;
  user?: { login?: string | null; name?: string | null; avatar_url?: string | null } | null;
};

type SettingsContentProps = {
  colors: ThemeColors;
  headerHeight: number;
  tabBarHeight: number;
  theme: 'light' | 'dark' | 'system';
  uiStyle: ThemeStyle;
  accounts: Account[];
  activeAccountId: string | null;
  authState: AuthState;
  repositories: GitRepository[];
  syncingRepo: string | null;
  cloningRepo: string | null;
  templatesRepoPref: TemplateRepoPreference | null;
  isSyncingExistingTemplates: boolean;
  isAIEnabled: boolean;
  selectedModelName: string;
  actionMode: 'auto' | 'confirm';
  chatStorageLabel: string;
  providers: AIProviderConfig[];
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setStyle: (style: ThemeStyle) => void;
  onOpenConnectToken: () => void;
  onOpenAddAccount: () => void;
  onSwitchAccount: (id: string) => void | Promise<void>;
onRemoveAccount: (id: string, login: string) => void;
  onRemoveToken: () => void;
  /**
   * Disconnect a single host connection. Confirmation flow lives in the
   * parent screen — this just fires the request.
   */
  onDisconnectHost: (hostId: string) => void;
  /** Open Connect Host modal. Optional preset focuses the host picker. */
  onAddHost: (preset?: GitHostProvider) => void;
  /**
   * Gated add-host path for free users who already hold one account.
   * The parent decides whether to open the paywall or the Connect Host modal.
   */
  onAddHostLocked: () => void;
  accountSummaries: AccountSummaryViewModel[];
  onOpenRepoPicker: () => void;
  onSyncRepo: (repo: GitRepository) => void;
  onRemoveRepo: (repo: GitRepository) => void;
  lfsPending: Record<string, { count: number; bytes: number }>;
  lfsDownloadingRepo: string | null;
  onDownloadLfsObjects: (repo: GitRepository) => void;
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
  /** Opens the HexColorPickerModal (Pro only); free users go to paywall via onOpenPaywall. */
  onOpenAccentColorPicker: () => void;
  onManageTemplates: () => void;
  onToggleAI: () => void;
  onOpenModelSelector: () => void;
  onToggleActionMode: () => void;
  onOpenChatRepoPicker: () => void;
  onProviderPress: (provider: AIProviderConfig) => void;
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
  biometricKind: BiometricKind;
  biometricLabel: string;
  lockTimeout: LockTimeout;
  onToggleBiometricLock: (v: boolean) => void;
  onSetLockTimeout: (v: LockTimeout) => void;
  isBackgroundSyncEnabled: boolean;
  onToggleBackgroundSync: () => void;
  floatingGitButtonVisible: boolean;
  onToggleFloatingGitButton: () => void;
  syncPaused: boolean;
  onToggleSyncPaused: (value: boolean) => void;
  syncHealth: ForegroundSyncHealth;
  onToggleSSH: (hostId: string) => void;
  hostUseSsh: Record<string, boolean>;
  appIcon: AppIconName | null;
  appIconSupported: boolean;
  appIconLoading: boolean;
  onOpenAppIconPicker: () => void;
  // GitHub OAuth
  onConnectOAuth: (hostId: string | null) => void;
  onDisconnectOAuth: (hostId: string) => void;
  oauthLoading: Record<string, boolean>;
  oauthError: Record<string, string | null>;
  // GitHub App
  onConnectGitHubApp: (hostId: string | null) => void;
  onDisconnectGitHubApp: (hostId: string) => void;
  appLoading: Record<string, boolean>;
  appError: Record<string, string | null>;
  appCredentials: Record<string, GitHubAppCredentialRecord | null>;
  // GitHub PAT
  hostCredentialKinds: Record<string, Array<'token' | 'oauth' | 'github_app' | 'ssh'>>;
  onDisconnectPat: (hostId: string) => void;
  patLoading: Record<string, boolean>;
  patError: Record<string, string | null>;
};

function formatLfsBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSyncElapsed(timestamp: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function SettingsContent(props: SettingsContentProps) {
  const {
    colors,
    headerHeight,
    tabBarHeight,
    theme,
    uiStyle,
    activeAccountId,
    accountSummaries,
    repositories,
    syncingRepo,
    cloningRepo,
    templatesRepoPref,
    isSyncingExistingTemplates,
    isAIEnabled,
    selectedModelName,
    actionMode,
    chatStorageLabel,
    providers,
    setTheme,
    setStyle,
    onRemoveToken,
    onDisconnectHost,
    onAddHost,
    onAddHostLocked,
    onOpenRepoPicker,
    onSyncRepo,
    onRemoveRepo,
    lfsPending,
    lfsDownloadingRepo,
    onDownloadLfsObjects,
    onOpenTemplatesRepoPicker,
    onSyncExistingTemplates,
    onClearTemplatesRepo,
    onOpenRenderStyleSettings,
    onClearData,
    onResetOnboarding,
    isPro,
    isProLoading,
    proStatusLabel,
    onOpenPaywall,
    accentColor,
    onOpenAccentColorPicker,
    onManageTemplates,
    onToggleAI,
    onOpenModelSelector,
    onToggleActionMode,
    onOpenChatRepoPicker,
    onProviderPress,
    onAddProvider,
    dailyQuoteEnabled,
    onToggleDailyQuote,
    aiPersonalizationEnabled,
    onToggleAiPersonalization,
    githubToolsEnabled,
    onToggleGithubTools,
    dailyQuotePersonalizationEnabled,
    onToggleDailyQuotePersonalization,
    dailyQuoteSourceVisible,
    onToggleDailyQuoteSourceVisible,
    isBiometricLockEnabled,
    isBiometricAvailable,
    biometricKind,
    biometricLabel,
    lockTimeout,
    onToggleBiometricLock,
    onSetLockTimeout,
    isBackgroundSyncEnabled,
    onToggleBackgroundSync,
    floatingGitButtonVisible,
    onToggleFloatingGitButton,
    syncPaused,
    onToggleSyncPaused,
    syncHealth,
    onToggleSSH,
    hostUseSsh,
    appIcon,
    appIconSupported,
    appIconLoading,
    onOpenAppIconPicker,
    onConnectOAuth,
    onDisconnectOAuth,
    oauthLoading = {},
    oauthError = {},
    onConnectGitHubApp,
    onDisconnectGitHubApp,
    appLoading = {},
    appError = {},
    appCredentials = {},
    hostCredentialKinds = {},
    onDisconnectPat,
    patLoading = {},
    patError = {},
  } = props;
  const { spacing, type } = useTokens();
  const { t } = useTranslation();
  const [languagePref, setLanguagePref] = useState<string>('system');
  const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showResetAIMemoryModal, setShowResetAIMemoryModal] = useState(false);
  const [oauthConnected, setOauthConnected] = useState<Record<string, boolean>>({});
  const [overflowHostId, setOverflowHostId] = useState<string | null>(null);
  // Drop providers whose `supportedPlatforms` excludes the current OS so a
  // provider that physically can't run here (e.g. on-device Llama on iOS) is
  // hidden entirely instead of showing as a permanently-disabled row.
  const visibleProviders = useMemo(
    () =>
      providers.filter((p) => {
        if (!p.supportedPlatforms || p.supportedPlatforms.length === 0) return true;
        const os = Platform.OS as 'ios' | 'android';
        return p.supportedPlatforms.includes(os);
      }),
    [providers],
  );
  const providerAvailability = useProvidersAvailability(visibleProviders);

  useEffect(() => {
    getLanguagePreference().then(setLanguagePref);
  }, []);

  useEffect(() => {
    let disposed = false;
    const githubHostIds = accountSummaries
      .flatMap((summary) => summary.hosts)
      .filter((host) => host.provider === 'github')
      .map((host) => host.id);

    void Promise.all(
      githubHostIds.map(async (hostId) => {
        const availability = await AuthService.getProviderAuthAvailability(hostId, 'github');
        return [hostId, availability.oauth?.available ?? false] as const;
      }),
    ).then((entries) => {
      if (!disposed) setOauthConnected(Object.fromEntries(entries));
    });

    return () => {
      disposed = true;
    };
  }, [accountSummaries]);

  const currentLangLabel = t(`settings.languageOptions.${languagePref}`);

  const handleResetAIMemory = useCallback(async () => {
    HapticService.warning();
    setShowResetAIMemoryModal(true);
  }, []);

  const confirmResetAIMemory = useCallback(async () => {
    try {
      await aiMemoryIndex.clear();
      const manifestUri = `${FileSystem.documentDirectory}thought-dump-manifest.json`;
      try {
        const exists = await FileSystem.getInfoAsync(manifestUri);
        if (exists.exists) {
          await FileSystem.deleteAsync(manifestUri);
        }
      } catch {
        // ignore cleanup errors
      }
      HapticService.success();
      Alert.alert(t('settings.resetAIMemorySuccess'));
    } catch {
      HapticService.error();
      Alert.alert(t('common.error'));
    } finally {
      setShowResetAIMemoryModal(false);
    }
  }, [t]);

  return (
    <>
    <ScrollView
      style={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: headerHeight + 16,
        paddingBottom: Math.max(tabBarHeight + 16, 80),
        gap: 20,
      }}
    >
      <Group title={t('pro.settingsRow')}>
        <GroupRow
          testID="settings.row.pro"
          onPress={isPro ? undefined : () => onOpenPaywall()}
          accessibilityRole={isPro ? 'none' : 'button'}
          accessibilityLabel={isPro ? `${t('pro.settingsRow')}, ${proStatusLabel}` : undefined}
          trailing={
            <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
              {proStatusLabel}
            </Text>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('pro.settingsRow')}</Text>
        </GroupRow>
      </Group>

      <Group
        title={t('settings.appearance')}
      >
        <GroupRow
          testID="settings.option.style.basic"
          onPress={() => { HapticService.selection(); setStyle('flat'); }}
          accessibilityRole="button"
          accessibilityLabel={t('settings.style.basic')}
          trailing={
            uiStyle === 'flat' ? (
              <Ionicons name="checkmark" size={18} color={colors.accent} />
            ) : null
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.style.basic')}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.option.style.neumorphic"
          onPress={isPro ? () => { HapticService.selection(); setStyle('neumorphic'); } : () => promptProUpgrade(t, onOpenPaywall)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.style.neumorphic')}
          trailing={
            <View className="flex-row items-center gap-2">
              {uiStyle === 'neumorphic' ? (
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              ) : !isPro ? (
                <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
              ) : null}
            </View>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.style.neumorphic')}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.option.style.neo-brutalist"
          onPress={() => { HapticService.selection(); setStyle('neo-brutalist'); }}
          accessibilityRole="button"
          accessibilityLabel={t('settings.style.neoBrutalist')}
          trailing={
            <View className="flex-row items-center gap-2">
              {uiStyle === 'neo-brutalist' ? (
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              ) : null}
            </View>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.style.neoBrutalist')}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.option.style.retrofuturistic"
          onPress={isPro ? () => { HapticService.selection(); setStyle('retrofuturistic'); } : () => promptProUpgrade(t, onOpenPaywall)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.style.retrofuturistic')}
          trailing={
            <View className="flex-row items-center gap-2">
              {uiStyle === 'retrofuturistic' ? (
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              ) : !isPro ? (
                <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
              ) : null}
            </View>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.style.retrofuturistic')}</Text>
        </GroupRow>
        <GroupRow
          trailing={
            <View className="flex-row items-center gap-2">
              <Toggle
                testID="settings.toggle.theme"
                value={theme === 'dark'}
                onValueChange={(value) => {
                  HapticService.selection();
                  setTheme(value ? 'dark' : 'light');
                }}
              />
              <HintIcon hintKey="hints.settings.darkMode" testID="hint.dark-mode" />
            </View>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.darkMode')}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.button.theme"
          onPress={() => setTheme('system')}
          trailing={
            <Text style={[styles.settingValue, { color: colors.textSecondary }]}> 
              {theme === 'system' ? t('settings.active') : t('settings.inactive')}
            </Text>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.useSystemTheme')}</Text>
        </GroupRow>
        <GroupRow
          testID={isProLoading ? undefined : isPro ? 'settings.row.accent-color' : 'settings.row.accent-color-locked'}
          onPress={isProLoading ? undefined : isPro ? onOpenAccentColorPicker : () => promptProUpgrade(t, onOpenPaywall)}
          disabled={isProLoading}
          trailing={
            isProLoading ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : isPro ? (
              <View testID="settings.swatch.accent-color" style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: accentColor ?? colors.accent }} />
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.accentColor', { defaultValue: 'Accent Color' })}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.row.app-icon"
          onPress={appIconSupported && !appIconLoading ? onOpenAppIconPicker : undefined}
          disabled={!appIconSupported || appIconLoading}
          trailing={
            appIconLoading ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : appIconSupported ? (
              <View className="flex-row items-center gap-1">
                <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                  {appIcon ?? t('settings.appIcon.default', { defaultValue: 'Default' })}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </View>
            ) : (
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {t('settings.appIcon.unavailable', { defaultValue: 'Unavailable' })}
              </Text>
            )
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="apps-outline" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.appIcon.title', { defaultValue: 'App Icon' })}</Text>
          </View>
        </GroupRow>
      </Group>

      <Group title={t('settings.language')}>
        <GroupRow
          testID="settings.button.language-picker"
          onPress={() => setShowLanguagePicker(true)}
          trailing={
            <View className="flex-row items-center gap-1">
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {currentLangLabel}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.language')}</Text>
        </GroupRow>
      </Group>

      <Group title={t('settings.security')}>
        <GroupRow
          testID={isPro ? undefined : 'settings.row.biometric-lock-locked'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.biometric-lock"
                  value={isBiometricLockEnabled}
                  onValueChange={onToggleBiometricLock}
                  disabled={!isBiometricAvailable}
                />
                <HintIcon hintKey="hints.settings.biometricLock" testID="hint.biometric-lock" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons
              name={biometricKind === 'face' ? 'scan-outline' : 'finger-print-outline'}
              size={20}
              color={colors.text}
            />
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.biometricLockLabel', { kind: biometricLabel })}</Text>
          </View>
        </GroupRow>
        {isPro && isBiometricLockEnabled ? (
          <GroupRow
            testID="settings.button.timeout-picker"
            onPress={() => setShowTimeoutPicker(true)}
            trailing={
              <View className="flex-row items-center gap-1">
                <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                  {TIMEOUT_OPTIONS.find((o) => o.value === lockTimeout)?.label ?? t('settings.lockTimeout5Min')}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </View>
            }
          >
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.lockTimeout')}</Text>
          </GroupRow>
        ) : null}
      </Group>

      <Group title={t('accounts.title')}>
        {accountSummaries.length === 0 ? (
          <>
            {/* PAT-based Connect Host */}
            <GroupRow
              testID="settings.button.connect-host"
              onPress={() => onAddHost()}
              leading={<Ionicons name="add-circle-outline" size={20} color={colors.primary} />}
              trailing={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
            >
              <Text style={[styles.settingLabel, { color: colors.primary }]}>
                {t('connectHost.connectHost')}
              </Text>
            </GroupRow>
            {/* OAuth-based GitHub connect — fresh install path */}
            <GroupRow
              testID="settings.button.connect-github-oauth"
              onPress={() => onConnectOAuth(null)}
              leading={<Ionicons name="logo-github" size={20} color={colors.primary} />}
              trailing={
                oauthLoading['__fresh__'] ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : oauthError['__fresh__'] ? (
                  <Text style={{ fontSize: type.xs, color: colors.error }}>{oauthError['__fresh__']}</Text>
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                )
              }
            >
              <Text style={[styles.settingLabel, { color: colors.primary }]}>
                {t('settings.connectWithGitHub')}
              </Text>
            </GroupRow>
            <View style={{ paddingHorizontal: spacing[4], paddingBottom: spacing[2] }}>
              <Text style={{ fontSize: type.xs, color: colors.textSecondary }}>
                {t('settings.oauthFullAccessWarning')}
              </Text>
            </View>
          </>
        ) : (
          <>
            <GroupRow
              testID="settings.button.connect-github-oauth-existing"
              onPress={() => {
                if (isProLoading || oauthLoading['__fresh__']) return;
                if (isPro) {
                  onConnectOAuth(null);
                } else {
                  onOpenPaywall();
                }
              }}
              leading={<Ionicons name="logo-github" size={20} color={colors.primary} />}
              trailing={
                isProLoading || oauthLoading['__fresh__'] ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : oauthError['__fresh__'] ? (
                  <Text style={{ fontSize: type.xs, color: colors.error }}>{oauthError['__fresh__']}</Text>
                ) : (
                  <Ionicons
                    name={isPro ? 'chevron-forward' : 'lock-closed-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                )
              }
            >
              <Text style={[styles.settingLabel, { color: colors.primary }]}>
                {t('settings.connectWithGitHub')}
              </Text>
            </GroupRow>
            {accountSummaries.map((summary) => {
              const isActive = summary.accountId === activeAccountId;
              return (
                <React.Fragment key={summary.accountId}>
                  <View testID="settings.row.account">
                    <GroupRow
                      leading={summary.account.avatarUrl ? <Image source={{ uri: summary.account.avatarUrl }} style={styles.avatar} /> : null}
                    >
                      <Text style={[styles.settingLabel, { color: colors.text }]}>
                        {summary.account.name || summary.account.login}
                        {isActive ? ` · ${t('accounts.active')}` : ''}
                      </Text>
                      <Text style={[styles.settingValue, { color: colors.textSecondary }]}>@{summary.account.login}</Text>
                    </GroupRow>
                  </View>
                  {summary.hosts.map((host) => {
                    const isHostActive = host.id === summary.activeHostId;
                    const hostLogin = host.hostLogin || GIT_HOST_LABELS[host.provider];
                    const idLabel = host.instanceBaseUrl
                      ? `${hostLogin}@${host.instanceBaseUrl.replace(/^https?:\/\//, '')}`
                      : hostLogin;
                    const isGithubHost = host.provider === 'github';
                    return (
                      <React.Fragment key={host.id}>
                        <View testID={`settings.row.host.${host.id}`}>
                          <GroupRow
                            leading={<Ionicons name="globe-outline" size={19} color={colors.textSecondary} />}
                            trailing={
                              <TouchableOpacity
                                testID={`settings.button.host-overflow.${host.id}`}
                                onPress={() => setOverflowHostId(host.id)}
                                accessibilityRole="button"
                                accessibilityLabel={`${GIT_HOST_LABELS[host.provider]} actions`}
                                hitSlop={8}
                              >
                                <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
                              </TouchableOpacity>
                            }
                          >
                            <View className="flex-row items-center gap-2">
                              <Text numberOfLines={1} style={{ fontSize: type.sm, fontWeight: '600', color: colors.text }}>
                                {GIT_HOST_LABELS[host.provider]}
                              </Text>
                              {isHostActive ? (
                                <View style={{ paddingHorizontal: 6, minHeight: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: colors.primary }}>
                                  <Text style={{ color: '#ffffff', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }}>
                                    {t('accounts.active').toUpperCase()}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text numberOfLines={1} style={{ fontSize: type.xs, color: colors.textSecondary, fontFamily: 'Menlo', marginTop: 3 }}>
                              {idLabel}
                            </Text>
                          </GroupRow>
                        </View>

                        <HostCredentialRow
                          kind="ssh"
                          hostId={host.id}
                          sshEnabled={hostUseSsh[host.id] ?? false}
                          oauthConnected={false}
                          oauthLoading={false}
                          oauthError={null}
                          appCredential={null}
                          appLoading={false}
                          appError={null}
                          hasPat={false}
                          patLoading={false}
                          patError={null}
                          onToggleSSH={() => onToggleSSH(host.id)}
                          onOAuthPress={() => undefined}
                          onAppPress={() => undefined}
                          onPatPress={() => undefined}
                        />
                        {isGithubHost ? (
                          <>
                            <HostCredentialRow
                              kind="oauth"
                              hostId={host.id}
                              sshEnabled={false}
                              oauthConnected={oauthConnected[host.id] ?? false}
                              oauthLoading={oauthLoading[host.id] ?? false}
                              oauthError={oauthError[host.id] ?? null}
                              appCredential={null}
                              appLoading={false}
                              appError={null}
                              hasPat={false}
                              patLoading={false}
                              patError={null}
                              onToggleSSH={() => undefined}
                              onOAuthPress={() => {
                                if (oauthConnected[host.id]) {
                                  onDisconnectOAuth(host.id);
                                  setOauthConnected((current) => ({ ...current, [host.id]: false }));
                                } else {
                                  onConnectOAuth(host.id);
                                }
                              }}
                              onAppPress={() => undefined}
                              onPatPress={() => undefined}
                            />
                            <HostCredentialRow
                              kind="github_app"
                              hostId={host.id}
                              sshEnabled={false}
                              oauthConnected={false}
                              oauthLoading={false}
                              oauthError={null}
                              appCredential={appCredentials[host.id] ?? null}
                              appLoading={appLoading[host.id] ?? false}
                              appError={appError[host.id] ?? null}
                              hasPat={false}
                              patLoading={false}
                              patError={null}
                              onToggleSSH={() => undefined}
                              onOAuthPress={() => undefined}
                              onAppPress={() => {
                                if (appCredentials[host.id]) {
                                  onDisconnectGitHubApp(host.id);
                                } else {
                                  onConnectGitHubApp(host.id);
                                }
                              }}
                              onPatPress={() => undefined}
                            />
                            <HostCredentialRow
                              kind="token"
                              hostId={host.id}
                              sshEnabled={false}
                              oauthConnected={false}
                              oauthLoading={false}
                              oauthError={null}
                              appCredential={null}
                              appLoading={false}
                              appError={null}
                              hasPat={(hostCredentialKinds[host.id] ?? []).includes('token')}
                              patLoading={patLoading[host.id] ?? false}
                              patError={patError[host.id] ?? null}
                              onToggleSSH={() => undefined}
                              onOAuthPress={() => undefined}
                              onAppPress={() => undefined}
                              onPatPress={() => onDisconnectPat(host.id)}
                            />
                          </>
                        ) : null}

                        <ContextMenu
                          visible={overflowHostId === host.id}
                          onClose={() => setOverflowHostId(null)}
                          title={GIT_HOST_LABELS[host.provider]}
                          subtitle={idLabel}
                          headerIcon="ellipsis-horizontal-circle-outline"
                          items={[
                            {
                              icon: 'unlink-outline',
                              label: t('accounts.disconnect'),
                              destructive: true,
                              testID: `settings.button.disconnect-host.${host.id}`,
                              onPress: () => onDisconnectHost(host.id),
                            },
                          ]}
                        />
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </>
        )}
          </Group>

          <Group>
            {accountSummaries.length > 0 ? (
              <>
                <GroupRow
                  testID={isPro ? 'settings.button.connect-host' : 'settings.row.connect-host-locked'}
                  onPress={isPro ? () => onAddHost() : onAddHostLocked}
                  leading={<Ionicons name="add-circle-outline" size={20} color={colors.primary} />}
                  trailing={
                    isPro ? (
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    ) : (
                      <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
                    )
                  }
                >
                  <Text style={[styles.settingLabel, { color: colors.primary }]}>
                    {t('connectHost.connectHost')}
                  </Text>
                </GroupRow>

                {accountSummaries.length < 2 && accountSummaries.every((s) => s.hosts.length <= 1) ? null : (
                  <GroupRow
                    testID="settings.button.remove-token"
                    onPress={onRemoveToken}
                    accessibilityRole="button"
                    leading={<Ionicons name="trash-outline" size={18} color={colors.error} />}
                    trailing={<HintIcon hintKey="hints.settings.disconnectAllHosts" testID="hint.disconnect-all-hosts" />}
                  >
                    <Text
                      style={[styles.settingLabel, { color: colors.error }]}
                    >
                      {t('accounts.disconnectAllHosts')}
                    </Text>
                  </GroupRow>
                )}
              </>
            ) : null}
            {/* GitHub App install — always available */}
        <GroupRow
          testID="settings.button.install-github-app"
          onPress={() => onConnectGitHubApp(null)}
          leading={<Ionicons name="cube-outline" size={20} color={colors.primary} />}
          trailing={
            appLoading['__fresh__'] ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : appError['__fresh__'] ? (
              <Text style={{ fontSize: type.xs, color: colors.error }}>{appError['__fresh__']}</Text>
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            )
          }
        >
          <Text style={[styles.settingLabel, { color: colors.primary }]}>
            {t('settings.installGithubApp')}
          </Text>
        </GroupRow>
      </Group>

      <Group title={t('settings.repositories')}>
        {repositories.length === 0 ? (
          <GroupRow>
            <View className="items-center gap-1.5 py-2">
              <Ionicons name="code-slash-outline" size={32} color={colors.textSecondary} />
              <Text style={[styles.emptyReposText, { color: colors.textSecondary }]}>{t('settings.noRepositories')}</Text>
            </View>
          </GroupRow>
        ) : (
          repositories.map((repo) => (
            <GroupRow
              key={repo.id}
              leading={<Ionicons name="git-branch-outline" size={18} color={colors.primary} />}
              trailing={
                <View className="flex-row items-center gap-1">
                  {syncingRepo === repo.path ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginHorizontal: 8 }} />
                  ) : (
                    <TouchableOpacity testID={`settings.button.sync-repo`} onPress={() => onSyncRepo(repo)} style={{ padding: 8 }} disabled={!!syncingRepo}>
                      <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity testID={`settings.button.remove-repo`} onPress={() => onRemoveRepo(repo)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                </View>
              }
            >
              <Text style={[styles.repoName, { color: colors.text }]} numberOfLines={1}>{repo.name}</Text>
              <Text style={[styles.repoPath, { color: colors.textSecondary }]} numberOfLines={1}>{repo.path}</Text>
            </GroupRow>
          ))
        )}
        <GroupRow
          testID={!isPro && repositories.length >= FREE_TIER_MAX_REPOS ? 'settings.row.add-repo-locked' : 'settings.button.repo-picker'}
          onPress={!isPro && repositories.length >= FREE_TIER_MAX_REPOS ? () => promptProUpgrade(t, onOpenPaywall) : onOpenRepoPicker}
          leading={<Ionicons name="add" size={20} color={colors.primary} />}
          trailing={
            !isPro && repositories.length >= FREE_TIER_MAX_REPOS ? (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            ) : undefined
          }
        >
          <Text style={[styles.settingLabel, { color: colors.primary, fontWeight: '600' }]}>{t('settings.addRepository')}</Text>
        </GroupRow>
      </Group>

      {repositories.length > 0 ? (
        <Group title={t('settings.syncEngine')}>
          {repositories.map((repo) => {
            const isCloning = cloningRepo === repo.path;
            const lfs = lfsPending[repo.path];
            const isDownloadingLfs = lfsDownloadingRepo === repo.path;
            return (
              <React.Fragment key={repo.id}>
                <GroupRow
                  testID={`sync-engine-row-${repo.path}`}
                  leading={<Ionicons name="cloud-done-outline" size={18} color={colors.primary} />}
                  trailing={
                    isCloning ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : undefined
                  }
                >
                  <Text style={[styles.repoName, { color: colors.text }]} numberOfLines={1}>{repo.name}</Text>
                  <Text style={[styles.repoPath, { color: colors.textSecondary }]} numberOfLines={1}>
                    {t('settings.cloneModeDescription')}
                  </Text>
                </GroupRow>
                {lfs && lfs.count > 0 ? (
                  <GroupRow
                    testID={`lfs-pending-row-${repo.path}`}
                    leading={<Ionicons name="document-attach-outline" size={18} color={colors.accent} />}
                    trailing={
                      isDownloadingLfs ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <View testID="settings.button.download-lfs">
                          <TouchableOpacity
                            testID={`lfs-download-${repo.path}`}
                          onPress={() => onDownloadLfsObjects(repo)}
                          style={{ padding: 4 }}
                          disabled={!!lfsDownloadingRepo}
                        >
                          <Text style={[styles.settingLabel, { color: colors.primary }]}>{t('settings.download')}</Text>
                        </TouchableOpacity>
                        </View>
                      )
                    }
                  >
                    <Text style={[styles.repoName, { color: colors.text }]} numberOfLines={1}>
                      {t('settings.lfsPending', { count: lfs.count })}
                    </Text>
                    <Text style={[styles.repoPath, { color: colors.textSecondary }]} numberOfLines={1}>
                      {t('settings.lfsBytesPending', { size: formatLfsBytes(lfs.bytes) })}
                    </Text>
                  </GroupRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </Group>
      ) : null}

      <Group title={t('settings.templates')}>
        <GroupRow
          testID="settings.button.templates-repo-picker"
          onPress={onOpenTemplatesRepoPicker}
          leading={<Ionicons name="document-text-outline" size={20} color={colors.text} />}
          trailing={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.templatesRepository')}</Text>
          <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]} numberOfLines={1}>
            {templatesRepoPref ? templatesRepoPref.repoPath : t('settings.notSet')}
          </Text>
        </GroupRow>

        {templatesRepoPref ? (
          <>
            <GroupRow
              testID="settings.button.sync-templates"
              onPress={onSyncExistingTemplates}
              disabled={isSyncingExistingTemplates}
              leading={<Ionicons name="cloud-upload-outline" size={20} color={colors.text} />}
              trailing={isSyncingExistingTemplates ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            >
              <Text style={[styles.settingLabel, { color: colors.text }]} numberOfLines={1}>{t('settings.syncCustomTemplates')}</Text>
            </GroupRow>
            <GroupRow testID="settings.button.clear-templates-repo" onPress={onClearTemplatesRepo}>
              <Text style={[styles.settingLabel, { color: colors.error }]}>{t('settings.disconnectTemplatesRepo')}</Text>
            </GroupRow>
          </>
        ) : null}
        <GroupRow
          testID={isPro ? 'settings.button.manage-templates' : 'settings.row.manage-templates-locked'}
          onPress={isPro ? onManageTemplates : () => promptProUpgrade(t, onOpenPaywall)}
          leading={<Ionicons name="document-text-outline" size={20} color={colors.text} />}
          trailing={
            isPro ? (
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.manageTemplates')}</Text>
        </GroupRow>
      </Group>

      <Group title={t('settings.noteRendering')}>
        <GroupRow
          testID="settings.button.render-style-settings"
          onPress={onOpenRenderStyleSettings}
          leading={<Ionicons name="color-palette-outline" size={20} color={colors.text} />}
          trailing={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.customizeRenderStyles')}</Text>
        </GroupRow>
      </Group>

      <Group title={t('common.sync')}>
        <GroupRow
          testID="settings.row.floating-git-button"
          trailing={
            <View className="flex-row items-center gap-2">
              <Toggle
                testID="settings.toggle.floating-git-button"
                value={floatingGitButtonVisible}
                onValueChange={onToggleFloatingGitButton}
              />
              <HintIcon hintKey="hints.settings.floatingGitButton" testID="hint.floating-git-button" />
            </View>
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="git-pull-request-outline" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.floatingGitButton')}</Text>
          </View>
        </GroupRow>
        <GroupRow
          trailing={
            <View className="flex-row items-center gap-2">
              <Toggle
                testID="settings.toggle.pause-sync"
                value={syncPaused}
                onValueChange={onToggleSyncPaused}
              />
              <HintIcon hintKey="hints.settings.pauseForegroundSync" testID="hint.pause-foreground-sync" />
            </View>
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="pause-circle-outline" size={20} color={syncPaused ? colors.error : colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.pauseForegroundSync')}</Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {t('settings.pauseForegroundSyncSub')}
              </Text>
            </View>
          </View>
        </GroupRow>
        <GroupRow
          trailing={
            <View className="flex-row items-center gap-2">
              <Toggle
                testID="settings.toggle.background-sync"
                value={isBackgroundSyncEnabled}
                onValueChange={onToggleBackgroundSync}
              />
              <HintIcon hintKey="hints.settings.backgroundSync" testID="hint.background-sync" />
            </View>
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="cloud-download-outline" size={20} color={colors.text} />
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.backgroundSync')}</Text>
          </View>
        </GroupRow>
        {syncHealth.status !== 'idle' && (
          <GroupRow testID="settings.row.sync-health">
            <View className="flex-row items-center gap-2">
              {syncHealth.status === 'syncing' ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons
                  name={syncHealth.status === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                  size={20}
                  color={syncHealth.status === 'ok' ? colors.primary : colors.error}
                />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.settingLabel,
                    { color: syncHealth.status === 'ok' ? colors.text : colors.error },
                  ]}
                >
                  {syncHealth.status === 'syncing' && t('settings.syncInProgress')}
                  {syncHealth.status === 'ok' && t('settings.syncUpToDate')}
                  {syncHealth.status === 'failed' && t('settings.syncLastFailed')}
                  {syncHealth.status === 'timedout' && t('settings.syncLastTimedOut')}
                </Text>
                {(syncHealth.status === 'failed' || syncHealth.status === 'timedout') && (
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                    {t('settings.syncTimeAgo', { time: formatSyncElapsed(syncHealth.lastFailedAt) })}
                    {syncHealth.consecutiveFailures > 1
                      ? ` · ${t('settings.syncFailureCount', { count: syncHealth.consecutiveFailures })}`
                      : ''}
                  </Text>
                )}
              </View>
            </View>
          </GroupRow>
        )}
      </Group>

      <Group title={t('settings.data')}>
        <GroupRow testID="settings.button.clear-data" onPress={onClearData} trailing={<HintIcon hintKey="hints.settings.clearData" testID="hint.clear-data" />}>
          <Text style={[styles.settingLabel, { color: colors.error }]}>{t('settings.clearAllNotes')}</Text>
        </GroupRow>
        <GroupRow testID="settings.button.reset-onboarding" onPress={onResetOnboarding} trailing={<HintIcon hintKey="hints.settings.resetOnboarding" testID="hint.reset-onboarding" />}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.resetOnboarding')}</Text>
        </GroupRow>
      </Group>

      <Group title={t('settings.artificialIntelligence')}>
        <GroupRow
          testID={isPro ? undefined : 'settings.row.ai-locked-enable'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle testID="settings.toggle.ai" value={isAIEnabled} onValueChange={onToggleAI} />
                <HintIcon hintKey="hints.settings.enableAI" testID="hint.enable-ai" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.enableAI')}</Text>
        </GroupRow>
        <GroupRow
          testID={isPro ? 'settings.row.ai-personalization' : 'settings.row.ai-locked-personalization'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.ai-personalization"
                  value={isAIEnabled ? aiPersonalizationEnabled : false}
                  onValueChange={onToggleAiPersonalization}
                  disabled={!isAIEnabled}
                />
                <HintIcon hintKey="hints.settings.aiPersonalization" testID="hint.ai-personalization" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {t('settings.aiPersonalization.title', { defaultValue: 'Personalize AI with my notes' })}
            </Text>
            <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]}>
              {t('settings.aiPersonalizationDescription', { defaultValue: "When off, AI won't read your notes or journals for data safety" })}
            </Text>
          </View>
        </GroupRow>
        <GroupRow
          testID={isPro ? 'settings.row.github-tools' : 'settings.row.ai-locked-github-tools'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.github-tools"
                  value={isAIEnabled ? githubToolsEnabled : false}
                  onValueChange={onToggleGithubTools}
                  disabled={!isAIEnabled}
                />
                <HintIcon hintKey="hints.settings.githubTools" testID="hint.github-tools" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {t('settings.githubTools.title', { defaultValue: 'GitHub Tools' })}
            </Text>
            <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]}>
              {t('settings.githubTools.description', { defaultValue: "Let AI manage issues, PRs, and repos via your active GitHub account." })}
            </Text>
          </View>
        </GroupRow>
      </Group>

      <Group title={t('settings.dailyQuote.title', { defaultValue: 'Daily Quote' })}>
        <GroupRow
          testID={isPro ? 'settings.row.daily-quote' : 'settings.row.ai-locked-daily-quote'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.daily-quote"
                  value={dailyQuoteEnabled}
                  onValueChange={onToggleDailyQuote}
                />
                <HintIcon hintKey="hints.settings.dailyQuote" testID="hint.daily-quote" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {t('settings.dailyQuote.title', { defaultValue: 'Daily Quote' })}
            </Text>
            <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]}>
              {t('settings.dailyQuoteDescription', { defaultValue: 'Show a personal philosopher quote on Home' })}
            </Text>
          </View>
        </GroupRow>
        <GroupRow
          testID={isPro ? 'settings.row.daily-quote-personalization' : 'settings.row.ai-locked-daily-quote-personalization'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.daily-quote-personalization"
                  value={isAIEnabled ? (dailyQuoteEnabled ? dailyQuotePersonalizationEnabled : false) : false}
                  onValueChange={onToggleDailyQuotePersonalization}
                  disabled={!isAIEnabled || !dailyQuoteEnabled}
                />
                <HintIcon hintKey="hints.settings.dailyQuotePersonalization" testID="hint.daily-quote-personalization" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {t('settings.aiPersonalization.label', { defaultValue: 'AI Personalization' })}
            </Text>
            <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]}>
              {t('settings.aiPersonalization.description', { defaultValue: 'Personalize quotes based on your notes' })}
            </Text>
          </View>
        </GroupRow>
        <GroupRow
          testID={isPro ? 'settings.row.daily-quote-show-sources' : 'settings.row.ai-locked-show-sources'}
          onPress={isPro ? undefined : () => promptProUpgrade(t, onOpenPaywall)}
          trailing={
            isPro ? (
              <View className="flex-row items-center gap-2">
                <Toggle
                  testID="settings.toggle.daily-quote-show-sources"
                  value={isAIEnabled ? (dailyQuoteEnabled ? dailyQuoteSourceVisible : false) : false}
                  onValueChange={onToggleDailyQuoteSourceVisible}
                  disabled={!isAIEnabled || !dailyQuoteEnabled}
                />
                <HintIcon hintKey="hints.settings.dailyQuoteShowSources" testID="hint.daily-quote-show-sources" />
              </View>
            ) : (
              <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
            )
          }
        >
          <View>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              {t('settings.dailyQuoteSource.label', { defaultValue: 'Show Sources' })}
            </Text>
            <Text style={[styles.settingValue, { color: colors.textSecondary, fontSize: 12, marginTop: 2 }]}>
              {t('settings.dailyQuoteSource.description', { defaultValue: 'Show the book/work the quote is from' })}
            </Text>
          </View>
        </GroupRow>
      </Group>

      {!isPro || isAIEnabled ? (
        <>
        <Group>
          <GroupRow
            testID={isPro ? 'settings.button.model-selector' : 'settings.row.ai-locked-model'}
            onPress={isPro ? onOpenModelSelector : () => promptProUpgrade(t, onOpenPaywall)}
            trailing={
              isPro ? (
                <View className="flex-row items-center gap-1">
                  <Text style={[styles.settingValue, { color: colors.textSecondary }]}>{selectedModelName}</Text>
                  <HintIcon hintKey="hints.settings.model" testID="hint.model" />
                </View>
              ) : (
                <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
              )
            }
          >
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.model')}</Text>
          </GroupRow>
          <GroupRow
            testID={isPro ? 'settings.button.toggle-action-mode' : 'settings.row.ai-locked-action-mode'}
            onPress={isPro ? onToggleActionMode : () => promptProUpgrade(t, onOpenPaywall)}
            trailing={
              isPro ? (
                <View className="flex-row items-center gap-1">
                  <Text style={[styles.settingValue, { color: colors.textSecondary }]}>{actionMode === 'auto' ? t('settings.auto') : t('settings.confirm')}</Text>
                  <HintIcon hintKey={actionMode === 'auto' ? 'hints.settings.actionModeAuto' : 'hints.settings.actionModeConfirm'} testID="hint.action-mode" />
                </View>
              ) : (
                <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
              )
            }
          >
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.actionMode')}</Text>
          </GroupRow>
          <GroupRow
            testID={isPro ? 'settings.button.chat-repo-picker' : 'settings.row.ai-locked-chat-storage'}
            onPress={isPro ? onOpenChatRepoPicker : () => promptProUpgrade(t, onOpenPaywall)}
            trailing={
              isPro ? (
                <View className="flex-row items-center gap-1">
                  <Text style={[styles.settingValue, { color: colors.textSecondary }]}>{chatStorageLabel}</Text>
                  <HintIcon hintKey="hints.settings.chatStorage" testID="hint.chat-storage" />
                </View>
              ) : (
                <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
              )
            }
          >
            <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.chatStorage')}</Text>
          </GroupRow>
        </Group>

        <Group>
          <GroupRow
            testID={isPro ? 'settings.button.reset-ai-memory' : 'settings.row.ai-locked-reset-memory'}
            onPress={isPro ? handleResetAIMemory : () => promptProUpgrade(t, onOpenPaywall)}
            trailing={
              isPro ? undefined : (
                <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
              )
            }
          >
            <Text style={[styles.settingLabel, { color: colors.error }]}>{t('settings.resetAIMemory')}</Text>
          </GroupRow>
        </Group>

        <Group title={t('settings.providers')}>
          {visibleProviders.map((provider) => {
            const availability = providerAvailability[provider.id];
            const isUnavailable = availability?.kind === 'unavailable';
            const reasonText = isUnavailable
              ? describeAvailability(t, availability.reason)
              : null;
            return (
              <GroupRow
                key={provider.id}
                testID={isPro ? 'settings.button.provider' : 'settings.row.ai-locked-provider'}
                onPress={isPro ? () => onProviderPress(provider) : () => promptProUpgrade(t, onOpenPaywall)}
                trailing={
                  isPro ? (
                    <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                      {isUnavailable
                        ? t('settings.unavailable')
                        : provider.isEnabled
                          ? t('settings.enabled')
                          : t('settings.disabled')}
                    </Text>
                  ) : (
                    <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
                  )
                }
                style={isPro && isUnavailable ? { opacity: 0.5 } : undefined}
              >
                <View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>{provider.name}</Text>
                  {reasonText ? (
                    <Text style={[styles.settingValue, { color: colors.textSecondary, marginTop: 2 }]}>
                      {reasonText}
                    </Text>
                  ) : null}
                </View>
              </GroupRow>
            );
          })}
          <GroupRow
            testID={isPro ? 'settings.button.add-provider' : 'settings.row.ai-locked-add-provider'}
            onPress={isPro ? onAddProvider : () => promptProUpgrade(t, onOpenPaywall)}
            trailing={
              isPro ? (
                <HintIcon hintKey="hints.settings.providers" testID="hint.providers" />
              ) : (
                <Ionicons name="lock-closed" size={18} color={colors.textSecondary} />
              )
            }
          >
            <Text style={[styles.settingLabel, { color: colors.primary }]}>{t('settings.addProvider')}</Text>
          </GroupRow>
        </Group>

        {isPro && isAIEnabled ? <ReminderSection colors={colors} /> : null}
        </>
      ) : null}

      <Group title={t('settings.about')}>
        <GroupRow
          trailing={<Text style={[styles.settingValue, { color: colors.textSecondary }]}>{Constants.expoConfig?.version ?? '—'}</Text>}
        >
          <Text style={[styles.settingLabel, { color: colors.text }]}>{t('settings.version')}</Text>
        </GroupRow>
        <GroupRow
          testID="settings.row.report-issue"
          onPress={() => Linking.openURL('https://github.com/skepjandi/gitnotes/issues')}
          trailing={<Ionicons name="open-outline" size={18} color={colors.accent} />}
        >
          <Text style={[styles.settingLabel, { color: colors.primary }]}>{t('settings.reportIssue')}</Text>
        </GroupRow>
      </Group>

      <View style={styles.creditsWrap}>
        <Text style={[styles.creditsText, { color: colors.textSecondary }]} numberOfLines={1}>
          Made with love by{' '}
          <Text style={{ color: colors.accent }} onPress={() => Linking.openURL('https://www.vidwadeseram.com/')}>Vidwa De Seram</Text>
          {' '}in collaboration with{' '}
          <Text style={{ color: colors.accent }} onPress={() => Linking.openURL('https://xaventra.com/')}>Xaventra</Text>
        </Text>
      </View>

      <View style={styles.bottomPad} />
    </ScrollView>

    <Modal
      visible={showTimeoutPicker}
      onRequestClose={() => setShowTimeoutPicker(false)}
      bottomSheet
      contentStyle={{ padding: 16, paddingBottom: 34 }}
    >
      <View className="flex-row justify-between items-center mb-3">
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{t('settings.lockTimeout')}</Text>
        <TouchableOpacity onPress={() => setShowTimeoutPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Group>
        {TIMEOUT_OPTIONS.map((opt) => {
          const isActive = opt.value === lockTimeout;
          return (
            <GroupRow
              key={opt.value}
              onPress={() => {
                onSetLockTimeout(opt.value);
                setShowTimeoutPicker(false);
              }}
              trailing={isActive ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            >
              <Text style={{ color: isActive ? colors.primary : colors.text, fontSize: 16 }}>{opt.label}</Text>
            </GroupRow>
          );
        })}
      </Group>
    </Modal>

    <Modal
      visible={showLanguagePicker}
      onRequestClose={() => setShowLanguagePicker(false)}
      bottomSheet
      contentStyle={{ padding: 16, paddingBottom: 34 }}
    >
      <View className="flex-row justify-between items-center mb-3">
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{t('settings.language')}</Text>
        <TouchableOpacity onPress={() => setShowLanguagePicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Group>
        {SUPPORTED_LANGUAGES.map((lang) => {
          const isActive = languagePref === lang.code;
          return (
            <GroupRow
              key={lang.code}
              testID="settings.button.language"
              onPress={async () => {
                await setLanguage(lang.code as LanguageCode);
                setLanguagePref(lang.code);
                setShowLanguagePicker(false);
              }}
              trailing={isActive ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            >
              <Text style={{ color: isActive ? colors.primary : colors.text, fontSize: 16 }}>
                {t(`settings.languageOptions.${lang.code}`)}
              </Text>
            </GroupRow>
          );
        })}
      </Group>
    </Modal>

    <Modal
      visible={showResetAIMemoryModal}
      onRequestClose={() => setShowResetAIMemoryModal(false)}
      bottomSheet
      contentStyle={{ padding: 16, paddingBottom: 34 }}
    >
      <View className="flex-row justify-between items-center mb-3">
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{t('settings.resetAIMemoryConfirm')}</Text>
        <TouchableOpacity onPress={() => setShowResetAIMemoryModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 15, marginBottom: 20 }}>
        {t('settings.resetAIMemoryMessage')}
      </Text>
      <TouchableOpacity
        testID="settings.button.confirm-reset-ai-memory"
        onPress={() => { void confirmResetAIMemory(); }}
        className="rounded-lg items-center py-3.5"
        style={{ backgroundColor: colors.error }}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t('common.reset')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setShowResetAIMemoryModal(false)}
        className="mt-3 py-3.5 rounded-lg items-center"
        style={{ backgroundColor: colors.surface }}
      >
        <Text style={{ color: colors.text, fontSize: 16 }}>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </Modal>
    </>
  );
}
