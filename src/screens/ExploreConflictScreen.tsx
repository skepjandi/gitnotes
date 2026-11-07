import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button, ButtonText } from '@/components/ui/Button';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { ConflictEntry } from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import { notePathForSidecar } from '@/services/crdt/crdtSidecar';
import { useRepoStore } from '@/stores/repoStore';
import { useTokens } from '@/contexts/ThemeContext';
import type { RootStackParamList } from '@/navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ExploreConflict'>;

/** Lists all conflicted files for a repository and lets the user navigate
 * to per-file conflict resolution. */
export default function ExploreConflictScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<Route>();
  const { colors } = useTokens();
  const { repoId } = route.params;

  const storedRepo = useRepoStore((state) =>
    state.repositories.find((candidate) => candidate.id === repoId),
  );

  let localPath: string | null = null;
  if (storedRepo) {
    try {
      localPath = GitFsService.workingTreeUri({ repoPath: storedRepo.path });
    } catch {
      localPath = null;
    }
  }
  const crdtMergeEnabled = storedRepo?.crdtMergeEnabled === true;

  const [conflicts, setConflicts] = useState<ConflictEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!localPath) return;
    try {
      const entries = await GitEngine.conflicts(localPath);
      const conflictedPaths = new Set(entries.map((entry) => entry.path));
      setConflicts(
        crdtMergeEnabled
          ? entries.filter((entry) => {
              const notePath = notePathForSidecar(entry.path);
              return notePath === null || !conflictedPaths.has(notePath);
            })
          : entries,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [localPath, crdtMergeEnabled]);

  useEffect(() => {
    if (!localPath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
  }, [localPath, load]);

  if (!storedRepo || !localPath) {
    return (
      <SafeAreaView edges={['top']} className="flex-1" style={{ flex: 1, backgroundColor: colors.background }}>
        <View className="flex-row items-center gap-2 px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Heading className="text-lg" style={{ color: colors.text }}>Conflicts</Heading>
        </View>
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="folder-outline" size={40} color={colors.textSecondary} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.textSecondary }}>
            Repository not found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: ConflictEntry }) => (
    <View
      className="rounded-lg p-4 mx-4 mb-2"
      style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
    >
      <View className="flex-row items-center justify-between">
        <View className="min-w-0 flex-1 mr-2">
          <View className="flex-row items-center gap-2 mb-1">
            <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={2}>
              {item.path}
            </Text>
          </View>
          {item.kind ? (
            <View className="flex-row items-center gap-1">
              <View
                className="rounded px-1.5 py-0.5"
                style={{ backgroundColor: colors.error }}
              >
                <Text className="text-[10px] font-semibold" style={{ color: '#fff' }}>
                  {item.kind}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <Button
          size="sm"
          variant="outline"
          onPress={() => navigation.navigate('ConflictResolve', { repoId, path: item.path })}
          testID={`explore-conflict.resolve.${item.path}`}
        >
          <ButtonText>Resolve</ButtonText>
        </Button>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1" style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        className="flex-row items-center gap-2 px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="explore-conflict.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Heading className="text-lg" style={{ color: colors.text }}>Conflicts</Heading>
          {conflicts && conflicts.length > 0 && (
            <View
              className="mt-0.5 rounded px-1.5 py-0.5 self-start"
              style={{ backgroundColor: colors.error }}
            >
              <Text className="text-[10px] font-semibold" style={{ color: '#fff' }}>
                {conflicts.length} file{conflicts.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-2" style={{ flex: 1 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text className="text-sm" style={{ color: colors.textSecondary }}>Reading conflicts…</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.error }}>{error}</Text>
          <Button className="mt-4" onPress={() => { setLoading(true); setError(null); void load(); }}>
            <ButtonText>Retry</ButtonText>
          </Button>
        </View>
      ) : conflicts && conflicts.length > 0 ? (
        <FlatList
          data={conflicts}
          renderItem={renderItem}
          keyExtractor={(item) => item.path}
          contentContainerStyle={{ paddingVertical: 8 }}
          testID="explore-conflict.list"
        />
      ) : (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="checkmark-circle-outline" size={44} color={colors.accent} />
          <Text className="mt-2 text-sm font-semibold" style={{ color: colors.text }}>No conflicts</Text>
          <Text className="mt-1 text-center text-xs" style={{ color: colors.textSecondary }}>
            This repository has no merge or push-with-integrate conflicts.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
