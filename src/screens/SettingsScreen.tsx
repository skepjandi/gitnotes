import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../components/ui';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../contexts/ThemeContext';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import HexColorPickerModal from '../components/HexColorPickerModal';
import { useNotes } from '../contexts/NoteContext';
import { useAuth } from '../contexts/AuthContext';
import { useRepos } from '../contexts/RepoContext';
import { useCanvases } from '../contexts/CanvasContext';
import { useTodos } from '../contexts/TodoContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { useForegroundSyncSettings } from '../hooks/useForegroundSyncSettings';
import { useForegroundSyncHealth } from '../hooks/useForegroundSyncHealth';
import type { RootStackParamList } from '../navigation/types';
import { GitHubService } from '../services/GitHubService';
import { type GitHostRepository, type GitHostRepositoryResult } from '../services/git/GitHost';
import { RepoFileSyncService } from '../services/RepoFileSyncService';
import { TemplateRepoPreferenceService, type TemplateRepoPreference } from '../services/TemplateRepoPreferenceService';
import { serializeTemplate, templateSlug } from '../services/TemplateMarkdownService';
import { NoteSyncQueueService } from '../services/cloneSyncServiceImpl';

import { GitFsService } from '../services/git/GitFsService';
import { cancelInflightGitHttp } from '../services/git/gitHttp';
import { CloneMigrationService } from '../services/git/CloneMigrationService';
import { getActiveBranch } from '../services/git/activeBranchStore';
import { LfsService } from '../services/git/lfs';
import { AuthService, type HostConnectionSummary } from '../services/AuthService';
import { GitHubOAuthService } from '../services/GitHubOAuthService';
import { GitHubAppService } from '../services/GitHubAppService';
import type { GitHubAppCredentialRecord } from '../services/git/contracts/GitHubAppCredential';
import type { CredentialKind } from '../services/git/contracts';
import { OAUTH_CALLBACK_URL, WORKER_BASE_URL } from '../types/worker';
import { OnboardingService } from '../services/OnboardingService';
import { HapticService } from '../utils/haptics';
import { createThrottledEmitter } from '../utils/progressThrottle';
import { useTemplateStore } from '../stores/templateStore';
import { useAIStore } from '../stores/aiStore';
import type { AIProviderConfig } from '../models/AIProvider';
import { GIT_HOST_LABELS, type GitHostProvider } from '../services/git/GitHost';
import { getGitHostService } from '../services/git/gitHostFactory';
import { ModelSelector } from '../components/ai/ModelSelector';
import { ProviderConfigModal } from '../components/ai/ProviderConfigModal';
import { ChatRepoPickerModal } from '../components/ai/ChatRepoPickerModal';
import { ConnectHostModal } from '../components/ConnectHostModal';
import { Group, GroupRow, ScreenHeader, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SettingsContent } from '../components/settings/SettingsContent';
import { SettingsModals } from '../components/settings/SettingsModals';
import { SSHKeyModal } from '../components/settings/SettingsModals';
import { CloneProgressModal, type CloneProgress } from '../components/settings/CloneProgressModal';
import type { GitRepository } from '../services/GitService';
import { reposAffectedByRemovedHosts, reposAffectedByRemovedCredential, buildProviderAccountCount, type RemovedHostRef } from '../services/git/repoRemovalCascade';
import { useRepoStore } from '../stores/repoStore';
import { importRepoAtAdd } from '../services/RepoImportService';
import { useTranslation } from 'react-i18next';

import { AccountStorage } from '../services/AccountStorage';
import { generateSshKey, clearCredential } from '../services/git/engine/GitEngine';
import { RepoAccessPreflightError } from '../services/git/repoAccessPreflight';
import { useProStatus } from '../hooks/useProGate';
import { useFloatingGitButtonStore } from '../stores/floatingGitButtonStore';
import { useProStore } from '../stores/proStore';
import { promptProUpgrade } from '../utils/proAlerts';
import { FREE_TIER_MAX_REPOS, FREE_TIER_MAX_ACCOUNTS } from '../services/TierLimits';
import {
  confirmUnverifiedWrite,
  showTransientAccessConfirmation,
} from './addRepoConfirmation';
import { AppIconService, type AppIconName } from '../services/AppIconService';

// Mirrors GitFsService's MAX_CLONE_RETRIES so a failing repo can't loop the outer flow.
const MAX_OUTER_CLONE_RETRIES = 1;
// The onProgress abort throw may never land (stuck transfer), so cancel force-closes after this.
const CLONE_CANCEL_GRACE_MS = 800;

/**
 * Resolves the backend URL for OAuth/App handlers, normalizes the URL to avoid
 * double /api/v1 paths, and falls back to the Worker default when no override exists.
 */
function resolveBackendUrl(): string {
  const configured = process.env.EXPO_PUBLIC_GITNOTES_BACKEND_URL;
  const base = configured ?? WORKER_BASE_URL;
  return base.replace(/\/api\/v1\/?$/, '');
}

type ImportAtAddOutcome = 'imported' | 'cancelled' | 'failed';



