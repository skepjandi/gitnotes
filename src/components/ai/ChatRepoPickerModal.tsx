import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../../contexts/ThemeContext';
import { useRepoStore } from '../../stores/repoStore';
import { useAIStore } from '../../stores/aiStore';
import { GitHubService } from '../../services/GitHubService';
import type { GitHubRepository } from '../../services/GitHubService';
import { LastUsedRepoService } from '../../services/LastUsedRepoService';
import SearchBar from '../SearchBar';
import { HapticService } from '../../utils/haptics';
import * as ChatStorageService from '../../services/ChatStorageService';
import { Modal, Button, Surface } from '../ui';
import { getActiveBranch } from '../../services/git/activeBranchStore';
import { buildDisplayRepos, type DisplayRepo } from './chatRepoDisplay';

interface ChatRepoPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelected: () => void;
  onGoToSettings?: () => void;
}

/**
 * A repo row shown in the picker list. May be an already-added local repo, or
 * a GitHub repo the user hasn't added yet. Tapping an unadded one auto-adds
 * it and proceeds to branch selection.
 */
export const ChatRepoPickerModal: React.FC<ChatRepoPickerModalProps> = ({
  visible,
  onClose,
  onSelected,
  onGoToSettings,
}) => {
  const { colors, spacing } = useTokens();
  const insets = useSafeAreaInsets();
  const repositories = useRepoStore((state) => state.repositories);
  const addRepository = useRepoStore((state) => state.addRepository);
  const setChatRepo = useAIStore((state) => state.setChatRepo);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Fetch GitHub repos when the modal opens — covers fresh-account users who
  // added a token but never manually added any repo in Settings.
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false);
  const [isAddingRepoPath, setIsAddingRepoPath] = useState<string | null>(null);
  const [githubFetchError, setGithubFetchError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Ref so each modal-open triggers exactly one fetch, even if auth state
  // happens to change between renders while the modal is visible.
  const didFetchGithubRef = useRef(false);
  // Track mount state to prevent state updates after unmount.
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchGithubRepos = useCallback(async () => {
    const isAuthAvailable = await GitHubService.isAuthenticatedAsync();
    if (!isMountedRef.current) return;
    setIsAuthenticated(isAuthAvailable);
    if (!isAuthAvailable) return;
    setIsLoadingGithubRepos(true);
    setGithubFetchError(null);
    try {
      const repos = await GitHubService.getRepositories();
      if (isMountedRef.current) setGithubRepos(repos);
    } catch (error) {
      console.warn('[ChatRepoPickerModal] Failed to fetch GitHub repos:', error);
      if (isMountedRef.current) {
        setGithubRepos([]);
        setGithubFetchError('Could not load GitHub repos. Check network or token.');
      }
    } finally {
      if (isMountedRef.current) setIsLoadingGithubRepos(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      didFetchGithubRef.current = false;
      setIsAuthenticated(null);
      return;
    }
    if (didFetchGithubRef.current) return;
    didFetchGithubRef.current = true;
    void fetchGithubRepos();
  }, [visible, fetchGithubRepos]);

  const displayRepos = useMemo(
    () => buildDisplayRepos(repositories, githubRepos),
    [repositories, githubRepos],
  );

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return displayRepos;
    const query = searchQuery.toLowerCase();
    return displayRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.path.toLowerCase().includes(query),
    );
  }, [displayRepos, searchQuery]);

  // Auto-select repo when modal opens: single added repo → select it,
  // multiple → last used. Only runs once per modal open.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      didAutoSelectRef.current = false;
      return;
    }
    if (didAutoSelectRef.current) return;
    if (repositories.length === 0) return;
    didAutoSelectRef.current = true;

    if (repositories.length === 1) {
      void handleSelectRepo(repositories[0].path);
      return;
    }

    void LastUsedRepoService.get().then((lastPath) => {
      if (!lastPath) return;
      const stillExists = repositories.some((r) => r.path === lastPath);
      if (stillExists) void handleSelectRepo(lastPath);
    });
  }, [visible, repositories]);

  const handleSelectRepo = (path: string) => {
    setSelectedRepoPath(path);
    setInitError(null);
    HapticService.selection();
  };

  /**
   * Called when the user taps an unadded GitHub repo in the list. Auto-adds
   * it to the store then immediately proceeds to branch selection — the same
   * flow as picking an already-added repo, just with a transparent add step.
   */
  const handlePickUnaddedGithubRepo = async (fullName: string) => {
    setIsAddingRepoPath(fullName);
    setInitError(null);
    try {
      await addRepository(fullName, undefined, 'github', { allowUnverifiedWrite: true });
      HapticService.success();
      await handleSelectRepo(fullName);
    } catch (error) {
      HapticService.error();
      const detail = error instanceof Error ? error.message : 'Unknown error';
      setInitError(`Couldn't add ${fullName}. ${detail}`);
    } finally {
      setIsAddingRepoPath(null);
    }
  };

  const handleConfirm = async () => {
    if (!selectedRepoPath) return;

    const repo = repositories.find((r) => r.path === selectedRepoPath);
    const owner = repo?.path.split('/')[0] || selectedRepoPath.split('/')[0] || '';
    const name = repo?.path.split('/')[1] || selectedRepoPath.split('/')[1] || repo?.name || '';
    const repoId = repo?.id;
    const activeBranchState = repoId ? await getActiveBranch(repoId) : null;
    const branch = activeBranchState?.activeBranch ?? 'main';

    setIsInitializing(true);
    setInitError(null);
    try {
      await setChatRepo(owner, name, branch);
      await ChatStorageService.initializeChatStorage(owner, name, branch);
      HapticService.success();
      onSelected();
    } catch (error) {
      console.error('[ChatRepoPickerModal] Error initializing chat storage:', error);
      HapticService.error();
      const detail = error instanceof Error ? error.message : 'Unknown error';
      setInitError(
        `Couldn't write to ${selectedRepoPath}/chats/. ${detail}. Check network and repository write access, then tap Retry.`,
      );
    } finally {
      setIsInitializing(false);
    }
  };

  const renderRepoRow = (repo: DisplayRepo) => {
    const isSelected = repo.path === selectedRepoPath;
    const isAddingThis = isAddingRepoPath === repo.path;
    const disabled = isAddingThis || isInitializing || isAddingRepoPath !== null;
    return (
      <TouchableOpacity
        key={`${repo.isAdded ? 'added' : 'avail'}:${repo.path}`}
        testID="chat-repo-picker.button.select-repo"
        onPress={() =>
          repo.isAdded
            ? handleSelectRepo(repo.path)
            : void handlePickUnaddedGithubRepo(repo.path)
        }
        disabled={disabled}
        className="mb-2"
        style={disabled && !isAddingThis ? { opacity: 0.5 } : undefined}
      >
        <Surface
          elevation="flat"
          inset={isSelected}
          radius="md"
          className="flex-row items-center justify-between p-3.5"
          style={[
            isSelected && { borderColor: colors.primary, borderWidth: 1 },
            !isSelected && { borderWidth: 1, borderColor: 'transparent' },
          ]}
        >
          <View className="flex-1 mr-2">
            <Text
              className="text-md font-medium text-text"
              numberOfLines={1}
              style={!repo.isAdded ? { color: colors.text } : undefined}
            >
              {repo.path}
            </Text>
          </View>
          {isAddingThis ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : isSelected ? (
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          ) : repo.isAdded ? (
            <Ionicons name="document-outline" size={20} color={colors.textSecondary} />
          ) : (
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
          )}
        </Surface>
      </TouchableOpacity>
    );
  };

  const isEmpty = repositories.length === 0 && githubRepos.length === 0 && !isLoadingGithubRepos;
  const noLocalButHasGithub = repositories.length === 0 && githubRepos.length > 0;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      bottomSheet
      contentStyle={{ height: '85%' }}
    >
      <View className="flex-1">
        <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-border" style={{ borderBottomWidth: StyleSheet.hairlineWidth }}>
          <View className="w-8 items-end">
            {(visible && (isLoadingGithubRepos || isAuthenticated === true)) && (
              <TouchableOpacity
                testID="chat-repo-picker.button.refresh"
                onPress={() => void fetchGithubRepos()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                disabled={isLoadingGithubRepos}
                accessibilityLabel="Refresh repositories"
              >
                <Ionicons
                  name="refresh-outline"
                  size={22}
                  color={isLoadingGithubRepos ? colors.textSecondary : colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>
          <Text className="flex-1 text-md font-semibold text-center text-text" numberOfLines={1}>
            Choose Chat storage
          </Text>
          <TouchableOpacity
            testID="chat-repo-picker.button.close"
            onPress={onClose}
            disabled={isInitializing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="w-8 items-end"
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View className="flex-1 px-4 pt-4">
          <Text className="text-sm mb-4 text-text-secondary" style={{ lineHeight: 20 }}>
            Select a GitHub repository to store your AI chat conversations.
          </Text>

          {isLoadingGithubRepos || isAuthenticated === null ? (
            <View className="items-center py-10">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text className="text-md text-center mt-4 text-text-secondary">
                Checking repositories...
              </Text>
            </View>
          ) : isEmpty && isAuthenticated ? (
            <View className="items-center py-10">
              <Ionicons
                name="folder-open-outline"
                size={48}
                color={colors.textSecondary}
                style={{ marginBottom: spacing[4] }}
              />
              <Text className="text-md text-center mb-2 text-text-secondary">
                No repositories found on your GitHub account.
              </Text>
              {githubFetchError && (
                <Text className="text-sm text-center mb-4 text-error">
                  {githubFetchError}
                </Text>
              )}
              <Text className="text-sm text-center mb-6 text-text-secondary">
                Create a repository on GitHub, then tap the refresh icon above — or go to Settings to add one manually.
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  testID="chat-repo-picker.button.retry-fetch"
                  onPress={() => void fetchGithubRepos()}
                  disabled={isLoadingGithubRepos}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: colors.primary,
                    opacity: isLoadingGithubRepos ? 0.6 : 1,
                  }}
                >
                  {isLoadingGithubRepos ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="refresh-outline" size={18} color="#fff" />
                  )}
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Reload</Text>
                </TouchableOpacity>
                {onGoToSettings && (
                  <Button variant="secondary" onPress={onGoToSettings}>
                    Go to Settings
                  </Button>
                )}
              </View>
            </View>
          ) : isEmpty && !isAuthenticated ? (
            <View className="items-center py-10">
              <Ionicons
                name="lock-closed-outline"
                size={48}
                color={colors.textSecondary}
                style={{ marginBottom: spacing[4] }}
              />
              <Text className="text-md text-center mb-6 text-text-secondary">
                Connect your GitHub account in Settings to choose a repository.
              </Text>
              {onGoToSettings && (
                <Button variant="primary" onPress={onGoToSettings}>
                  Go to Settings
                </Button>
              )}
            </View>
          ) : (
            <>
              <View className="mb-3">
                <SearchBar
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search repositories..."
                />
              </View>

              {noLocalButHasGithub && !searchQuery.trim() && (
                <Text className="text-xs font-semibold uppercase tracking-wide mb-2 text-text-secondary">
                  Available on GitHub — tap to add
                </Text>
              )}

              <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 8 }}
                keyboardShouldPersistTaps="handled"
              >
                {filteredRepos.map(renderRepoRow)}
                {filteredRepos.length === 0 && (
                  <Text className="text-center py-5 text-sm text-text-secondary">
                    No matching repositories
                  </Text>
                )}
              </ScrollView>

            </>
          )}
        </View>

        <View
          className="px-4 pt-3 pb-1 border-t border-border"
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          {initError && (
            <View
              className="flex-row items-start gap-2 p-2.5 rounded-lg mb-2.5"
              style={{
                backgroundColor: colors.error + '1A',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.error,
              }}
            >
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text
                testID="chat-repo-picker.text.error"
                className="flex-1 text-sm text-error"
                style={{ lineHeight: 18 }}
              >
                {initError}
              </Text>
            </View>
          )}
          <Button
            testID="chat-repo-picker.button.confirm"
            variant="primary"
            onPress={handleConfirm}
            disabled={!selectedRepoPath || isInitializing}
            leadingIcon={isInitializing ? <ActivityIndicator size="small" color="#fff" /> : undefined}
          >
            {isInitializing
              ? 'Initializing'
              : initError
                ? 'Retry'
                : 'Confirm Selection'}
          </Button>
        </View>
      </View>
    </Modal>
  );
};
