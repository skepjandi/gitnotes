import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SearchBar from '../SearchBar';
import { Modal, Input, Button } from '../ui';
import { ProviderSelector, type ProviderSelection } from '../ProviderSelector';
import type { GitRepository } from '../../services/GitService';
import { GIT_HOST_LABELS, type GitHostProvider, type GitHostRepository, type GitHostRepositoryResult, type GitHostRepositoryUnavailable } from '../../services/git/GitHost';
import type { TemplateRepoPreference } from '../../services/TemplateRepoPreferenceService';
import { CloneProgressContent, type CloneProgress } from './CloneProgressModal';
import type { AccountSummary } from '../../services/AuthService';
import type { CredentialKind } from '../../services/git/contracts';

type ThemeColors = {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
};

type AuthState = { isAuthenticated: boolean };

type SSHModalProps = {
  visible: boolean;
  generating: boolean;
  publicKey: string | null;
  onCopy: (key: string) => void;
  onOpenSettings: () => void;
  onSave: () => void;
  onClose: () => void;
  colors: ThemeColors;
};

export const SSHKeyModal = memo(function SSHKeyModal({
  visible,
  generating,
  publicKey,
  onCopy,
  onOpenSettings,
  onSave,
  onClose,
  colors,
}: SSHModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} onRequestClose={onClose} bottomSheet contentStyle={{ padding: 0 }}>
      <View className="flex-row justify-between items-center px-4 pt-4 pb-3 border-b" style={{ borderColor: colors.border }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>{t('settings.sshKeyTitle')}</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4 py-4" style={{ paddingBottom: 16 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {generating ? (
          <View className="flex-row items-center gap-3 py-4">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{t('settings.sshGenerating')}</Text>
          </View>
        ) : publicKey ? (
          <>
            <Text className="text-sm mt-4 mb-3 mx-2" style={{ color: colors.textSecondary }}>{t('settings.sshKeyDescription')}</Text>
            <View
              className="rounded-lg p-4 mb-4 mx-2"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Text
                style={{ color: colors.text, fontSize: 12, fontFamily: 'Menlo', lineHeight: 18 }}
                selectable
              >
                {publicKey}
              </Text>
            </View>
            <View className="flex-row gap-2 mb-4 mx-2">
              <TouchableOpacity
                className="flex-row items-center justify-center py-2.5 px-3 rounded-lg border flex-1 gap-1.5"
                style={{ borderColor: colors.border }}
                onPress={() => onCopy(publicKey)}
              >
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t('common.copy')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-row items-center justify-center py-2.5 px-3 rounded-lg border flex-1 gap-1.5"
                style={{ borderColor: colors.border }}
                onPress={onOpenSettings}
              >
                <Ionicons name="open-outline" size={16} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t('settings.openSshSettings')}</Text>
              </TouchableOpacity>
            </View>
            <Button
              label={t('common.done')}
              onPress={onSave}
              variant="primary"
              fullWidth
              style={{ minHeight: 48, marginHorizontal: 8 }}
              textStyle={{ color: '#fff', fontWeight: '600' }}
            />
          </>
        ) : (
          <Text className="mx-2" style={{ color: colors.error, fontSize: 14 }}>{t('settings.sshKeyError')}</Text>
        )}
      </ScrollView>
    </Modal>
  );
});