export default function SettingsScreen() {
  const { t } = useTranslation();
  const { theme, colors, setTheme, style: uiStyle, setStyle, accentColor, setAccentColor } = useTheme();
  const { isPro, loading: isProLoading } = useProStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openPaywall = useCallback(() => {
    navigation.navigate('Paywall');
  }, [navigation]);
  const trialActive = useProStore((s) => s.trialActive);
  const trialEndsAt = useProStore((s) => s.trialEndsAt);
  const proStatusLabel = useMemo(() => {
    if (isPro && trialActive && trialEndsAt) {
      const days = Math.max(1, Math.ceil((trialEndsAt - Date.now()) / 86_400_000));
      return t('pro.statusTrial', { days: String(days) });
    }
    if (isPro) return t('pro.statusActive');
    return t('pro.statusUpgrade');
  }, [isPro, trialActive, trialEndsAt, t]);
  const headerHeight = useScreenHeaderHeight();
  const tabBarHeight = useTabBarHeight();
  const { clearAllNotes, refreshNotes } = useNotes();
  const { refreshCanvases } = useCanvases();
  const { refreshTodos } = useTodos();
  const { authState, accounts, activeAccountId, accountSummaries, setToken, addAccount, removeAccount, switchAccount, disconnectHost, disconnectAllHosts, disconnectGitHubOAuth, disconnectGitHubApp, disconnectGitHubPat, refreshAccounts } = useAuth();
  const { repositories, addRepository: addRepo, removeRepository: removeRepo } = useRepos();
  const {
    isLockEnabled: isBiometricLockEnabled,
    isBiometricAvailable,
    biometricKind,
    biometricLabel,
    lockTimeout,
    setIsLockEnabled,
    setLockTimeout,
  } = useBiometricLock();
  const { isEnabled: isBackgroundSyncEnabled, toggle: toggleBackgroundSync } = useBackgroundSync();
  const floatingGitButtonVisible = useFloatingGitButtonStore((s) => s.visible);
  const toggleFloatingGitButton = useFloatingGitButtonStore((s) => s.toggle);
  const {
    syncPaused,
    setSyncPaused,
  } = useForegroundSyncSettings();
  const syncHealth = useForegroundSyncHealth();
  const isAIEnabled = useAIStore((state) => state.isEnabled);
  const selectedModelId = useAIStore((state) => state.selectedModelId);
  const actionMode = useAIStore((state) => state.actionMode);
  const chatRepoOwner = useAIStore((state) => state.chatRepoOwner);
  const chatRepoName = useAIStore((state) => state.chatRepoName);
  const providers = useAIStore((state) => state.providers);
  const toggleAI = useAIStore((state) => state.toggleAI);
  const dailyQuoteEnabled = useAIStore((state) => state.dailyQuoteEnabled);
  const toggleDailyQuote = useAIStore((state) => state.toggleDailyQuote);
  const aiPersonalizationEnabled = useAIStore((state) => state.aiPersonalizationEnabled);
  const toggleAiPersonalization = useAIStore((state) => state.toggleAiPersonalization);
  const githubToolsEnabled = useAIStore((state) => state.githubToolsEnabled);
  const toggleGithubTools = useAIStore((state) => state.toggleGithubTools);
  const dailyQuotePersonalizationEnabled = useAIStore((state) => state.dailyQuotePersonalizationEnabled);
  const toggleDailyQuotePersonalization = useAIStore((state) => state.toggleDailyQuotePersonalization);
  const dailyQuoteSourceVisible = useAIStore((state) => state.dailyQuoteSourceVisible);
  const toggleDailyQuoteSourceVisible = useAIStore((state) => state.toggleDailyQuoteSourceVisible);
  const setActionMode = useAIStore((state) => state.setActionMode);

  const [showRepoPickerModal, setShowRepoPickerModal] = useState(false);
  const [discoverableRepos, setDiscoverableRepos] = useState<GitHostRepositoryResult[]>([]);
  const [isLoadingDiscoverableRepos, setIsLoadingDiscoverableRepos] = useState(false);
  const [manualRepoInput, setManualRepoInput] = useState('');
  const [manualRepoHostId, setManualRepoHostId] = useState<string | null>(null);
  const [isAddingRepoPath, setIsAddingRepoPath] = useState<string | null>(null);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isTestingToken, setIsTestingToken] = useState(false);
  const [tokenTestResult, setTokenTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenModalMode, setTokenModalMode] = useState<'connect' | 'add'>('connect');
  const [showConnectHostModal, setShowConnectHostModal] = useState(false);
  const [connectHostPreset, setConnectHostPreset] = useState<GitHostProvider | undefined>(undefined);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAccentColorPicker, setShowAccentColorPicker] = useState(false);
  const [showProviderConfig, setShowProviderConfig] = useState(false);
  const [showChatRepoPicker, setShowChatRepoPicker] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProviderConfig | undefined>();
  const [syncingRepo, setSyncingRepo] = useState<string | null>(null);
  const [templatesRepoPref, setTemplatesRepoPref] = useState<TemplateRepoPreference | null>(null);
  const [showTemplatesRepoPicker, setShowTemplatesRepoPicker] = useState(false);
  const [cloningRepo, setCloningRepo] = useState<string | null>(null);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);
  const cloneAbortedRef = useRef(false);
  const cloneProgressRef = useRef<CloneProgress | null>(null);
  cloneProgressRef.current = cloneProgress;
  const cloneOuterRetriesRef = useRef(0);
  const [isSyncingExistingTemplates, setIsSyncingExistingTemplates] = useState(false);
  const [lfsPending, setLfsPending] = useState<Record<string, { count: number; bytes: number }>>({});
  const [lfsDownloadingRepo, setLfsDownloadingRepo] = useState<string | null>(null);
  const [showSSHModal, setShowSSHModal] = useState(false);
  const [sshModalHostId, setSshModalHostId] = useState<string | null>(null);
  const [sshKeyData, setSshKeyData] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [sshGenerating, setSshGenerating] = useState(false);
  const [hostUseSsh, setHostUseSsh] = useState<Record<string, boolean>>({});
  const [appIcon, setAppIcon] = useState<AppIconName | null>(null);
  const [appIconSupported, setAppIconSupported] = useState(false);
  const [showAppIconPicker, setShowAppIconPicker] = useState(false);
  const [appIconLoading, setAppIconLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({});
  const [oauthError, setOauthError] = useState<Record<string, string | null>>({});
  const [appLoading, setAppLoading] = useState<Record<string, boolean>>({});
  const [appError, setAppError] = useState<Record<string, string | null>>({});
  const [appCredentials, setAppCredentials] = useState<Record<string, GitHubAppCredentialRecord | null>>({});
  const [hostCredentialKinds, setHostCredentialKinds] = useState<Record<string, CredentialKind[]>>({});
  const [patLoading, setPatLoading] = useState<Record<string, boolean>>({});
  const [patError, setPatError] = useState<Record<string, string | null>>({});
  const pendingConfirmationRef = useRef(false);

  const loadHostUseSsh = useCallback(async (hosts: Array<{ id: string }>) => {
    const results: Record<string, boolean> = {};
    await Promise.all(hosts.map(async (h) => { results[h.id] = await AccountStorage.getHostUseSsh(h.id); }));
    setHostUseSsh(results);
  }, []);

  useEffect(() => {
    if (accountSummaries.length === 0) return;
    const allHosts = accountSummaries.flatMap((s) => s.hosts);
    void loadHostUseSsh(allHosts);
  }, [accountSummaries, loadHostUseSsh]);

  useEffect(() => {
    if (accountSummaries.length === 0) return;
    const githubHostIds = accountSummaries
      .flatMap((s) => s.hosts)
      .filter((h) => h.provider === 'github')
      .map((h) => h.id);
    void Promise.all(
      githubHostIds.map(async (hostId) => {
        const cred = await AccountStorage.getGitHubAppCredential(hostId);
        return [hostId, cred] as const;
      }),
    ).then((entries) => {
      setAppCredentials((prev) => {
        const next: Record<string, GitHubAppCredentialRecord | null> = { ...prev };
        for (const [hostId, cred] of entries) {
          next[hostId] = cred;
        }
        return next;
      });
    });
  }, [accountSummaries]);

  const loadHostCredentialKinds = useCallback(async (hosts: Array<{ id: string }>) => {
    const results: Record<string, CredentialKind[]> = {};
    await Promise.all(hosts.map(async (h) => {
      const kinds: CredentialKind[] = [];
      const [token, oauth, githubApp] = await Promise.all([
        AccountStorage.getHostToken(h.id),
        AccountStorage.getOAuthCredential(h.id),
        AccountStorage.getGitHubAppCredential(h.id),
      ]);
      if (token) kinds.push('token');
      if (oauth) kinds.push('oauth');
      if (githubApp) kinds.push('github_app');
      const useSsh = await AccountStorage.getHostUseSsh(h.id);
      if (useSsh) kinds.push('ssh');
      results[h.id] = kinds;
    }));
    return results;
  }, []);

  useEffect(() => {
    let disposed = false;
    const allHosts = accountSummaries.flatMap((s) => s.hosts);
    setHostCredentialKinds({});
    void loadHostCredentialKinds(allHosts).then((results) => {
      if (!disposed) setHostCredentialKinds(results);
    });
    return () => {
      disposed = true;
    };
  }, [accountSummaries, loadHostCredentialKinds]);

  useEffect(() => {
    TemplateRepoPreferenceService.get().then(setTemplatesRepoPref);
  }, []);

  // Hydrate app icon state on mount
  useEffect(() => {
    const init = async () => {
      const [hydration, supported] = await Promise.all([
        AppIconService.hydrate(),
        AppIconService.isSupported(),
      ]);
      setAppIcon(hydration.current);
      setAppIconSupported(supported);
    };
    void init();
  }, []);

  const refreshLfsPending = useCallback(async (repoPaths: string[]) => {
    const next: Record<string, { count: number; bytes: number }> = {};
    for (const path of repoPaths) {
      const items = await LfsService.listPending(path);
      if (items.length > 0) {
        const bytes = items.reduce((acc, item) => acc + item.pointer.size, 0);
        next[path] = { count: items.length, bytes };
      }
    }
    setLfsPending(next);
  }, []);

  useEffect(() => {
    if (repositories.length === 0) {
      setLfsPending({});
      return;
    }
    void refreshLfsPending(repositories.map((r) => r.path));
  }, [repositories, refreshLfsPending]);

  const handlePasteToken = useCallback(async () => {
    try {
      const { getStringAsync } = await import('expo-clipboard');
      const text = await getStringAsync();
      if (text.trim()) {
        setTokenInput(text.trim());
        setTokenError(null);
        HapticService.success();
      }
    } catch (error) {
      console.warn('[SettingsScreen] handleTokenInput failed:', error);
      HapticService.error();
    }
  }, []);

  const handleCopyToken = useCallback(async () => {
    if (!tokenInput.trim()) return;
    try {
      const { setStringAsync } = await import('expo-clipboard');
      await setStringAsync(tokenInput.trim());
      HapticService.success();
    } catch (error) {
      console.warn('[SettingsScreen] handleCopyToken failed:', error);
      HapticService.error();
    }
  }, [tokenInput]);

  const handlePickTemplatesRepo = useCallback(async (repo: GitRepository) => {
    const next = { repoPath: repo.path };
    await TemplateRepoPreferenceService.set(next);
    setTemplatesRepoPref(next);
    setShowTemplatesRepoPicker(false);
    HapticService.success();
  }, []);

  const handleClearTemplatesRepo = useCallback(async () => {
    await TemplateRepoPreferenceService.clear();
    setTemplatesRepoPref(null);
    HapticService.success();
  }, []);

  const handleEnableCloneMode = useCallback(async (repo: GitRepository, isRetry = false) => {
    if (!GitHubService.isAuthenticated()) {
      Alert.alert(t('settings.githubRequiredTitle'), t('settings.githubRequiredBody'));
      return;
    }
    if (!isRetry) {
      cloneOuterRetriesRef.current = 0;
    }
    setCloningRepo(repo.path);
    cloneAbortedRef.current = false;
    setCloneProgress({ repoName: repo.name, phase: t('settings.clonePhasePreparing'), loaded: 0, total: null });
    const throttled = createThrottledEmitter((phase, loaded, total) => setCloneProgress({ repoName: repo.name, phase, loaded, total }));
    try {
      const token = (await AuthService.getToken()) ?? undefined;
      const branch = repo.branch || 'main';
      if (!(await GitFsService.isCloned({ repoPath: repo.path }))) {
        await GitFsService.clone({
          repoPath: repo.path,
          branch,
          token,
          onProgress: (phase, loaded, total) => {
            if (cloneAbortedRef.current) {
              throw new Error('CLONE_CANCELLED');
            }
            throttled.push(phase, loaded, total);
          },
        });
      }
      if (cloneAbortedRef.current) {
        await GitFsService.removeRepo({ repoPath: repo.path }).catch(() => undefined);
        return;
      }
      throttled.flush();
      setCloneProgress(null);
      void refreshLfsPending([repo.path]);
      HapticService.success();
      Alert.alert(t('settings.cloneEnabledTitle'), t('settings.cloneEnabledBody', { name: repo.name }), [
        { text: t('common.skip'), style: 'cancel' },
        {
          text: t('settings.pushEdits'),
          onPress: async () => {
            try {
              const report = await CloneMigrationService.migrateRepo(repo.path, branch);
              const total = report.notes + report.todos + report.canvases + report.templates;
              if (report.failures.length > 0) {
                HapticService.error();
                Alert.alert(t('settings.migrationIssuesTitle'), t('settings.migrationIssuesBody', { total, failures: report.failures.length }));
                report.failures.forEach((failure) => console.warn('[CloneMigration]', failure.kind, failure.filePath, failure.error));
              } else {
                HapticService.success();
                Alert.alert(t('settings.pushedEditsTitle'), t('settings.pushedEditsBody', { total, name: repo.name }));
              }
    } catch (error) {
      HapticService.error();
              Alert.alert(t('settings.migrationFailedTitle'), error instanceof Error ? error.message : String(error));
            }
          },
        },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (cloneAbortedRef.current) return;
      if (
        /Packfile trailer mismatch|packfile may be corrupted/i.test(errorMessage) &&
        cloneOuterRetriesRef.current < MAX_OUTER_CLONE_RETRIES
      ) {
        cloneOuterRetriesRef.current += 1;
        await GitFsService.removeRepo({ repoPath: repo.path }).catch(() => undefined);
        setCloneProgress({
          repoName: repo.name,
          phase: t('settings.clonePhaseRetrying'),
          loaded: 0,
          total: null,
          error: t('settings.cloneFailedRetryError', { error: errorMessage }),
        });
        setTimeout(() => {
          if (cloneAbortedRef.current) return;
          handleEnableCloneMode(repo, true).catch((retryError) => {
            setCloneProgress({
              repoName: repo.name,
              phase: t('settings.clonePhaseFailed'),
              loaded: 0,
              total: null,
              error: retryError instanceof Error ? retryError.message : String(retryError),
            });
          });
        }, 1500);
        return;
      }
      await GitFsService.removeRepo({ repoPath: repo.path }).catch(() => undefined);
      HapticService.error();
      setCloneProgress({
        repoName: repo.name,
        phase: t('settings.clonePhaseFailed'),
        loaded: 0,
        total: null,
        error: errorMessage,
      });
    } finally {
      setCloningRepo(null);
      if (cloneAbortedRef.current) {
        setCloneProgress(null);
      }
    }
  }, [refreshLfsPending, t]);

  const handleCancelClone = useCallback(() => {
    cloneAbortedRef.current = true;
    // Abort the in-flight git HTTP request so a clone stuck inside the
    // fetch (never reaching onProgress) is actually cancelled instead of
    // waiting out the full timeout with the blocking modal open (#1016).
    cancelInflightGitHttp();
    if (cloneProgressRef.current?.error) {
      setCloneProgress(null);
      return;
    }
    setCloneProgress((prev) => (prev ? { ...prev, phase: t('settings.clonePhaseCancelling') } : prev));
    setTimeout(() => {
      setCloneProgress((prev) =>
        prev && prev.phase === t('settings.clonePhaseCancelling') ? null : prev,
      );
    }, CLONE_CANCEL_GRACE_MS);
  }, [t]);

  const handleRetryClone = useCallback(() => {
    if (cloningRepo) {
      const repo = repositories.find((r) => r.path === cloningRepo);
      if (repo) {
        setCloneProgress(null);
        handleEnableCloneMode(repo, true).catch(() => {/* noop */});
      }
    }
  }, [cloningRepo, repositories, handleEnableCloneMode]);

  const handleDownloadLfsObjects = useCallback(async (repo: GitRepository) => {
    const token = (await AuthService.getToken()) ?? undefined;
    if (!token) {
      Alert.alert(t('settings.lfsGithubRequiredTitle'), t('settings.lfsGithubRequiredBody'));
      return;
    }
    setLfsDownloadingRepo(repo.path);
    try {
      const items = await LfsService.listPending(repo.path);
      const workingTreeUri = GitFsService.workingTreeUri({ repoPath: repo.path });
      const root = workingTreeUri.endsWith('/') ? workingTreeUri : `${workingTreeUri}/`;
      let succeeded = 0;
      const failures: { path: string; error: string }[] = [];
      for (const item of items) {
        try {
          await LfsService.downloadObject({
            repoPath: repo.path,
            filePath: item.path,
            fileUri: `${root}${item.path}`,
            accessToken: token,
          });
          succeeded++;
        } catch (e) {
          failures.push({ path: item.path, error: e instanceof Error ? e.message : String(e) });
        }
      }
      await refreshLfsPending([repo.path]);
      if (failures.length === 0) {
        HapticService.success();
        Alert.alert(t('settings.lfsDoneTitle'), t('settings.lfsDoneBody', { count: succeeded, name: repo.name }));
      } else {
        HapticService.error();
        Alert.alert(
          t('settings.lfsFailedTitle'),
          t('settings.lfsFailedBody', { count: succeeded, failed: failures.length, details: failures[0].error }),
        );
      }
    } finally {
      setLfsDownloadingRepo(null);
    }
  }, [refreshLfsPending, t]);

  const handleSyncExistingTemplates = useCallback(async () => {
    if (!templatesRepoPref) return;
    const unsynced = useTemplateStore.getState().customTemplates.filter((template) => !template.filePath);
    if (unsynced.length === 0) {
      Alert.alert(t('settings.nothingToSyncTitle'), t('settings.nothingToSyncBody'));
      return;
    }
    const repoId = repositories.find((r) => r.path === templatesRepoPref.repoPath)?.id;
    const activeBranchState = repoId ? await getActiveBranch(repoId) : null;
    const branch = activeBranchState?.activeBranch ?? 'main';
    setIsSyncingExistingTemplates(true);
    let synced = 0;
    let failed = 0;
    try {
      for (const template of unsynced) {
        const filePath = `templates/${templateSlug(template.name)}.md`;
        try {
          await NoteSyncQueueService.enqueueNoteUpsert({
            repo: templatesRepoPref.repoPath,
            branch,
            filePath,
            title: template.name,
            content: serializeTemplate({ ...template, filePath: undefined }),
          });
          await useTemplateStore.getState().updateTemplate(template.id, { filePath });
          synced++;
        } catch {
          failed++;
        }
      }
    } finally {
      setIsSyncingExistingTemplates(false);
    }
    if (failed === 0) HapticService.success();
    else HapticService.error();
    Alert.alert(
      t('settings.templatesSyncDoneTitle'),
      failed === 0
        ? t('settings.templatesSyncDoneBody', { count: synced, path: templatesRepoPref.repoPath })
        : t('settings.templatesSyncDonePartial', { count: synced, failed }),
    );
  }, [repositories, templatesRepoPref, t]);

  const handleSyncRepo = useCallback(async (repo: GitRepository) => {
    if (!GitHubService.isAuthenticated()) {
      Alert.alert(t('settings.githubRequiredSyncTitle'), t('settings.githubRequiredSyncBody'));
      return;
    }
    setSyncingRepo(repo.path);
    try {
      const result = await RepoFileSyncService.syncRepoFiles(repo.path);
      HapticService.success();
      if (result.created > 0) {
        await refreshNotes();
        Alert.alert(t('settings.syncCompleteImportedTitle'), t('settings.syncCompleteImportedBody', { count: result.created, name: repo.name }));
      } else if (result.skipped > 0) {
        Alert.alert(t('settings.syncCompleteImportedTitle'), t('settings.syncCompleteSkippedBody', { count: result.total }));
      } else if (result.errors.length > 0) {
        Alert.alert(t('settings.syncIssuesTitle'), t('settings.syncIssuesBody', { count: result.errors.length, details: result.errors.slice(0, 3).join('\n') }));
      } else {
        Alert.alert(t('settings.noFilesTitle'), t('settings.noFilesBody'));
      }
    } catch (error) {
      HapticService.error();
      Alert.alert(t('settings.syncFailedTitle'), error instanceof Error ? error.message : t('settings.syncFailedBody'));
    } finally {
      setSyncingRepo(null);
    }
  }, [refreshNotes, t]);

  /**
   * #938 — import repo contents right after the repo is added and AWAIT the
   * outcome, so the picker stays busy until contents actually land. The
   * picker closes from here on success/cancel only — never on failure.
   *
   * `importRepoAtAdd` acquires NO sync-gate cycle — it never waits on
   * StartupSyncGate. The only real interaction is a concurrent startup-pull
   * lazy clone on the same repoPath, already mitigated by the
   * GitFsService.clone in-flight promise dedup + `isCloned` short-circuit.
   * Cancel goes through `cloneAbortedRef` (same machinery as
   * handleEnableCloneMode); the one packfile-corruption retry happens inside
   * GitFsService.cloneExclusive.
   */
  const importRepoAfterAdd = useCallback(async (repoPath: string, repoName: string, repoSizeKb?: number): Promise<ImportAtAddOutcome> => {
    const retryImport = async (): Promise<void> => {
      setIsAddingRepoPath(repoPath);
      try {
        await importRepoAfterAdd(repoPath, repoName, repoSizeKb);
      } finally {
        setIsAddingRepoPath(null);
      }
    };
    cloneAbortedRef.current = false;
    setCloneProgress({ repoName, phase: t('settings.clonePhasePreparing'), loaded: 0, total: null });
    const throttled = createThrottledEmitter((phase, loaded, total) => setCloneProgress({ repoName, phase, loaded, total }));
    const result = await importRepoAtAdd(repoPath, repoName, (phase, loaded, total) => {
      if (cloneAbortedRef.current) {
        throw new Error('CLONE_CANCELLED');
      }
      throttled.push(phase, loaded, total);
    });
    throttled.flush();
    setCloneProgress(null);
    if (cloneAbortedRef.current) {
      // Cancel: abort stops the import; the repo stays added and its
      // contents come in on the next pull.
      setShowRepoPickerModal(false);
      Alert.alert(t('common.success'), t('settings.autoSyncFailedBody', { name: repoName }), [
        { text: t('common.ok') },
      ]);
      return 'cancelled';
    }
    if (!result.ok) {
      HapticService.error();
      Alert.alert(
        t('settings.autoSyncFailedTitle'),
        result.error,
        result.retryable
          ? [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.retry'), onPress: () => void retryImport() },
            ]
          : [{ text: t('common.ok') }],
      );
      return 'failed';
    }
    await Promise.all([refreshNotes(), refreshCanvases(), refreshTodos()]);
    if (
      result.counts.notes === 0 &&
      result.counts.canvases === 0 &&
      result.counts.todos === 0 &&
      result.counts.templates === 0
    ) {
      console.warn('[SettingsScreen] add-repo import pulled zero contents', { repoPath, counts: result.counts });
    }
    setShowRepoPickerModal(false);
    return 'imported';
  }, [refreshCanvases, refreshNotes, refreshTodos, t]);

  const openRepoPicker = useCallback(async () => {
    setRepoSearchQuery('');
    setManualRepoInput('');
    setDiscoverableRepos([]);
    setShowRepoPickerModal(true);
    setIsLoadingDiscoverableRepos(true);
    const allHosts = accountSummaries.flatMap((s) => s.hosts);
    setManualRepoHostId(allHosts.length === 1 ? allHosts[0].id : null);
    try {
      const allRepos: GitHostRepositoryResult[] = [];
      const eligibleHosts = await Promise.all(
        accountSummaries.flatMap((summary) =>
          summary.hosts.map(async (host) => {
            const token = await AccountStorage.getHostToken(host.id);
            const appCred = await AccountStorage.getGitHubAppCredential(host.id);
            const oauthCred = await AccountStorage.getOAuthCredential(host.id);
            return token || appCred || oauthCred ? { host } : null;
          }),
        ),
      );
      const validHosts = eligibleHosts.filter((h): h is { host: HostConnectionSummary } => h !== null);
      await Promise.all(
        validHosts.map(async ({ host }) => {
          try {
            const service = getGitHostService(host.provider);
            const repos = await service.listRepositories(host.id);
            const tagged = repos.map((r) => {
              if ('kind' in r && r.kind === 'unavailable') return r;
              return { ...r, hostId: host.id };
            });
            allRepos.push(...tagged);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            allRepos.push({ kind: 'unavailable', provider: host.provider, reason: message });
          }
        }),
      );
      setDiscoverableRepos(allRepos);
    } catch (error) {
      console.warn('[SettingsScreen] openRepoPicker failed:', error);
      setDiscoverableRepos([]);
    } finally {
      setIsLoadingDiscoverableRepos(false);
    }
  }, [accountSummaries]);

  const handleSelectRepo = useCallback(async (repo: GitHostRepository) => {
    if (isAddingRepoPath !== null || pendingConfirmationRef.current) return;
    if (repositories.length >= FREE_TIER_MAX_REPOS && !isPro) {
      promptProUpgrade(t, openPaywall);
      return;
    }
    if (repositories.some((item) => item.path === repo.fullName)) {
      setShowRepoPickerModal(false);
      return;
    }
    const attemptAdd = async (allowUnverifiedWrite: boolean): Promise<void> => {
      setIsAddingRepoPath(repo.fullName);
      try {
        if (allowUnverifiedWrite) {
          await addRepo(repo.fullName, repo.name, repo.provider, { allowUnverifiedWrite: true }, repo.hostId);
        } else {
          await addRepo(repo.fullName, repo.name, repo.provider, undefined, repo.hostId);
        }
        HapticService.success();
        await importRepoAfterAdd(repo.fullName, repo.name, repo.sizeKb);
      } catch (error) {
        if (error instanceof RepoAccessPreflightError) {
          if (error.result.kind === 'transient' && error.canRetry && !allowUnverifiedWrite) {
            showTransientAccessConfirmation(t, Alert.alert, pendingConfirmationRef, () => void attemptAdd(false));
            return;
          }
          if (error.canRetry && !allowUnverifiedWrite) {
            confirmUnverifiedWrite(t, () => void attemptAdd(true), Alert.alert, pendingConfirmationRef);
            return;
          }
          console.warn('[SettingsScreen] handleSelectRepo failed:', error);
          HapticService.error();
          Alert.alert(t('settings.repositoryAccessTitle'), error.message);
          return;
        }
        console.warn('[SettingsScreen] handleSelectRepo failed:', error);
        HapticService.error();
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsAddingRepoPath(null);
      }
    };
    await attemptAdd(false);
  }, [addRepo, importRepoAfterAdd, repositories, t, isPro, openPaywall, isAddingRepoPath, pendingConfirmationRef]);

  const handleAddManualRepo = useCallback(async (hostId: string | null) => {
    if (isAddingRepoPath !== null || pendingConfirmationRef.current) return;
    const value = manualRepoInput.trim();
    if (!value) return;
    if (repositories.length >= FREE_TIER_MAX_REPOS && !isPro) {
      promptProUpgrade(t, openPaywall);
      return;
    }

    if (hostId === null) {
      Alert.alert(t('settings.repositoryAccessTitle'), t('settings.selectHostManually'));
      return;
    }
    const resolvedHostId = hostId;

    const attemptAdd = async (allowUnverifiedWrite: boolean): Promise<void> => {
      setIsAddingRepoPath(value);
      try {
        // Look up the selected host to derive its provider.
        const hostSummary = accountSummaries
          .flatMap((s) => s.hosts)
          .find((h) => h.id === resolvedHostId);
        if (!hostSummary) {
          throw new Error('Selected host not found. Please reconnect your account.');
        }
        const provider = hostSummary.provider;
        if (allowUnverifiedWrite) {
          await addRepo(value, undefined, provider, { allowUnverifiedWrite: true }, resolvedHostId);
        } else {
          await addRepo(value, undefined, provider, undefined, resolvedHostId);
        }
        setManualRepoInput('');
        setManualRepoHostId(null);
        HapticService.success();
        await importRepoAfterAdd(value, value);
      } catch (error) {
        if (error instanceof RepoAccessPreflightError) {
          if (error.result.kind === 'transient' && error.canRetry && !allowUnverifiedWrite) {
            showTransientAccessConfirmation(t, Alert.alert, pendingConfirmationRef, () => void attemptAdd(false));
            return;
          }
          if (error.canRetry && !allowUnverifiedWrite) {
            confirmUnverifiedWrite(t, () => void attemptAdd(true), Alert.alert, pendingConfirmationRef);
            return;
          }
          console.warn('[SettingsScreen] handleAddManualRepo failed:', error);
          HapticService.error();
          Alert.alert(t('settings.repositoryAccessTitle'), error.message);
          return;
        }
        console.warn('[SettingsScreen] handleAddManualRepo failed:', error);
        HapticService.error();
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsAddingRepoPath(null);
      }
    };
    await attemptAdd(false);
  }, [addRepo, importRepoAfterAdd, manualRepoInput, t, repositories, isPro, openPaywall, isAddingRepoPath, pendingConfirmationRef, accountSummaries]);

  const handleRemoveRepo = useCallback((repo: GitRepository) => {
    HapticService.warning();
    Alert.alert(t('settings.removeRepoTitle'), t('settings.removeRepoBody', { name: repo.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeRepo(repo.path, repo.provider);
            HapticService.success();
          } catch (err) {
            HapticService.error();
            Alert.alert(
              t('errors.somethingWrong'),
              err instanceof Error ? err.message : t('errors.somethingWrong'),
            );
          }
        },
      },
    ]);
  }, [removeRepo, t]);

  const handleSaveToken = useCallback(async () => {
    if (!tokenInput.trim()) {
      setTokenError(t('settings.tokenRequired'));
      return;
    }
    setIsVerifying(true);
    setTokenError(null);
    const ok = tokenModalMode === 'add' ? !!(await addAccount(tokenInput.trim())) : await setToken(tokenInput.trim());
    setIsVerifying(false);
    if (ok) {
      HapticService.success();
      setShowTokenModal(false);
      setTokenInput('');
      setTokenVisible(false);
      setTokenModalMode('connect');
    } else {
      HapticService.error();
      // Paste-time diagnostics (#1190): distinguish a rejected token from a
      // network failure instead of one generic copy.
      const diag = await AuthService.validateToken(tokenInput.trim());
      if (!diag.ok) {
        switch (diag.reason) {
          case 'invalid':
            setTokenError(t('settings.tokenTestInvalid'));
            break;
          case 'missing_repo_scope':
            setTokenError(t('settings.tokenMissingRepoScope'));
            break;
          case 'missing_contents_permission':
            setTokenError(t('settings.tokenMissingContentsPermission'));
            break;
          case 'saml':
            setTokenError(t('settings.tokenSamlError'));
            break;
          case 'no_repository_access':
            setTokenError(t('settings.tokenNoRepoAccess'));
            break;
          case 'network':
            setTokenError(t('settings.tokenTestNetwork'));
            break;
          default: {
            setTokenError(t('settings.tokenInvalid'));
          }
        }
      } else {
        setTokenError(t('settings.tokenInvalid'));
      }
    }
  }, [addAccount, setToken, tokenInput, tokenModalMode, t]);

  const handleTestToken = useCallback(async () => {
    const candidate = tokenInput.trim();
    if (!candidate || isTestingToken) return;
    setIsTestingToken(true);
    setTokenTestResult(null);
    const diag = await AuthService.validateToken(candidate);
    if (diag.ok) {
      HapticService.success();
      setTokenTestResult({ ok: true, text: t('settings.tokenTestOk', { login: diag.user.login }) });
    } else {
      HapticService.error();
      let errorText: string;
      switch (diag.reason) {
        case 'invalid':
          errorText = t('settings.tokenTestInvalid');
          break;
        case 'missing_repo_scope':
          errorText = t('settings.tokenMissingRepoScope');
          break;
        case 'missing_contents_permission':
          errorText = t('settings.tokenMissingContentsPermission');
          break;
        case 'saml':
          errorText = t('settings.tokenSamlError');
          break;
        case 'no_repository_access':
          errorText = t('settings.tokenNoRepoAccess');
          break;
        case 'network':
          errorText = t('settings.tokenTestNetwork');
          break;
        default: {
          errorText = t('settings.tokenTestInvalid');
        }
      }
      setTokenTestResult({ ok: false, text: errorText });
    }
    setIsTestingToken(false);
  }, [isTestingToken, tokenInput, t]);

  const handleSwitchAccount = useCallback(async (id: string) => {
    if (id === activeAccountId) return;
    HapticService.success();
    await switchAccount(id);
  }, [activeAccountId, switchAccount]);

  const handleRemoveAccount = useCallback((id: string, login: string) => {
    HapticService.warning();
    const summary = accountSummaries.find((s) => s.account.id === id);
    const removedHosts: RemovedHostRef[] = summary
      ? summary.hosts.map((h) => ({ id: h.id, provider: h.provider }))
      : [];
    const providerAccountCount = buildProviderAccountCount(accountSummaries);
    const affectedCount = reposAffectedByRemovedHosts(repositories, removedHosts, providerAccountCount).length;
    const body = affectedCount > 0
      ? `${t('settings.removeAccountBody')}\n\n${t('settings.cascadeRemoveWarning', { count: affectedCount })}`
      : t('settings.removeAccountBody');
    Alert.alert(t('settings.removeAccountTitle', { login }), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeAccount(id);
            await useRepoStore.getState().removeRepositoriesForHosts(removedHosts, providerAccountCount);
            HapticService.success();
          } catch (err) {
            HapticService.error();
            Alert.alert(
              t('errors.somethingWrong'),
              err instanceof Error ? err.message : t('errors.somethingWrong'),
            );
          }
        },
      },
    ]);
  }, [accountSummaries, repositories, removeAccount, t]);

  const handleRemoveToken = useCallback(() => {
    HapticService.warning();
    const removedHosts: RemovedHostRef[] = accountSummaries.flatMap((summary) =>
      summary.hosts.map((host) => ({ id: host.id, provider: host.provider })),
    );
    const providerAccountCount = buildProviderAccountCount(accountSummaries);
    const affectedCount = reposAffectedByRemovedHosts(repositories, removedHosts, providerAccountCount).length;
    const body = affectedCount > 0
      ? `${t('settings.removeTokenBody')}\n\n${t('settings.cascadeRemoveWarning', { count: affectedCount })}`
      : t('settings.removeTokenBody');
    Alert.alert(t('settings.removeTokenTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectAllHosts();
            await useRepoStore.getState().removeRepositoriesForHosts(removedHosts, providerAccountCount);
            HapticService.success();
          } catch (err) {
            HapticService.error();
            Alert.alert(
              t('errors.somethingWrong'),
              err instanceof Error ? err.message : t('errors.somethingWrong'),
            );
          }
        },
      },
    ]);
  }, [accountSummaries, repositories, disconnectAllHosts, t]);

  // Native-only "Connected hosts" UI: a single Alert lists each connected
  // host as a button; tapping one shows the disconnect confirmation Alert.
  // Triggered by the styled "Disconnect" button next to each host row in
  // SettingsContent. Looks up the host across all account summaries so the
  // caller only needs the host id, then shows the OS-native confirmation
  // Alert — which is the right primitive for a destructive confirm gate.
  const handleDisconnectHost = useCallback((hostId: string) => {
    // Find the host across accounts so the label in the confirmation Alert
    // matches what the user just tapped on.
    let label = hostId;
    let hostProvider: GitHostProvider = 'github';
    for (const summary of accountSummaries) {
      const host = summary.hosts.find((h) => h.id === hostId);
      if (host) {
        label = host.instanceBaseUrl
          ? `${GIT_HOST_LABELS[host.provider]} · ${host.instanceBaseUrl} (${host.hostLogin})`
          : `${GIT_HOST_LABELS[host.provider]} · ${host.hostLogin}`;
        hostProvider = host.provider;
        break;
      }
    }

    const removedHosts: RemovedHostRef[] = [{ id: hostId, provider: hostProvider }];
    const providerAccountCount = buildProviderAccountCount(accountSummaries);
    const affectedCount = reposAffectedByRemovedHosts(repositories, removedHosts, providerAccountCount).length;
    const body = affectedCount > 0
      ? `${t('accounts.disconnectBody', { label })}\n\n${t('settings.cascadeRemoveWarning', { count: affectedCount })}`
      : t('accounts.disconnectBody', { label });

    HapticService.warning();
    Alert.alert(
      t('accounts.disconnectTitle'),
      body,
      [
        { text: t('common.cancel'), style: 'cancel' as const },
        {
          text: t('accounts.disconnect'),
          style: 'destructive' as const,
          onPress: async () => {
            try {
              await disconnectHost(hostId);
              await useRepoStore.getState().removeRepositoriesForHosts(removedHosts, providerAccountCount);
              HapticService.success();
      } catch (err) {
              HapticService.error();
              Alert.alert(
                t('accounts.disconnectFailedTitle'),
                err instanceof Error ? err.message : t('accounts.disconnectFailedBody'),
              );
            }
          },
        },
      ],
    );
  }, [accountSummaries, repositories, disconnectHost, t]);

  const handleToggleSSH = useCallback(async (hostId: string) => {
    const useSsh = await AccountStorage.getHostUseSsh(hostId);
    if (!useSsh) {
      setSshModalHostId(hostId);
      setSshGenerating(true);
      setShowSSHModal(true);
      try {
        const keys = await generateSshKey(null);
        setSshKeyData(keys);
      } catch {
        setSshKeyData(null);
      } finally {
        setSshGenerating(false);
      }
    } else {
      const remainingKinds = (hostCredentialKinds[hostId] ?? []).filter((kind) => kind !== 'ssh');
      const appCredential = await AccountStorage.getGitHubAppCredential(hostId);
      const affected = reposAffectedByRemovedCredential(repositories, hostId, {
        hasHostWideCredential: remainingKinds.some((kind) => kind === 'token' || kind === 'oauth'),
        appRepositories: remainingKinds.includes('github_app') ? appCredential?.selectedRepositories ?? [] : [],
      });
      const body = affected.length > 0
        ? `${t('settings.removeSSHBody', { defaultValue: 'Disable SSH access?' })}\n\n${t('settings.cascadeRemoveWarning', { count: affected.length })}`
        : t('settings.removeSSHBody', { defaultValue: 'Disable SSH access?' });
      Alert.alert(t('settings.removeSshTitle', { defaultValue: 'Disable SSH access' }), body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: async () => {
          await AccountStorage.setHostUseSsh(hostId, false);
          const result = await AuthService.removeCredential(hostId, 'ssh');
          await clearCredential(`ssh:${hostId}`);
          if (result.hostRemoved) {
            const host = accountSummaries.flatMap((summary) => summary.hosts).find((item) => item.id === hostId);
            if (host) await useRepoStore.getState().removeRepositoriesForHosts([{ id: hostId, provider: host.provider }], buildProviderAccountCount(accountSummaries));
          } else {
            for (const repo of affected) await useRepoStore.getState().removeRepository(repo.path, repo.provider);
          }
          await refreshAccounts();
          HapticService.success();
        } },
      ]);
    }
  }, [accountSummaries, hostCredentialKinds, refreshAccounts, repositories, t]);

  const handleSaveSSHKey = useCallback(async () => {
    if (!sshModalHostId || !sshKeyData) return;
    await AccountStorage.setSshKey(sshModalHostId, sshKeyData);
    await AccountStorage.setHostUseSsh(sshModalHostId, true);
    setShowSSHModal(false);
    setSshKeyData(null);
    setSshModalHostId(null);
    HapticService.success();
  }, [sshModalHostId, sshKeyData]);

  const handleCopySSHPublicKey = useCallback(async (publicKey: string) => {
    try {
      const { setStringAsync } = await import('expo-clipboard');
      await setStringAsync(publicKey);
      HapticService.success();
    } catch {
      HapticService.error();
    }
  }, []);

  const handleOpenSSHSettings = useCallback(() => {
    Linking.openURL('https://github.com/settings/keys');
  }, []);

  const handleAppIconSelect = useCallback(async (name: AppIconName) => {
    setAppIconLoading(true);
    try {
      const result = name === null
        ? await AppIconService.reset()
        : await AppIconService.set(name);
      if (result.success && result.current !== undefined) {
        setAppIcon(result.current);
        HapticService.success();
      } else if (!result.success && !result.unavailable) {
        HapticService.error();
        Alert.alert(
          t('common.error'),
          result.error ?? t('settings.appIcon.error', { defaultValue: 'Failed to change app icon' }),
        );
      }
    } catch {
      HapticService.error();
      Alert.alert(
        t('common.error'),
        t('settings.appIcon.error', { defaultValue: 'Failed to change app icon' }),
      );
    } finally {
      setAppIconLoading(false);
    }
  }, [t]);
  const handleConnectOAuth = useCallback(async (hostId: string | null) => {
    const key = hostId ?? '__fresh__';
    setOauthLoading((prev) => ({ ...prev, [key]: true }));
    setOauthError((prev) => ({ ...prev, [key]: null }));
    try {
      const backendUrl = resolveBackendUrl();
      const clientId = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        setOauthError((prev) => ({ ...prev, [key]: 'OAuth not configured on this device' }));
        return;
      }
      const redirectUri = OAUTH_CALLBACK_URL;
      const result = await GitHubOAuthService.initiate({ backendUrl, redirectUri, clientId, hostId });
      if (!result.ok) {
        setOauthError((prev) => ({ ...prev, [key]: result.reason }));
        return;
      }
      const browserResult = await GitHubOAuthService.openAuthorizationUrl(result.authorizationUrl, redirectUri);
      if (browserResult.outcome === 'failed') {
        setOauthError((prev) => ({ ...prev, [key]: 'Could not open browser' }));
      } else if (browserResult.outcome === 'callback') {
        const callback = new URL(browserResult.url);
        navigation.navigate('OAuthCallback', {
          code: callback.searchParams.get('code') ?? undefined,
          state: callback.searchParams.get('state') ?? undefined,
          error: callback.searchParams.get('error') ?? undefined,
          error_description: callback.searchParams.get('error_description') ?? undefined,
        });
      }
    } catch (err) {
      setOauthError((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setOauthLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [navigation]);

  const handleDisconnectOAuth = useCallback(async (hostId: string) => {
    setOauthLoading((prev) => ({ ...prev, [hostId]: true }));
    setOauthError((prev) => ({ ...prev, [hostId]: null }));
    try {
      const remainingKinds = (hostCredentialKinds[hostId] ?? []).filter((kind) => kind !== 'oauth');
      const appCredential = await AccountStorage.getGitHubAppCredential(hostId);
      const affected = reposAffectedByRemovedCredential(repositories, hostId, {
        hasHostWideCredential: remainingKinds.some((kind) => kind === 'token' || kind === 'ssh'),
        appRepositories: remainingKinds.includes('github_app') ? appCredential?.selectedRepositories ?? [] : [],
      });
      const body = affected.length > 0
        ? `${t('settings.removeOAuthBody', { defaultValue: 'Remove OAuth authentication?' })}\n\n${t('settings.cascadeRemoveWarning', { count: affected.length })}`
        : t('settings.removeOAuthBody', { defaultValue: 'Remove OAuth authentication?' });
      Alert.alert(t('settings.removeOAuthTitle', { defaultValue: 'Remove OAuth' }), body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: async () => {
          const result = await disconnectGitHubOAuth(hostId);
          if (result.hostRemoved) {
            const host = accountSummaries.flatMap((summary) => summary.hosts).find((item) => item.id === hostId);
            if (host) {
              await useRepoStore.getState().removeRepositoriesForHosts([{ id: hostId, provider: host.provider }], buildProviderAccountCount(accountSummaries));
            }
          } else {
            for (const repo of affected) await useRepoStore.getState().removeRepository(repo.path, repo.provider);
          }
          HapticService.success();
        } },
      ]);
    } catch (err) {
      setOauthError((prev) => ({ ...prev, [hostId]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setOauthLoading((prev) => ({ ...prev, [hostId]: false }));
    }
  }, [accountSummaries, disconnectGitHubOAuth, hostCredentialKinds, repositories, t]);

  const handleConnectGitHubApp = useCallback(async (hostId: string | null) => {
    const key = hostId ?? '__fresh__';
    setAppLoading((prev) => ({ ...prev, [key]: true }));
    setAppError((prev) => ({ ...prev, [key]: null }));
    try {
      const backendUrl = resolveBackendUrl();
      const result = await GitHubAppService.buildInstallUrl({ backendUrl, hostId, selectedRepositoryIds: [] });
      if (!result.ok) {
        setAppError((prev) => ({ ...prev, [key]: result.reason }));
        return;
      }
      const browserResult = await GitHubAppService.openInstallationUrl(result.installationUrl);
      if (browserResult.outcome === 'failed') {
        setAppError((prev) => ({ ...prev, [key]: 'Could not open browser' }));
        return;
      }
      if (browserResult.outcome === 'callback') {
        const callback = GitHubAppService.parseCallbackUrl(browserResult.url);
        if (callback && typeof callback === 'object') {
          navigation.navigate('AppCallback', {
            installation_id: callback.installationId,
            state: callback.state,
          });
        } else {
          navigation.navigate('AppCallback');
        }
      }
    } catch (err) {
      setAppError((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setAppLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [navigation]);

  const handleDisconnectGitHubApp = useCallback(async (hostId: string) => {
    setAppLoading((prev) => ({ ...prev, [hostId]: true }));
    setAppError((prev) => ({ ...prev, [hostId]: null }));
    try {
      const remainingKinds = (hostCredentialKinds[hostId] ?? []).filter((kind) => kind !== 'github_app');
      const affected = reposAffectedByRemovedCredential(repositories, hostId, {
        hasHostWideCredential: remainingKinds.some((kind) => kind === 'token' || kind === 'oauth' || kind === 'ssh'),
        appRepositories: [],
      });
      const body = affected.length > 0
        ? `${t('settings.removeGitHubAppBody', { defaultValue: 'Remove this GitHub App credential?' })}\n\n${t('settings.cascadeRemoveWarning', { count: affected.length })}`
        : t('settings.removeGitHubAppBody', { defaultValue: 'Remove this GitHub App credential?' });
      Alert.alert(t('settings.removeGitHubAppTitle', { defaultValue: 'Remove GitHub App' }), body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: async () => {
          const result = await disconnectGitHubApp(hostId);
          if (result.hostRemoved) {
            const host = accountSummaries.flatMap((summary) => summary.hosts).find((item) => item.id === hostId);
            if (host) await useRepoStore.getState().removeRepositoriesForHosts([{ id: hostId, provider: host.provider }], buildProviderAccountCount(accountSummaries));
          } else {
            for (const repo of affected) await useRepoStore.getState().removeRepository(repo.path, repo.provider);
          }
          setAppCredentials((prev) => ({ ...prev, [hostId]: null }));
          HapticService.success();
        } },
      ]);
    } catch (err) {
      setAppError((prev) => ({ ...prev, [hostId]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setAppLoading((prev) => ({ ...prev, [hostId]: false }));
    }
  }, [accountSummaries, disconnectGitHubApp, hostCredentialKinds, repositories, t]);

  const handleDisconnectPat = useCallback(async (hostId: string) => {
    setPatLoading((prev) => ({ ...prev, [hostId]: true }));
    setPatError((prev) => ({ ...prev, [hostId]: null }));
    try {
      const remainingKinds = (hostCredentialKinds[hostId] ?? []).filter((kind) => kind !== 'token');
      const appCredential = await AccountStorage.getGitHubAppCredential(hostId);
      const affected = reposAffectedByRemovedCredential(repositories, hostId, {
        hasHostWideCredential: remainingKinds.some((kind) => kind === 'oauth' || kind === 'ssh'),
        appRepositories: remainingKinds.includes('github_app') ? appCredential?.selectedRepositories ?? [] : [],
      });
      const body = affected.length > 0
        ? `${t('settings.removePatBody', { defaultValue: 'Remove this personal access token?' })}\n\n${t('settings.cascadeRemoveWarning', { count: affected.length })}`
        : t('settings.removePatBody', { defaultValue: 'Remove this personal access token?' });
      Alert.alert(t('settings.removePatTitle', { defaultValue: 'Remove personal access token' }), body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: async () => {
          const result = await disconnectGitHubPat(hostId);
          if (result.hostRemoved) {
            const host = accountSummaries.flatMap((summary) => summary.hosts).find((item) => item.id === hostId);
            if (host) await useRepoStore.getState().removeRepositoriesForHosts([{ id: hostId, provider: host.provider }], buildProviderAccountCount(accountSummaries));
          } else {
            for (const repo of affected) await useRepoStore.getState().removeRepository(repo.path, repo.provider);
          }
          setHostCredentialKinds((prev) => ({ ...prev, [hostId]: (prev[hostId] ?? []).filter((kind) => kind !== 'token') }));
          HapticService.success();
        } },
      ]);
    } catch (err) {
      setPatError((prev) => ({ ...prev, [hostId]: err instanceof Error ? err.message : 'Unknown error' }));
    } finally {
      setPatLoading((prev) => ({ ...prev, [hostId]: false }));
    }
  }, [accountSummaries, disconnectGitHubPat, hostCredentialKinds, repositories, t]);

  const handleResetOnboarding = useCallback(() => {
    HapticService.warning();
    Alert.alert(t('settings.resetOnboardingTitle'), t('settings.resetOnboardingBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.reset'), onPress: async () => { await OnboardingService.resetOnboarding(); HapticService.success(); Alert.alert(t('common.success'), t('settings.resetOnboardingSuccess')); } },
    ]);
  }, [t]);

  const clearData = useCallback(() => {
    HapticService.warning();
    Alert.alert(t('settings.clearAllNotes'), t('settings.clearAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.clear'), style: 'destructive', onPress: async () => {
        const success = await clearAllNotes();
        if (success) {
          HapticService.success();
          Alert.alert(t('common.success'), t('settings.clearAllSuccess'));
        } else {
          HapticService.error();
          Alert.alert(t('common.error'), t('settings.clearAllFailed'));
        }
      } },
    ]);
  }, [clearAllNotes, t]);

  const selectedModelName = providers.flatMap((provider) => provider.models).find((model) => model.id === selectedModelId)?.name ?? t('settings.notSet');
  const chatStorageLabel = chatRepoName ? (chatRepoOwner ? `${chatRepoOwner}/${chatRepoName}` : chatRepoName) : t('settings.notSet');

  return (
    <SafeAreaView edges={[]} className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
      <SettingsContent
        colors={colors}
        headerHeight={headerHeight}
        tabBarHeight={tabBarHeight}
        theme={theme}
        uiStyle={uiStyle}
        accounts={accounts}
        activeAccountId={activeAccountId}
        accountSummaries={accountSummaries.map((s) => ({
          accountId: s.account.id,
          account: {
            id: s.account.id,
            login: s.account.login,
            name: s.account.name,
            avatarUrl: s.account.avatarUrl ?? s.hosts.find((h) => h.id === s.activeHostId)?.avatarUrl ?? s.hosts[0]?.avatarUrl ?? null,
          },
          hosts: s.hosts.map((h) => ({
            id: h.id,
            provider: h.provider,
            hostLogin: h.hostLogin,
            instanceBaseUrl: h.instanceBaseUrl,
          })),
          activeHostId: s.activeHostId,
        }))}
        authState={authState}
        repositories={repositories}
        syncingRepo={syncingRepo}
        cloningRepo={cloningRepo}
        templatesRepoPref={templatesRepoPref}
        isSyncingExistingTemplates={isSyncingExistingTemplates}
        isAIEnabled={isAIEnabled}
        selectedModelName={selectedModelName}
        actionMode={actionMode}
        chatStorageLabel={chatStorageLabel}
        providers={providers}
        setTheme={setTheme}
        setStyle={setStyle}
        onOpenConnectToken={() => { setTokenModalMode('connect'); setTokenInput(''); setTokenError(null); setTokenTestResult(null); setTokenVisible(false); setShowTokenModal(true); }}
        onOpenAddAccount={() => {
          if (accounts.length >= FREE_TIER_MAX_ACCOUNTS && !isPro) {
            promptProUpgrade(t, openPaywall);
            return;
          }
          setTokenModalMode('add'); setTokenInput(''); setTokenError(null); setTokenVisible(false); setShowTokenModal(true);
        }}
        onSwitchAccount={handleSwitchAccount}
        onRemoveAccount={handleRemoveAccount}
        onRemoveToken={handleRemoveToken}
        onDisconnectHost={handleDisconnectHost}
        onConnectOAuth={handleConnectOAuth}
        onDisconnectOAuth={handleDisconnectOAuth}
        oauthLoading={oauthLoading}
        oauthError={oauthError}
        onConnectGitHubApp={handleConnectGitHubApp}
        onDisconnectGitHubApp={handleDisconnectGitHubApp}
        appLoading={appLoading}
        appError={appError}
        appCredentials={appCredentials}
        hostCredentialKinds={hostCredentialKinds}
        onDisconnectPat={handleDisconnectPat}
        patLoading={patLoading}
        patError={patError}
        onAddHost={(preset) => {
          setConnectHostPreset(preset);
          setShowConnectHostModal(true);
        }}
        onAddHostLocked={() => {
          if (accounts.length >= FREE_TIER_MAX_ACCOUNTS && !isPro) {
            promptProUpgrade(t, openPaywall);
          } else {
            setConnectHostPreset(undefined);
            setShowConnectHostModal(true);
          }
        }}
        onOpenRepoPicker={() => void openRepoPicker()}
        onSyncRepo={(repo) => void handleSyncRepo(repo)}
        onRemoveRepo={handleRemoveRepo}
        lfsPending={lfsPending}
        lfsDownloadingRepo={lfsDownloadingRepo}
        onDownloadLfsObjects={(repo) => void handleDownloadLfsObjects(repo)}
        onOpenTemplatesRepoPicker={() => { setShowChatRepoPicker(false); setShowTemplatesRepoPicker(true); }}
        onSyncExistingTemplates={() => void handleSyncExistingTemplates()}
        onClearTemplatesRepo={() => void handleClearTemplatesRepo()}
        onOpenRenderStyleSettings={() => navigation.navigate('RenderStyleSettings')}
        onClearData={clearData}
        onResetOnboarding={handleResetOnboarding}
        isPro={isPro}
        isProLoading={isProLoading}
        proStatusLabel={proStatusLabel}
        onOpenPaywall={openPaywall}
        accentColor={accentColor}
        setAccentColor={setAccentColor}
        onOpenAccentColorPicker={() => setShowAccentColorPicker(true)}
        onManageTemplates={() => navigation.navigate('TemplateManager' as never)}
        onToggleAI={() => { void toggleAI(); }}
        dailyQuoteEnabled={dailyQuoteEnabled}
        onToggleDailyQuote={() => { void toggleDailyQuote(); }}
        aiPersonalizationEnabled={aiPersonalizationEnabled}
        onToggleAiPersonalization={() => { void toggleAiPersonalization(); }}
        githubToolsEnabled={githubToolsEnabled}
        onToggleGithubTools={() => { void toggleGithubTools(); }}
        dailyQuotePersonalizationEnabled={dailyQuotePersonalizationEnabled}
        onToggleDailyQuotePersonalization={() => { void toggleDailyQuotePersonalization(); }}
        dailyQuoteSourceVisible={dailyQuoteSourceVisible}
        onToggleDailyQuoteSourceVisible={() => { void toggleDailyQuoteSourceVisible(); }}
        onOpenModelSelector={() => setShowModelSelector(true)}
        onToggleActionMode={() => { void setActionMode(actionMode === 'auto' ? 'confirm' : 'auto'); }}
        onOpenChatRepoPicker={() => { setShowTemplatesRepoPicker(false); setShowChatRepoPicker(true); }}
        onProviderPress={(provider) => {
          if (provider.type === 'openai-compatible' || provider.type === 'anthropic') {
            setEditingProvider(provider);
            setShowProviderConfig(true);
          } else {
            useAIStore.getState().updateProvider(provider.id, { isEnabled: !provider.isEnabled });
          }
        }}
        onAddProvider={() => { setEditingProvider(undefined); setShowProviderConfig(true); }}
        isBiometricLockEnabled={isBiometricLockEnabled}
        isBiometricAvailable={isBiometricAvailable}
        biometricKind={biometricKind}
        biometricLabel={biometricLabel}
        lockTimeout={lockTimeout}
        onToggleBiometricLock={(v) => void setIsLockEnabled(v)}
        onSetLockTimeout={(v) => void setLockTimeout(v)}
        isBackgroundSyncEnabled={isBackgroundSyncEnabled}
        onToggleBackgroundSync={() => void toggleBackgroundSync()}
        floatingGitButtonVisible={floatingGitButtonVisible}
        onToggleFloatingGitButton={() => void toggleFloatingGitButton()}
        syncPaused={syncPaused}
        onToggleSyncPaused={(value) => void setSyncPaused(value)}
        syncHealth={syncHealth}
        onToggleSSH={handleToggleSSH}
        hostUseSsh={hostUseSsh}
        appIcon={appIcon}
        appIconSupported={appIconSupported}
        appIconLoading={appIconLoading}
        onOpenAppIconPicker={() => setShowAppIconPicker(true)}
      />
      <SettingsModals
        colors={colors}
        authState={authState}
        repositories={repositories}
        discoverableRepos={discoverableRepos}
        templatesRepoPref={templatesRepoPref}
        showRepoPickerModal={showRepoPickerModal}
        showTemplatesRepoPicker={showTemplatesRepoPicker}
        showTokenModal={showTokenModal}
        repoSearchQuery={repoSearchQuery}
        manualRepoInput={manualRepoInput}
        isAddingRepoPath={isAddingRepoPath}
        isLoadingDiscoverableRepos={isLoadingDiscoverableRepos}
        cloneProgress={cloneProgress}
        onCancelClone={handleCancelClone}
        onRetryClone={handleRetryClone}
        tokenInput={tokenInput}
        tokenVisible={tokenVisible}
        tokenError={tokenError}
        isVerifying={isVerifying}
        tokenModalMode={tokenModalMode}
        onCloseRepoPicker={() => { setShowRepoPickerModal(false); setRepoSearchQuery(''); setManualRepoHostId(null); setManualRepoInput(''); }}
        onSetRepoSearchQuery={setRepoSearchQuery}
        onSetManualRepoInput={setManualRepoInput}
        accountSummaries={accountSummaries}
        hostCredentialKinds={hostCredentialKinds}
        manualRepoHostId={manualRepoHostId}
        onManualRepoHostIdChange={setManualRepoHostId}
        onAddManualRepo={() => { void handleAddManualRepo(manualRepoHostId); }}
        onSelectRepo={(repo) => void handleSelectRepo(repo)}
        onCloseTemplatesRepoPicker={() => setShowTemplatesRepoPicker(false)}
        onPickTemplatesRepo={(repo) => void handlePickTemplatesRepo(repo)}
        onCloseTokenModal={() => { setShowTokenModal(false); setTokenVisible(false); }}
        onSetTokenInput={(value) => { setTokenInput(value); setTokenError(null); setTokenTestResult(null); }}
        onToggleTokenVisible={() => setTokenVisible((value) => !value)}
        onPasteToken={() => void handlePasteToken()}
        onCopyToken={() => void handleCopyToken()}
        onSaveToken={() => void handleSaveToken()}
        onTestToken={() => void handleTestToken()}
        isTestingToken={isTestingToken}
        tokenTestResult={tokenTestResult}
      />
      <ModelSelector visible={showModelSelector} onClose={() => setShowModelSelector(false)} />
      <ProviderConfigModal visible={showProviderConfig} provider={editingProvider} onClose={() => { setShowProviderConfig(false); setEditingProvider(undefined); }} />
      <ChatRepoPickerModal
        visible={showChatRepoPicker}
        onClose={() => setShowChatRepoPicker(false)}
        onSelected={() => setShowChatRepoPicker(false)}
        onGoToSettings={() => { setShowChatRepoPicker(false); void openRepoPicker(); }}
      />
      {/* When the repo picker is open, clone progress renders inline inside
          the picker modal (iOS cannot stack a second native Modal on top of
          the picker). The standalone modal only presents for flows with no
          picker open (e.g. the sync-engine clone toggle). */}
      {!showRepoPickerModal ? (
        <CloneProgressModal progress={cloneProgress} onCancel={handleCancelClone} onRetry={handleRetryClone} />
      ) : null}
      <SSHKeyModal
        visible={showSSHModal}
        generating={sshGenerating}
        publicKey={sshKeyData?.publicKey ?? null}
        onCopy={handleCopySSHPublicKey}
        onOpenSettings={handleOpenSSHSettings}
        onSave={handleSaveSSHKey}
        onClose={() => { setShowSSHModal(false); setSshKeyData(null); setSshModalHostId(null); }}
        colors={colors}
      />
      <ConnectHostModal
        visible={showConnectHostModal}
        onClose={() => { setShowConnectHostModal(false); setConnectHostPreset(undefined); }}
        presetProvider={connectHostPreset}
        colors={colors}
      />
      <HexColorPickerModal
        visible={showAccentColorPicker}
        initialColor={accentColor ?? colors.accent}
        allowClear
        clearTestID="hex-color-picker-clear"
        cancelTestID="hex-color-picker-cancel"
        confirmTestID="hex-color-picker-confirm"
        title={t('settings.accentColor')}
        onClose={() => setShowAccentColorPicker(false)}
        onSelect={(color) => { setAccentColor(color); setShowAccentColorPicker(false); }}
      />
      <Modal
        visible={showAppIconPicker}
        onRequestClose={() => setShowAppIconPicker(false)}
        bottomSheet
        contentStyle={{ padding: 16, paddingBottom: 34 }}
      >
        <View className="flex-row justify-between items-center mb-3">
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
            {t('settings.appIcon.title', { defaultValue: 'App Icon' })}
          </Text>
          <TouchableOpacity onPress={appIconLoading ? undefined : () => setShowAppIconPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={appIconLoading}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 16 }}>
          {t('settings.appIcon.pickerHint', { defaultValue: 'Choose an alternate app icon' })}
        </Text>
        <Group>
          <GroupRow
            testID="settings.button.app-icon.default"
            disabled={appIconLoading}
            onPress={() => { void handleAppIconSelect(null); }}
            leading={
              <Image
                source={require('../../assets/generated/alternate/base/icon.png')}
                style={{ width: 40, height: 40, borderRadius: 8 }}
              />
            }
            trailing={appIcon === null ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          >
            <Text style={{ color: appIcon === null ? colors.primary : colors.text, fontSize: 16 }}>
              {t('settings.appIcon.default', { defaultValue: 'Default' })}
            </Text>
          </GroupRow>
          <GroupRow
            testID="settings.button.app-icon.neon"
            disabled={appIconLoading}
            onPress={() => { void handleAppIconSelect('Neon'); }}
            leading={
              <Image
                source={require('../../assets/generated/alternate/neon/icon.png')}
                style={{ width: 40, height: 40, borderRadius: 8 }}
              />
            }
            trailing={appIcon === 'Neon' ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          >
            <Text style={{ color: appIcon === 'Neon' ? colors.primary : colors.text, fontSize: 16 }}>Neon</Text>
          </GroupRow>
          <GroupRow
            testID="settings.button.app-icon.grayscale"
            disabled={appIconLoading}
            onPress={() => { void handleAppIconSelect('Grayscale'); }}
            leading={
              <Image
                source={require('../../assets/generated/alternate/grayscale/icon.png')}
                style={{ width: 40, height: 40, borderRadius: 8 }}
              />
            }
            trailing={appIcon === 'Grayscale' ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          >
            <Text style={{ color: appIcon === 'Grayscale' ? colors.primary : colors.text, fontSize: 16 }}>Grayscale</Text>
          </GroupRow>
          <GroupRow
            testID="settings.button.app-icon.gold"
            disabled={appIconLoading}
            onPress={() => { void handleAppIconSelect('Gold'); }}
            leading={
              <Image
                source={require('../../assets/generated/alternate/gold/icon.png')}
                style={{ width: 40, height: 40, borderRadius: 8 }}
              />
            }
            trailing={appIcon === 'Gold' ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          >
            <Text style={{ color: appIcon === 'Gold' ? colors.primary : colors.text, fontSize: 16 }}>Gold</Text>
          </GroupRow>
        </Group>
        <TouchableOpacity
          testID="settings.button.app-icon.reset"
          disabled={appIconLoading}
          onPress={() => { void handleAppIconSelect(null); }}
          className="mt-4 py-3.5 rounded-lg items-center"
          style={{ backgroundColor: colors.surface }}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>
            {t('settings.appIcon.reset', { defaultValue: 'Reset to Default' })}
          </Text>
        </TouchableOpacity>
      </Modal>
      </View>
      <ScreenHeader title={t('settings.title')} />
    </SafeAreaView>
  );
}
