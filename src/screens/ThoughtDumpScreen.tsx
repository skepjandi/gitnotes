import { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, Alert, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useTokens } from '../contexts/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { ThoughtDumpService } from '../services/ThoughtDumpService';
import { StorageService } from '../services/StorageService';
import { ThoughtDumpRepoPreferenceService } from '../services/ThoughtDumpRepoPreferenceService';
import { LastUsedRepoService } from '../services/LastUsedRepoService';
import { GitHubService } from '../services/GitHubService';
import type { GitRepository } from '../services/GitService';
import { ThoughtDump } from '../models/ThoughtDump';
import { gitOperationRegistry } from '../stores/gitOperationStore';
import { ScreenHeader, Button, Input, EmptyState, Modal } from '../components/ui';
import { useScreenHeaderHeight } from '../components/ui';
import VoiceInputModal from '../components/VoiceInputModal';
import { ThoughtDumpRepoPickerModal } from '../components/thoughts/ThoughtDumpRepoPickerModal';
import { indexDump, removeDump } from '../services/ai/thoughtDumpIndexing';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import { getActiveBranch } from '../services/git/activeBranchStore';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface Props {
  onDumpChange?: (dump: ThoughtDump) => void;
}

export default function ThoughtDumpScreen({ onDumpChange }: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const safeBack = useSafeBack();
  const route = useRoute<RouteProp<RootStackParamList, 'ThoughtDump'>>();
  const { colors, spacing } = useTokens();
  const headerHeight = useScreenHeaderHeight();
  const hasAutoOpenedVoiceRef = useRef(false);

  const [text, setText] = useState('');
  const [dumps, setDumps] = useState<ThoughtDump[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ThoughtDump | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [repoPath, setRepoPath] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [savedRepos, setSavedRepos] = useState<GitRepository[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);

  const selectionMode = selectedIds.size > 0;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const loadDumps = useCallback(async () => {
    setIsLoading(true);
    try {
      const repos = await StorageService.getSavedRepositories();
      setSavedRepos(repos);
      setIsAuthenticated(await GitHubService.isAuthenticatedAsync());

      const preference = await ThoughtDumpRepoPreferenceService.get();
      const lastUsed = await LastUsedRepoService.get();

      let resolvedRepoPath = '';

      if (preference && repos.some((r) => r.path === preference.repoPath)) {
        resolvedRepoPath = preference.repoPath;
      } else if (lastUsed && repos.some((r) => r.path === lastUsed)) {
        resolvedRepoPath = lastUsed;
      } else if (repos.length > 0) {
        resolvedRepoPath = repos[0].path;
      }

      setRepoPath(resolvedRepoPath);

      const result = await ThoughtDumpService.list(
        resolvedRepoPath ? { repoPath: resolvedRepoPath } : undefined,
      );
      setDumps(result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch {
      // silently handled
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDumps();
  }, [loadDumps]);

  useEffect(() => {
    if (route.params?.openVoiceOnMount && !hasAutoOpenedVoiceRef.current) {
      hasAutoOpenedVoiceRef.current = true;
      setShowVoiceModal(true);
    }
  }, [route.params?.openVoiceOnMount]);

  const handleVoiceDone = useCallback((spokenText: string) => {
    setText((prev) => (prev ? `${prev} ${spokenText}` : spokenText));
    setShowVoiceModal(false);
  }, []);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!repoPath || !isAuthenticated || savedRepos.length === 0) {
      setPickerVisible(true);
      return;
    }

    const repo = savedRepos.find((r) => r.path === repoPath);
    const repoId = repo?.id;
    const activeBranchState = repoId ? await getActiveBranch(repoId) : null;
    const branch = activeBranchState?.activeBranch ?? undefined;

    setIsSaving(true);
    try {
      const result = await ThoughtDumpService.create(trimmed, { repoPath, branch });
      if (result.ok) {
        setText('');
        setDumps((prev) => [result.dump, ...prev]);
        indexDump(result.dump);
        onDumpChange?.(result.dump);
      } else {
        switch (result.reason) {
          case 'not-authenticated':
            Alert.alert(t('common.error'), t('thoughtDump.errorNotAuthenticated'));
            break;
          case 'no-repos':
            Alert.alert(t('common.error'), t('thoughtDump.errorNoRepo'));
            break;
          case 'invalid-repo':
            Alert.alert(t('common.error'), t('thoughtDump.errorInvalidRepo'));
            break;
          case 'write-failed':
            Alert.alert(t('common.error'), t('thoughtDump.errorWriteFailed'));
            break;
        }
      }
    } catch {
      Alert.alert(t('common.error'), t('thoughtDump.errorWriteFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);

    const repo = savedRepos.find((r) => r.path === repoPath);
    const repoId = repo?.id;
    const activeBranchState = repoId ? await getActiveBranch(repoId) : null;
    const branch = activeBranchState?.activeBranch ?? undefined;

    const opId = gitOperationRegistry.begin({
      kind: 'delete',
      repo: repoPath,
      branch,
      path: target.filePath,
      entityIds: [target.id],
      status: 'running',
      attempts: 0,
    });
    try {
      const success = await ThoughtDumpService.delete(target.id, {
        repoPath,
        branch,
        filePath: target.filePath,
      });
      if (success) {
        gitOperationRegistry.succeed(opId);
        setDumps((prev) => prev.filter((d) => d.id !== target.id));
        removeDump(target.filePath);
        onDumpChange?.(target);
      } else {
        gitOperationRegistry.fail(opId, 'Delete failed');
        Alert.alert(t('common.error'), t('thoughtDump.error'));
      }
    } catch {
      gitOperationRegistry.fail(opId, 'Delete failed');
      Alert.alert(t('common.error'), t('thoughtDump.error'));
    }
  };

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      t('thoughtDump.confirmDelete'),
      `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'thought dump' : 'thought dumps'}?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const repo = savedRepos.find((r) => r.path === repoPath);
            const repoId = repo?.id;
            const activeBranchState = repoId ? await getActiveBranch(repoId) : null;
            const branch = activeBranchState?.activeBranch ?? undefined;
            const toDelete = dumps.filter((d) => selectedIds.has(d.id));
            let anyFailed = false;
            for (const dump of toDelete) {
              try {
                const ok = await ThoughtDumpService.delete(dump.id, {
                  repoPath,
                  branch,
                  filePath: dump.filePath,
                });
                if (ok) {
                  setDumps((prev) => prev.filter((d) => d.id !== dump.id));
                  removeDump(dump.filePath);
                  onDumpChange?.(dump);
                } else {
                  anyFailed = true;
                }
              } catch {
                anyFailed = true;
              }
            }
            clearSelection();
            if (anyFailed) {
              Alert.alert(t('common.error'), t('thoughtDump.error'));
            }
          },
        },
      ],
    );
  }, [selectedIds, dumps, repoPath, savedRepos, clearSelection, onDumpChange, removeDump, t]);

  const formatRelativeDate = (isoDate: string): string => {
    const now = Date.now();
    const then = new Date(isoDate).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t('thoughtDump.justNow');
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHr < 24) return `${diffHr}h`;
    return `${diffDay}d`;
  };

  const renderItem = useCallback(
    ({ item }: { item: ThoughtDump }) => (
      <SwipeableListItem
        itemId={item.id}
        selected={selectedIds.has(item.id)}
        selectionMode={selectionMode}
        onToggleSelect={() => toggleSelected(item.id)}
      >
        <View
          style={[
            styles.dumpItem,
            {
              padding: spacing[3],
              marginBottom: spacing[2],
              backgroundColor: colors.surface,
            },
          ]}
        >
          <Text style={[styles.dumpText, { color: colors.text }]} numberOfLines={6}>
            {item.text}
          </Text>
          <View style={[styles.dumpFooter, { marginTop: spacing[2] }]}>
            <Text style={[styles.dumpDate, { color: colors.textSecondary }]}>
              {formatRelativeDate(item.createdAt)}
            </Text>
            <Button
              testID={`thought-dump-delete-${item.id}`}
              label={t('thoughtDump.delete')}
              variant="ghost"
              onPress={() => setDeleteTarget(item)}
            />
          </View>
        </View>
      </SwipeableListItem>
    ),
    [colors, spacing, t, formatRelativeDate, selectedIds, selectionMode, toggleSelected],
  );

  const renderEmpty = () => {
    if (isLoading) return null;
    if (!isAuthenticated) {
      return (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="lock-closed"
            title={t('thoughtDump.noAuthTitle')}
            subtitle={t('thoughtDump.noAuthBody')}
          />
          <Button
            testID="thought-dump-empty-action"
            label={t('thoughtDump.goToSettings')}
            variant="primary"
            onPress={() => navigation.navigate('MainTabs', { screen: 'SettingsTab' })}
          />
        </View>
      );
    }
    if (savedRepos.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="folder-open"
            title={t('thoughtDump.noRepoConfiguredTitle')}
            subtitle={t('thoughtDump.noRepoConfiguredBody')}
          />
          <Button
            testID="thought-dump-empty-action"
            label={t('thoughtDump.goToSettings')}
            variant="primary"
            onPress={() => navigation.navigate('MainTabs', { screen: 'SettingsTab' })}
          />
        </View>
      );
    }
    return (
      <EmptyState
        icon="bulb"
        title={t('thoughtDump.empty')}
      />
    );
  };

  const blocked = useProScreenGuard();

  if (blocked) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        <View style={[styles.composer, { padding: spacing[4] }]}>
          <Pressable
            testID="thought-dump-repo-picker"
            accessibilityRole="button"
            onPress={() => setPickerVisible(true)}
            style={[
              styles.repoPicker,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                padding: spacing[3],
                marginBottom: spacing[3],
              },
            ]}
          >
            <Text style={[styles.repoPickerLabel, { color: colors.textSecondary }]}>
              {t('thoughtDump.repo')}
            </Text>
            <View style={styles.repoPickerValueRow}>
              <Text
                style={[styles.repoPickerValue, { color: colors.text }]}
                numberOfLines={1}
              >
                {repoPath ? repoPath : t('thoughtDump.chooseRepo')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </View>
          </Pressable>
          <Input
            testID="thought-dump-input"
            multiline
            value={text}
            onChangeText={setText}
            placeholder={t('thoughtDump.placeholder')}
            placeholderTextColor={colors.textSecondary}
            multilineMinHeight={100}
          />
          <View style={styles.actionRow}>
            <Pressable
              testID="thought-dump-voice"
              accessibilityRole="button"
              accessibilityLabel={t('thoughtDump.voiceInput')}
              onPress={() => setShowVoiceModal(true)}
              style={[
                styles.micButton,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="mic" size={20} color={colors.primary} />
            </Pressable>
            <View style={{ flex: 1, marginLeft: spacing[2] }}>
              <Button
                testID="thought-dump-save"
                label={t('thoughtDump.save')}
                variant="primary"
                onPress={handleSave}
                disabled={isSaving || text.trim().length === 0}
                fullWidth
              />
            </View>
          </View>
        </View>

        <FlatList
          data={dumps}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing[3], paddingBottom: spacing[6] + (selectionMode ? 72 : 0) }}
          ListEmptyComponent={renderEmpty}
        />

        <BulkActionBar
          count={selectedIds.size}
          onCancel={clearSelection}
          onDelete={handleBulkDelete}
          bottomOffset={spacing[4]}
          itemNoun="thought dump"
        />
      </View>

      <Modal
        visible={deleteTarget !== null}
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={{ padding: spacing[4] }}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {t('thoughtDump.confirmDelete')}
          </Text>
          <View style={[styles.modalActions, { marginTop: spacing[4] }]}>
            <Button
              testID="thought-dump-cancel-delete"
              label={t('common.cancel')}
              variant="secondary"
              onPress={() => setDeleteTarget(null)}
            />
            <View style={{ marginLeft: spacing[2] }}>
              <Button
                testID="thought-dump-confirm-delete"
                label={t('common.delete')}
                variant="primary"
                onPress={handleDeleteConfirm}
              />
            </View>
          </View>
        </View>
      </Modal>

      <VoiceInputModal
        visible={showVoiceModal}
        onDone={handleVoiceDone}
        onClose={() => setShowVoiceModal(false)}
      />

      <ThoughtDumpRepoPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelected={(rp) => {
          setRepoPath(rp);
          setPickerVisible(false);
          void loadDumps();
        }}
        onGoToSettings={() => {
          setPickerVisible(false);
          navigation.navigate('MainTabs', { screen: 'SettingsTab' });
        }}
      />

      <ScreenHeader
        title={t('thoughtDump.title')}
        onBack={safeBack}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  composer: {},
  repoPicker: {
    borderRadius: 8,
    borderWidth: 1,
  },
  repoPickerLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  repoPickerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  repoPickerValue: {
    flex: 1,
    fontSize: 15,
    marginRight: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  dumpItem: {
    borderRadius: 8,
  },
  dumpText: {
    fontSize: 15,
    lineHeight: 22,
  },
  dumpFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dumpDate: {
    fontSize: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 8,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
