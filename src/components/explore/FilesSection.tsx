import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/Button';
import { FlatList } from '@/components/ui/flat-list';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { FileStatus } from '@/services/git/engine/GitEngine';
import { GitHubService } from '@/services/GitHubService';
import { GitFsService } from '@/services/git/GitFsService';
import type { RootStackParamList } from '@/navigation/types';
import { parseRepoPath } from '@/utils/gitPathParser';
import {
  buildFileTreeRows,
  changedFileAncestors,
  isBinaryPath,
  resolveStatusTone,
  STATUS_META,
  walkWorkingTree,
  type FileTreeRow,
  type SectionProps,
} from './exploreShared';
import { useTokens } from '@/contexts/ThemeContext';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface FilesData {
  files: string[];
  truncated: boolean;
  statuses: Record<string, FileStatus>;
}

export function FilesSection({ repo, active, chromeTopInset = 0, branchInvalidationKey = 0 }: SectionProps) {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTokens();
  const [data, setData] = useState<FilesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notCloned, setNotCloned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotCloned(false);
    try {
      const cloned = await GitFsService.isCloned({ repoPath: repo.path });
      if (!cloned) {
        setNotCloned(true);
        setLoading(false);
        return;
      }

      let files: string[] = [];
      let truncated = false;

      try {
        const tree = walkWorkingTree(repo.localPath);
        files = tree.files;
        truncated = tree.truncated;
      } catch {
        const parts = repo.path.split('/');
        const owner = parts[0];
        const repoName = parts[1] ?? parts[0];
        const branch = repo.branch ?? 'main';
        const treeEntries = await GitHubService.getTreeRecursiveOrThrow(owner, repoName, branch);
        files = treeEntries.map((e) => e.path);
      }

      let entries: FileStatus[] = [];
      try {
        entries = await GitEngine.statuses(repo.localPath);
      } catch {
        entries = [];
      }
      const statuses: Record<string, FileStatus> = {};
      for (const entry of entries) statuses[entry.path] = entry;
      setData({ files, truncated, statuses });
      setExpanded(changedFileAncestors(entries.map((entry) => entry.path)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [repo.localPath, repo.path, repo.branch]);

  const branchAwareLoad = useCallback(async () => {
    await load();
  }, [load, branchInvalidationKey]);

  useEffect(() => {
    if (active) void branchAwareLoad();
  }, [active, branchAwareLoad]);

  const rows = useMemo(
    () => (data ? buildFileTreeRows(data.files, expanded) : []),
    [data, expanded],
  );

  const toggleDir = useCallback((dirPath: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: FileTreeRow }) => {
      if (item.kind === 'dir') {
        return (
          <Pressable
            onPress={() => toggleDir(item.path)}
            accessibilityRole="button"
            testID={`explore.files.dir.${item.path}`}
            className="mx-4 mb-1 flex-row items-center rounded-sm px-3 py-2"
          style={{ marginLeft: 16 + item.depth * 16, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
          >
            <Ionicons
              name={item.expanded ? 'folder-open-outline' : 'folder-outline'}
              size={16}
              color={colors.textSecondary}
            />
            <Text className="ml-2 min-w-0 flex-1 text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="mr-1 text-[11px]" style={{ color: colors.textSecondary }}>{item.fileCount}</Text>
            <Ionicons
              name={item.expanded ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.textSecondary}
            />
          </Pressable>
        );
      }
      const status = data?.statuses[item.path];
      const meta = status ? STATUS_META[status.status] : null;
      const toneStyle = meta ? resolveStatusTone(colors, meta.tone) : null;
      const handlePress = () => {
        const ext = item.name.toLowerCase().split('.').pop() ?? '';
        if (ext === 'pdf') {
          const info = parseRepoPath(repo.path);
          if (info) {
            navigation.navigate('PdfViewer', {
              owner: info.owner,
              repo: info.repo,
              branch: repo.branch,
              path: item.path,
              title: item.name,
            });
            return;
          }
        }
        navigation.navigate('ExploreFile', { repoId: repo.id, path: item.path });
      };
      return (
        <Pressable
          onPress={handlePress}
          accessibilityRole="button"
          testID={`explore.file.${item.path}`}
          className="mx-4 mb-1.5 flex-row items-center rounded-sm px-3 py-2"
          style={{ marginLeft: 16 + item.depth * 16, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }}
        >
          <Ionicons
            name={meta?.icon ?? 'document-outline'}
            size={16}
            color={toneStyle?.fg ?? colors.textSecondary}
          />
          <Text className="ml-2 min-w-0 flex-1 text-sm" style={{ color: colors.text }} numberOfLines={1}>
            {item.name}
          </Text>
          {isBinaryPath(item.path) && (
            <View className="mr-1.5 rounded px-1.5 py-0.5" style={{ backgroundColor: colors.surface }}>
              <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>binary</Text>
            </View>
          )}
          {meta && toneStyle && (
            <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: toneStyle.bg }}>
              <Text className="text-[10px] font-semibold" style={{ color: toneStyle.fg }}>{meta.label}</Text>
            </View>
          )}
        </Pressable>
      );
    },
    [colors, data, navigation, repo.id, repo.path, repo.branch, toggleDir],
  );

  const listContentContainerStyle = useMemo(
    () => ({
      paddingTop: chromeTopInset,
      paddingBottom: 96,
      flexGrow: 1,
    }),
    [chromeTopInset],
  );

  if (error) {
    return (
      <View className="items-center px-8 py-10" style={{ paddingTop: chromeTopInset }}>
        <Ionicons name="warning-outline" size={36} color={colors.error} />
        <Text className="mt-2 text-center text-sm" style={{ color: colors.error }}>{error}</Text>
        <Button variant="outline" size="sm" className="mt-3" onPress={() => void load()}>
          <ButtonText>Retry</ButtonText>
        </Button>
      </View>
    );
  }

  if (notCloned) {
    return (
      <View className="items-center px-8 py-10" style={{ paddingTop: chromeTopInset }} testID="explore.files.not-cloned">
        <Ionicons name="folder-outline" size={36} color={colors.textSecondary} />
        <Text className="mt-2 text-center text-sm font-semibold" style={{ color: colors.text }}>Clone required</Text>
        <Text className="mt-1 text-center text-xs" style={{ color: colors.textSecondary }}>
          This repository has not been cloned to this device yet.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1"
      data={rows}
      extraData={colors}
      keyExtractor={(item) => `${item.kind}:${item.path}`}
      renderItem={renderItem}
      contentContainerStyle={listContentContainerStyle}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="transparent" colors={['transparent']} />
      }
      ListHeaderComponent={
        <View className="flex-row items-center justify-between px-4 pb-2">
          <Text className="text-xs" style={{ color: colors.textSecondary }} testID="explore.files.count">
            {data ? `${data.files.length} file(s)${data.truncated ? ' (truncated)' : ''}` : 'Reading working tree…'}
          </Text>
          {loading && <ActivityIndicator size="small" color={colors.accent} />}
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <View className="flex-1 items-center justify-center" style={{ minHeight: 240 }}>
            <Ionicons name="folder-open-outline" size={40} color={colors.textSecondary} />
            <Text className="mt-2 text-center text-sm" style={{ color: colors.textSecondary }}>Empty working tree.</Text>
          </View>
        ) : undefined
      }
      testID="explore.files.list"
    />
  );
}
