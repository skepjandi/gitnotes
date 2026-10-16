import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button, ButtonText } from '@/components/ui/Button';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { CommitInfo, FileDiff } from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import { useRepoStore } from '@/stores/repoStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { DiffLineList } from '@/components/explore/DiffLineList';
import { relativeTime } from '@/components/explore/exploreShared';
import { useTokens } from '@/contexts/ThemeContext';
import type { RootStackParamList } from '@/navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ExploreCommit'>;

const MAX_LINES_PER_FILE = 300;
const HISTORY_LOOKUP_LIMIT = 50;

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

function shortIdOf(commit: CommitInfo): string {
  return commit.shortId ?? commit.id.slice(0, 7);
}

/** Commit detail: metadata + message, per-commit changed files with patch,
 * and history actions (checkout detached, reset soft, revert). */
export default function ExploreCommitScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<Route>();
  const { colors } = useTokens();
  const { repoId, commitId } = route.params;
  const storedRepo = useRepoStore((state) =>
    state.repositories.find((candidate) => candidate.id === repoId),
  );
  const { activeAccount } = useActiveAccount();
  let localPath: string | null = null;
  if (storedRepo) {
    try {
      localPath = GitFsService.workingTreeUri({ repoPath: storedRepo.path });
    } catch {
      localPath = null;
    }
  }

  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checkout' | 'reset' | 'revert' | null>(null);

  useEffect(() => {
    if (!localPath) return;
    let cancelled = false;
    (async () => {
      try {
        const [history, commitDiffs] = await Promise.all([
          GitEngine.log(localPath, HISTORY_LOOKUP_LIMIT),
          GitEngine.commitDiff(localPath, commitId),
        ]);
        const found = history.find((candidate) => candidate.id === commitId) ?? null;
        if (!cancelled) {
          setCommit(found);
          setDiffs(commitDiffs);
          if (!found) setError('Commit not found in local history.');
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localPath, commitId]);

  const runAction = useCallback(
    async (action: 'checkout' | 'reset' | 'revert') => {
      if (!localPath || !commit || busy) return;
      setBusy(action);
      try {
        if (action === 'checkout') {
          await GitEngine.checkoutCommit(localPath, commit.id);
          Alert.alert('Checked out', `HEAD is now detached at ${shortIdOf(commit)}.`, [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
        } else if (action === 'reset') {
          await GitEngine.resetSoft(localPath, commit.id);
          Alert.alert(
            'Reset (soft) done',
            `Current branch now points at ${shortIdOf(commit)}; staged and working-tree changes were kept.`,
            [{ text: 'OK', onPress: () => navigation.goBack() }],
          );
        } else {
          const author = activeAccount
            ? { name: activeAccount.name, email: activeAccount.email ?? '' }
            : { name: 'GitNotes', email: 'gitnotes@local' };
          const reverted = await GitEngine.revertCommit(localPath, commit.id, author);
          Alert.alert(
            'Reverted',
            `Created ${reverted.shortId ?? 'new commit'} — ${reverted.summary ?? reverted.message}`,
            [{ text: 'OK', onPress: () => navigation.goBack() }],
          );
        }
      } catch (caught) {
        Alert.alert('Action failed', caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [localPath, commit, busy, activeAccount, navigation],
  );

  const confirmAction = useCallback(
    (action: 'checkout' | 'reset' | 'revert') => {
      if (!commit) return;
      const shortId = shortIdOf(commit);
      const copy: Record<typeof action, { title: string; message: string; button: string }> = {
        checkout: {
          title: 'Checkout commit',
          message: `Detach HEAD at ${shortId}? The repo leaves the current branch until you check one out again. Requires a clean working tree.`,
          button: 'Checkout',
        },
        reset: {
          title: 'Reset (soft)',
          message: `Move the current branch to ${shortId}? Commits after it stop being referenced by the branch; the index and working tree are kept.`,
          button: 'Reset soft',
        },
        revert: {
          title: 'Revert commit',
          message: `Create a new commit that undoes ${shortId} (${commit.summary || commit.message})?`,
          button: 'Revert',
        },
      };
      const { title, message, button } = copy[action];
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: button, style: action === 'reset' ? 'destructive' : 'default', onPress: () => void runAction(action) },
      ]);
    },
    [commit, runAction],
  );

  if (!storedRepo || !localPath) {
    return (
      <SafeAreaView className="flex-1" style={{ flex: 1, backgroundColor: colors.background }} testID="explore-commit.missing-repo">
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Text style={{ color: colors.textSecondary }}>Repository not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalAdded = diffs?.reduce((sum, diff) => sum + (diff.added ?? 0), 0) ?? 0;
  const totalDeleted = diffs?.reduce((sum, diff) => sum + (diff.deleted ?? 0), 0) ?? 0;

  return (
    <SafeAreaView edges={['top']} className="flex-1" style={{ flex: 1, backgroundColor: colors.background }} testID="explore-commit.root">
      <View
        className="flex-row items-center gap-2 px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="explore-commit.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Heading className="text-lg" style={{ color: colors.text }} numberOfLines={1}>
            Commit
          </Heading>
          <Text className="text-xs font-mono" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {commit ? shortIdOf(commit) : commitId.slice(0, 7)}
          </Text>
        </View>
        {commit && commit.parentCount > 1 && (
          <View className="rounded px-2 py-0.5" style={{ backgroundColor: `${colors.accent}26` }}>
            <Text className="text-[10px] font-semibold" style={{ color: colors.accent }}>merge</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-2" style={{ flex: 1 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text className="text-sm" style={{ color: colors.textSecondary }}>Reading commit…</Text>
        </View>
      ) : error || !commit ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.error }}>{error}</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View className="rounded-lg p-4" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}>
            <View className="flex-row items-center gap-2">
              <View className="rounded px-2 py-0.5" style={{ backgroundColor: colors.elevated }}>
                <Text className="text-[11px] font-mono" style={{ color: colors.text }} testID="explore-commit.shortid">
                  {shortIdOf(commit)}
                </Text>
              </View>
              <Text className="text-[11px]" style={{ color: colors.textSecondary }}>
                {relativeTime(commit.authorTime * 1000)}
              </Text>
            </View>
            <Text className="mt-3 text-base font-bold" style={{ color: colors.text }} testID="explore-commit.summary">
              {commit.summary || '(no message)'}
            </Text>
            {commit.message !== commit.summary && commit.message.length > 0 && (
              <Text className="mt-2 text-sm" style={{ color: colors.textSecondary }}>{commit.message}</Text>
            )}

            <View className="mt-4 pt-3" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <View className="flex-row items-center gap-2 py-1">
                <Ionicons name="person-circle-outline" size={15} color={colors.textSecondary} />
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  {commit.authorName ?? 'Unknown author'}
                  {commit.authorEmail ? ` <${commit.authorEmail}>` : ''}
                </Text>
              </View>
              <View className="flex-row items-center gap-2 py-1">
                <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  authored {formatDate(commit.authorTime)}
                </Text>
              </View>
            </View>

            <View className="mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                Parents ({commit.parentCount})
              </Text>
              <Text className="mt-1 text-xs" style={{ color: colors.textSecondary }}>
                {commit.parentCount === 0
                  ? 'root commit'
                  : `${commit.parentCount} parent commit${commit.parentCount === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>

          <View className="mt-3 rounded-lg p-3" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }} testID="explore-commit.actions">
            <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>History actions</Text>
            <View className="mt-2 flex-row gap-2">
              <Button
                className="flex-1"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onPress={() => confirmAction('checkout')}
                testID="explore-commit.checkout"
              >
                {busy === 'checkout' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                <ButtonText>Checkout</ButtonText>
              </Button>
              <Button
                className="flex-1"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onPress={() => confirmAction('reset')}
                testID="explore-commit.reset-soft"
              >
                {busy === 'reset' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                <ButtonText>Reset soft</ButtonText>
              </Button>
              <Button
                className="flex-1"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onPress={() => confirmAction('revert')}
                testID="explore-commit.revert"
              >
                {busy === 'revert' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                <ButtonText>Revert</ButtonText>
              </Button>
            </View>
          </View>

          <View className="mt-3" testID="explore-commit.diff">
            <View className="flex-row items-center justify-between px-1 pb-2">
              <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
                {diffs ? `${diffs.length} file(s) changed` : 'Reading diff…'}
              </Text>
              {diffs && (
                <Text className="text-xs font-mono">
                  <Text className="font-mono" style={{ color: colors.success }}>+{totalAdded}</Text>
                  <Text style={{ color: colors.textSecondary }}> </Text>
                  <Text className="font-mono" style={{ color: colors.error }}>−{totalDeleted}</Text>
                </Text>
              )}
            </View>
            {!diffs ? (
              <View className="items-center rounded-lg py-6" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : diffs.length === 0 ? (
              <View className="items-center rounded-lg py-6" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}>
                <Text className="text-sm" style={{ color: colors.textSecondary }}>
                  No file changes (empty or merge commit).
                </Text>
              </View>
            ) : (
              diffs.map((diff) => {
                const truncated = diff.lines.length > MAX_LINES_PER_FILE;
                return (
                  <View
                    key={diff.path}
                    className="mb-2 rounded-lg p-3"
                    style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
                    testID={`explore-commit.diff.${diff.path}`}
                  >
                    <View className="flex-row items-center gap-2">
                      <Text
                        className="min-w-0 flex-1 text-xs font-semibold"
                        style={{ color: colors.text }}
                        numberOfLines={2}
                      >
                        {diff.path}
                      </Text>
                      <Text className="text-[11px] font-mono">
                        <Text className="font-mono" style={{ color: colors.success }}>+{diff.added ?? 0}</Text>
                        <Text style={{ color: colors.textSecondary }}> </Text>
                        <Text className="font-mono" style={{ color: colors.error }}>−{diff.deleted ?? 0}</Text>
                      </Text>
                    </View>
                    <View className="mt-2">
                      {diff.isBinary ? (
                        <Text
                          className="rounded px-2 py-1.5 text-[11px] italic"
                          style={{ backgroundColor: colors.surfaceSecondary, color: colors.textSecondary }}
                        >
                          binary file
                        </Text>
                      ) : (
                        <DiffLineList lines={diff.lines.slice(0, MAX_LINES_PER_FILE)} />
                      )}
                      {truncated && (
                        <Text className="mt-1 text-[10px] italic" style={{ color: colors.textSecondary }}>
                          {diff.lines.length - MAX_LINES_PER_FILE} more lines not shown
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