type SettingsModalsProps = {
  colors: ThemeColors;
  authState: AuthState;
  repositories: GitRepository[];
  discoverableRepos: GitHostRepositoryResult[];
  templatesRepoPref: TemplateRepoPreference | null;
  showRepoPickerModal: boolean;
  showTemplatesRepoPicker: boolean;
  showTokenModal: boolean;
  repoSearchQuery: string;
  manualRepoInput: string;
  isAddingRepoPath: string | null;
  isLoadingDiscoverableRepos: boolean;
  cloneProgress: CloneProgress | null;
  onCancelClone: () => void;
  onRetryClone: () => void;
  tokenInput: string;
  tokenVisible: boolean;
  tokenError: string | null;
  isVerifying: boolean;
  tokenModalMode: 'connect' | 'add';
  onCloseRepoPicker: () => void;
  onSetRepoSearchQuery: (value: string) => void;
  onSetManualRepoInput: (value: string) => void;
  accountSummaries: AccountSummary[];
  hostCredentialKinds: Record<string, CredentialKind[]>;
  manualRepoHostId: string | null;
  onManualRepoHostIdChange: (hostId: string | null) => void;
  onAddManualRepo: () => void;
  onSelectRepo: (repo: GitHostRepository) => void;
  onCloseTemplatesRepoPicker: () => void;
  onPickTemplatesRepo: (repo: GitRepository) => void;
  onCloseTokenModal: () => void;
  onSetTokenInput: (value: string) => void;
  onToggleTokenVisible: () => void;
  onPasteToken: () => void;
  onCopyToken: () => void;
  onSaveToken: () => void;
  onTestToken?: () => void;
  isTestingToken?: boolean;
  tokenTestResult?: { ok: boolean; text: string } | null;
  __onRepoPickerListRender?: () => void;
};

type RepoPickerListProps = {
  discoverableRepos: GitHostRepositoryResult[];
  repositories: GitRepository[];
  accountSummaries: AccountSummary[];
  hostCredentialKinds: Record<string, CredentialKind[]>;
  searchQuery: string;
  isLoading: boolean;
  isAddingRepoPath: string | null;
  onSelectRepo: (repo: GitHostRepository) => void;
  onSetRepoSearchQuery: (value: string) => void;
  onAddManualRepo?: () => void;
  colors: ThemeColors;
  __onRender?: () => void;
};

const PROVIDER_ORDER: GitHostProvider[] = ['github', 'gitlab', 'gitea', 'forgejo'];

const CREDENTIAL_KIND_LABELS: Record<CredentialKind, string> = {
  token: 'PAT',
  oauth: 'OAuth',
  github_app: 'App',
  ssh: 'SSH',
};

const CREDENTIAL_KIND_ORDER: CredentialKind[] = ['token', 'oauth', 'github_app', 'ssh'];

function buildHostLabel(
  provider: GitHostProvider,
  hostLogin: string,
  instanceBaseUrl: string | null,
  accountLabel: string,
  credentialKinds: CredentialKind[],
): string {
  const providerLabel = GIT_HOST_LABELS[provider];
  const accountSuffix = accountLabel && accountLabel.toLowerCase() !== hostLogin.toLowerCase()
    ? ` · ${accountLabel}`
    : '';
  const authSuffix = credentialKinds
    .slice()
    .sort((a, b) => CREDENTIAL_KIND_ORDER.indexOf(a) - CREDENTIAL_KIND_ORDER.indexOf(b))
    .map((k) => CREDENTIAL_KIND_LABELS[k])
    .join('+');

  if (instanceBaseUrl) {
    const hostname = (() => {
      try { return new URL(instanceBaseUrl).hostname; }
      catch { return instanceBaseUrl; }
    })();
    return authSuffix
      ? `${providerLabel} · ${hostname} (${hostLogin})${accountSuffix} [${authSuffix}]`
      : `${providerLabel} · ${hostname} (${hostLogin})${accountSuffix}`;
  }
  return authSuffix
    ? `${providerLabel} · ${hostLogin}${accountSuffix} [${authSuffix}]`
    : `${providerLabel} · ${hostLogin}${accountSuffix}`;
}

type HostFilterOption = AccountSummary['hosts'][number] & { accountLabel: string };

type HostFilterSelectorProps = {
  value: string | 'all';
  hosts: HostFilterOption[];
  hostCredentialKinds: Record<string, CredentialKind[]>;
  onChange: (hostId: string | 'all') => void;
  colors: ThemeColors;
  allLabel: string;
  title: string;
};

const HostFilterSelector = memo(function HostFilterSelector({
  value,
  hosts,
  hostCredentialKinds,
  onChange,
  colors,
  allLabel,
  title,
}: HostFilterSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selectedHost = hosts.find((host) => host.id === value);
  const selectedLabel = selectedHost
    ? buildHostLabel(
        selectedHost.provider,
        selectedHost.hostLogin,
        selectedHost.instanceBaseUrl,
        selectedHost.accountLabel,
        hostCredentialKinds[selectedHost.id] ?? [],
      )
    : allLabel;

  return (
    <>
      <TouchableOpacity
        testID="settings.repo-filter.host-dropdown"
        className="flex-row items-center border"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 10,
          gap: 10,
          marginBottom: 8,
        }}
        onPress={() => setIsOpen(true)}
      >
        <Ionicons name="server-outline" size={18} color={colors.primary} />
        <Text className="flex-1" style={{ color: colors.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      <Modal visible={isOpen} onRequestClose={() => setIsOpen(false)} bottomSheet accessibilityLabel={title}>
        <View className="flex-row justify-between items-center px-4 py-3 border-b" style={{ borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{title}</Text>
          <TouchableOpacity onPress={() => setIsOpen(false)}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView
          testID="settings.repo-filter.host-options-scroll"
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: 8 + insets.bottom }}
        >
          <TouchableOpacity
            testID="settings.repo-filter.host-all"
            className="flex-row items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: colors.border, backgroundColor: value === 'all' ? `${colors.primary}15` : undefined }}
            onPress={() => { onChange('all'); setIsOpen(false); }}
          >
            <Ionicons name="server-outline" size={20} color={colors.primary} />
            <Text className="flex-1" style={{ color: colors.text }}>{allLabel}</Text>
            {value === 'all' ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
          </TouchableOpacity>
          {hosts.map((host) => {
            const isSelected = host.id === value;
            return (
              <TouchableOpacity
                key={host.id}
                testID={`settings.repo-filter.host.${host.id}`}
                className="flex-row items-center gap-3 px-4 py-3 border-b"
                style={{ borderColor: colors.border, backgroundColor: isSelected ? `${colors.primary}15` : undefined }}
                onPress={() => { onChange(host.id); setIsOpen(false); }}
              >
                <Ionicons name={host.provider === 'github' ? 'logo-github' : 'git-branch-outline'} size={20} color={isSelected ? colors.primary : colors.textSecondary} />
                <Text className="flex-1" style={{ color: isSelected ? colors.primary : colors.text }} numberOfLines={1}>
                  {buildHostLabel(
                    host.provider,
                    host.hostLogin,
                    host.instanceBaseUrl,
                    host.accountLabel,
                    hostCredentialKinds[host.id] ?? [],
                  )}
                </Text>
                {isSelected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Modal>
    </>
  );
});

const RepoPickerList = memo(function RepoPickerList({
  discoverableRepos,
  repositories,
  accountSummaries,
  hostCredentialKinds,
  searchQuery,
  isLoading,
  isAddingRepoPath,
  onSelectRepo,
  onSetRepoSearchQuery,
  onAddManualRepo,
  colors,
  __onRender,
}: RepoPickerListProps) {
  __onRender?.();
  const { t } = useTranslation();
  const [providerFilter, setProviderFilter] = useState<ProviderSelection>('all');
  const [hostFilter, setHostFilter] = useState<string | 'all'>('all');
  const hostOptions = useMemo(
    () => accountSummaries.flatMap((summary) =>
      summary.hosts.map((host) => ({
        ...host,
        accountLabel: summary.account.name || summary.account.login,
      })),
    ),
    [accountSummaries],
  );
  const availableRepos = discoverableRepos.filter(
    (r): r is GitHostRepository => 'kind' in r && r.kind === 'unavailable' ? false : true,
  );
  const providerRepos = providerFilter === 'all'
    ? availableRepos
    : availableRepos.filter((repo) => repo.provider === providerFilter);
  const hostRepos = hostFilter === 'all'
    ? providerRepos
    : providerRepos.filter((repo) => repo.hostId === hostFilter);
  const filteredRepos = searchQuery
    ? hostRepos.filter(
        (repo) =>
          repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          repo.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (repo.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : hostRepos;
  const groupedRepos = PROVIDER_ORDER
    .map((provider) => ({
      provider,
      repos: filteredRepos.filter((repo) => repo.provider === provider),
    }))
    .filter((group) => group.repos.length > 0);
  return (
    <>
      <View className="px-4 py-2">
        <SearchBar value={searchQuery} onChangeText={onSetRepoSearchQuery} placeholder={t('explore.searchRepos')} />
      </View>
      <View className="px-4 pb-3 gap-1.5">
        <Text className="text-xs uppercase tracking-wide" style={{ color: colors.textSecondary }}>
          {t('settings.providerFilterLabel', { defaultValue: 'Filter by provider' })}
        </Text>
        <ProviderSelector
          value={providerFilter}
          onChange={setProviderFilter}
          includeAll
          allLabel={t('settings.providerFilter.all', { defaultValue: 'All Providers' })}
          title={t('settings.providerFilter.title', { defaultValue: 'Filter by provider' })}
          testIDPrefix="settings.repo-filter"
        />
        <HostFilterSelector
          value={hostFilter}
          hosts={hostOptions}
          hostCredentialKinds={hostCredentialKinds}
          onChange={setHostFilter}
          colors={colors}
          allLabel={t('settings.hostFilter.all', { defaultValue: 'All Hosts' })}
          title={t('settings.hostFilter.title', { defaultValue: 'Filter by host' })}
        />
      </View>
      <Text className="text-xs font-semibold uppercase tracking-wide px-4 py-2.5 border-b" style={{ color: colors.textSecondary, borderColor: colors.border }}>
        {t('settings.yourRepositories')}
      </Text>
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ padding: 32 }} />
      ) : filteredRepos.length === 0 ? (
        <Text className="p-6 text-center text-sm" style={{ color: colors.textSecondary }}>
          {searchQuery ? t('settings.noMatchingRepositories') : t('settings.noRepositoriesFound')}
        </Text>
      ) : (
        groupedRepos.map(({ provider, repos }) => (
          <React.Fragment key={provider}>
            <Text className="text-xs font-semibold uppercase tracking-wide px-4 py-2.5 border-b" style={{ color: colors.textSecondary, borderColor: colors.border }}>
              {GIT_HOST_LABELS[provider]} ({repos.length})
            </Text>
            {repos.map((repo) => {
              const alreadyAdded = repositories.some((item) => item.path === repo.fullName);
              const isAddingThis = isAddingRepoPath === repo.fullName;
              const disabled = alreadyAdded || isAddingRepoPath !== null;
              return (
                <TouchableOpacity
                  key={repo.fullName}
                  testID="settings-modals.button.select-repo"
                  className="flex-row items-center px-4 py-3.5 border-b gap-3"
                  style={[{ borderColor: colors.border }, disabled && !isAddingThis && { opacity: 0.5 }]}
                  onPress={() => onSelectRepo(repo)}
                  disabled={disabled}
                >
                  <Ionicons name={repo.isPrivate ? 'lock-closed-outline' : 'git-branch-outline'} size={18} color={colors.primary} />
                  <View className="flex-1">
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>{repo.fullName}</Text>
                    {repo.description ? (
                      <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                        {repo.description}
                      </Text>
                    ) : null}
                  </View>
                  {isAddingThis ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : alreadyAdded ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </React.Fragment>
        ))
      )}
      {(() => {
        const unavailableRepos = discoverableRepos.filter(
          (r): r is GitHostRepositoryUnavailable =>
            'kind' in r && r.kind === 'unavailable',
        );
        const manualEntryLink = onAddManualRepo ? (
          <TouchableOpacity onPress={onAddManualRepo} className="flex-row items-center justify-center gap-1.5 py-3 border-t" style={{ borderColor: colors.border }}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14 }}>{t('settings.addRepositoryManually')}</Text>
          </TouchableOpacity>
        ) : null;

        return unavailableRepos.length > 0 && !isLoading ? (
          <View>
            {unavailableRepos.map((unavailable) => (
              <View key={unavailable.provider} className="px-4 py-3 border-b gap-1" style={{ borderColor: colors.border }}>
                <View className="flex-row items-center gap-2">
                  <Ionicons name="warning-outline" size={16} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
                    {GIT_HOST_LABELS[unavailable.provider]}
                  </Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{unavailable.reason}</Text>
              </View>
            ))}
            {manualEntryLink}
          </View>
        ) : null;
      })()}
    </>
  );
});

export function SettingsModals(props: SettingsModalsProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tokenGuideExpanded, setTokenGuideExpanded] = useState(false);
  const {
    colors,
    authState,
    repositories,
    discoverableRepos,
    templatesRepoPref,
    showRepoPickerModal,
    showTemplatesRepoPicker,
    showTokenModal,
    repoSearchQuery,
    manualRepoInput,
    isAddingRepoPath,
    isLoadingDiscoverableRepos,
    cloneProgress,
    onCancelClone,
    onRetryClone,
    tokenInput,
    tokenVisible,
    tokenError,
    isVerifying,
    tokenModalMode,
    onCloseRepoPicker,
    onSetRepoSearchQuery,
    onSetManualRepoInput,
    accountSummaries,
    hostCredentialKinds,
    manualRepoHostId,
    onManualRepoHostIdChange,
    onAddManualRepo,
    onSelectRepo,
    onCloseTemplatesRepoPicker,
    onPickTemplatesRepo,
    onCloseTokenModal,
    onSetTokenInput,
    onToggleTokenVisible,
    onPasteToken,
    onCopyToken,
    onSaveToken,
    onTestToken,
    isTestingToken,
    tokenTestResult,
    __onRepoPickerListRender,
  } = props;
  const hasRepositoryCredentials = authState.isAuthenticated || Object.values(hostCredentialKinds).some(
    (kinds) => kinds.includes('token') || kinds.includes('oauth') || kinds.includes('github_app'),
  );

  return (
    <>
      <Modal visible={showRepoPickerModal} onRequestClose={onCloseRepoPicker} bottomSheet contentStyle={{ padding: 0 }}>
        <View className="flex-row justify-between items-center px-4 pt-4 pb-3 border-b" style={{ borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>{t('settings.addRepository')}</Text>
          <TouchableOpacity onPress={onCloseRepoPicker}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView
          testID="settings-modals.repo-picker-scroll"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 + insets.bottom }}
        >
          <View className="px-4 pt-4 gap-2">
            <Text className="text-xs uppercase tracking-wide" style={{ color: colors.textSecondary }}>
              {t('addRepo.hostLabel', 'Host')}
            </Text>
            {accountSummaries.length === 0 ? (
              <Text className="text-sm py-2" style={{ color: colors.textSecondary }}>
                {t('addRepo.noHostsConnected', 'No hosts connected. Add an account first.')}
              </Text>
            ) : (
              accountSummaries.map((summary) => {
                return (
                  <View key={summary.account.id} className="gap-1">
                    {summary.hosts.map((host) => {
                      const isSelected = manualRepoHostId === host.id;
                      const hostLabel = buildHostLabel(
                        host.provider,
                        host.hostLogin,
                        host.instanceBaseUrl,
                        summary.account.name || summary.account.login,
                        hostCredentialKinds[host.id] ?? [],
                      );
                      return (
                        <TouchableOpacity
                          key={host.id}
                          testID={`settings-modals.manual-host-${host.id}`}
                          onPress={() => onManualRepoHostIdChange(isSelected ? null : host.id)}
                          className="flex-row items-center py-2.5 px-3 rounded-lg gap-2"
                          style={{
                            borderWidth: 1,
                            borderColor: isSelected ? colors.primary : colors.border,
                            backgroundColor: isSelected ? colors.primary + '12' : colors.surface,
                          }}
                        >
                          <Ionicons
                            name={host.provider === 'github' ? 'logo-github' : 'git-branch'}
                            size={16}
                            color={isSelected ? colors.primary : colors.textSecondary}
                          />
                          <Text
                            className="flex-1"
                            style={{
                              fontSize: 13,
                              fontWeight: '500',
                              color: isSelected ? colors.primary : colors.text,
                            }}
                            numberOfLines={1}
                          >
                            {hostLabel}
                          </Text>
                          {isSelected ? (
                            <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })
            )}
          </View>
          <View className="flex-row items-center px-4 py-3 gap-2 border-b" style={{ borderColor: colors.border }}>
            <Input
              testID="settings-modals.input.manual-repo"
              containerStyle={{ flex: 1, borderWidth: 1, borderColor: colors.border }}
              placeholder={t('settings.repoPathPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              value={manualRepoInput}
              onChangeText={onSetManualRepoInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={manualRepoHostId ? onAddManualRepo : undefined}
            />
            <Button
              testID="settings-modals.button.add-manual-repo"
              label={t('common.add')}
              onPress={onAddManualRepo}
              disabled={!manualRepoInput.trim() || isAddingRepoPath !== null || !manualRepoHostId}
              variant="primary"
              style={{ paddingHorizontal: 16 }}
              textStyle={{ color: '#fff' }}
              trailingIcon={isAddingRepoPath !== null ? <ActivityIndicator size="small" color="#fff" /> : undefined}
              iconAlign="inline"
            />
          </View>

          {cloneProgress != null ? (
            <View className="px-4 py-4 border-b" style={{ borderColor: colors.border }}>
              <CloneProgressContent
                progress={cloneProgress}
                onCancel={onCancelClone}
                onRetry={onRetryClone}
              />
            </View>
          ) : null}

          {hasRepositoryCredentials ? (
            <RepoPickerList
              discoverableRepos={discoverableRepos}
              repositories={repositories}
              accountSummaries={accountSummaries}
              hostCredentialKinds={hostCredentialKinds}
              searchQuery={repoSearchQuery}
              isLoading={isLoadingDiscoverableRepos}
              isAddingRepoPath={isAddingRepoPath}
              onSelectRepo={onSelectRepo}
              onSetRepoSearchQuery={onSetRepoSearchQuery}
              onAddManualRepo={onAddManualRepo}
              colors={colors}
              __onRender={__onRepoPickerListRender}
            />
          ) : null}
        </ScrollView>
      </Modal>

      <Modal visible={showTemplatesRepoPicker} onRequestClose={onCloseTemplatesRepoPicker} bottomSheet contentStyle={{ padding: 0 }}>
        <View className="flex-row justify-between items-center px-4 pt-4 pb-3 border-b" style={{ borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>{t('settings.templatesRepository')}</Text>
          <TouchableOpacity testID="settings-modals.button.close-templates-repo" onPress={onCloseTemplatesRepoPicker}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 + insets.bottom }}>
          {repositories.length === 0 ? (
            <Text className="p-6 text-center text-sm" style={{ color: colors.textSecondary }}>
              {t('settings.addRepoFirstForTemplates')}
            </Text>
          ) : (
            repositories.map((repo) => {
              const selected = templatesRepoPref?.repoPath === repo.path;
              return (
                <TouchableOpacity
                  key={repo.id}
                  testID={`templates-repo-option-${repo.path}`}
                  className="flex-row items-center px-4 py-3.5 border-b gap-3"
                  style={{ borderColor: colors.border }}
                  onPress={() => onPickTemplatesRepo(repo)}
                >
                  <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
                  <View className="flex-1">
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>{repo.path}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                      {t('settings.branch', { branch: repo.branch || t('settings.branchDefault') })}
                    </Text>
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </Modal>

      <Modal visible={showTokenModal} onRequestClose={onCloseTokenModal} bottomSheet contentStyle={{ padding: 0 }}>
        <View className="flex-row justify-between items-center px-4 pt-4 pb-3 border-b" style={{ borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
            {tokenModalMode === 'add' ? t('settings.addGitHubAccount') : authState.isAuthenticated ? t('settings.changeToken') : t('settings.connectGithub')}
          </Text>
          <TouchableOpacity onPress={onCloseTokenModal}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView className="px-4 py-4" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
          <Text className="text-sm mb-3 leading-5" style={{ color: colors.textSecondary }}>{t('settings.tokenDescription')}</Text>
          <TouchableOpacity
            testID="settings-modals.button.token-guide"
            className="flex-row items-center gap-1 mb-2"
            onPress={() => setTokenGuideExpanded((v) => !v)}
          >
            <Ionicons name={tokenGuideExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '500' }}>{t('settings.tokenGuideTitle')}</Text>
          </TouchableOpacity>
          {tokenGuideExpanded ? (
            <View className="mb-3 ml-1 gap-1">
              {[1, 2, 3, 4, 5].map((step) => (
                <Text key={step} className="text-xs leading-4" style={{ color: colors.textSecondary }}>
                  {t(`settings.tokenGuideStep${step}`)}
                </Text>
              ))}
              <Text className="text-xs leading-4 mt-1" style={{ color: colors.textSecondary }}>
                {t('settings.tokenGuideClassic')}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity className="flex-row items-center gap-1 mb-4" onPress={() => Linking.openURL('https://github.com/settings/personal-access-tokens/new?description=GitNotes&type=beta')}>
            <Ionicons name="open-outline" size={14} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '500' }}>{t('settings.openGithubTokenSettings')}</Text>
          </TouchableOpacity>
          <View
            className="flex-row items-center rounded-lg px-3 mb-2 h-[50px]"
            style={{ borderWidth: 1, borderColor: tokenError ? '#FF3B30' : colors.border, backgroundColor: colors.background }}
          >
            <Input
              testID="settings-modals.input.token"
              containerStyle={{ flex: 1, borderWidth: 0 }}
              placeholder={t('settings.tokenPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              value={tokenInput}
              onChangeText={onSetTokenInput}
              secureTextEntry={!tokenVisible}
              autoCapitalize="none"
              autoCorrect={false}
              showSoftInputOnFocus={false}
            />
            <TouchableOpacity
              testID="settings-modals.button.toggle-token-visible"
              onPress={onToggleTokenVisible}
              className="px-1.5 py-1.5 ml-1"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={tokenVisible ? t('settings.hideToken') : t('settings.showToken')}
            >
              <Ionicons name={tokenVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View className="flex-row gap-2 mb-2">
            <TouchableOpacity
              testID="settings-modals.button.paste-token"
              className="flex-row items-center justify-center py-2.5 px-3 rounded-lg border flex-1 gap-1.5"
              style={{ borderColor: colors.border }}
              onPress={onPasteToken}
              accessibilityLabel={t('settings.pasteToken')}
            >
              <Ionicons name="clipboard-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t('common.paste')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="settings-modals.button.copy-token"
              className="flex-row items-center justify-center py-2.5 px-3 rounded-lg border flex-1 gap-1.5"
              style={[{ borderColor: colors.border }, { opacity: tokenInput.trim() ? 1 : 0.4 }]}
              onPress={onCopyToken}
              disabled={!tokenInput.trim()}
              accessibilityLabel={t('settings.copyToken')}
            >
              <Ionicons name="copy-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t('common.copy')}</Text>
            </TouchableOpacity>
          </View>
          {onTestToken ? (
            <TouchableOpacity
              testID="settings-modals.button.test-token"
              className="flex-row items-center justify-center py-2.5 px-3 rounded-lg border mb-2 gap-1.5"
              style={[{ borderColor: colors.border }, { opacity: tokenInput.trim() ? 1 : 0.4 }]}
              onPress={onTestToken}
              disabled={isTestingToken || !tokenInput.trim()}
              accessibilityLabel={t('settings.tokenTest')}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
                {isTestingToken ? t('settings.testingToken') : t('settings.tokenTest')}
              </Text>
            </TouchableOpacity>
          ) : null}
          {tokenTestResult ? (
            <Text style={{ color: tokenTestResult.ok ? '#34C759' : '#FF3B30', fontSize: 13, marginBottom: 10 }}>
              {tokenTestResult.text}
            </Text>
          ) : null}
          {tokenError ? <Text style={{ color: '#FF3B30', fontSize: 13, marginBottom: 10 }}>{tokenError}</Text> : null}
          <Button
            testID="settings-modals.button.save-token"
            label={tokenModalMode === 'add' ? t('settings.addAccount') : t('settings.saveToken')}
            onPress={onSaveToken}
            disabled={isVerifying}
            variant="primary"
            fullWidth
            style={{ marginTop: 8, minHeight: 48 }}
            textStyle={{ color: '#fff', fontWeight: '600' }}
            trailingIcon={isVerifying ? <ActivityIndicator color="#fff" /> : undefined}
            iconAlign="edge"
          />
        </ScrollView>
        </Modal>
    </>
  );
}
