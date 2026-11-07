import { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, Alert, FlatList, RefreshControl } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useChatStore } from '../stores/chatStore';
import { useAIHubStore } from '../stores/aiHubStore';
import { useAIStore } from '../stores/aiStore';
import { githubActivity } from '../stores/githubActivityStore';
import { useTokens } from '../contexts/ThemeContext';
import { RootStackParamList } from '../navigation/types';
import { ChatThreadSummary } from '../models/Chat';
import { ScreenHeader, Button, EmptyState, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { ChatThreadCard } from '../components/chat/ChatThreadCard';
import { ChatThreadContextMenu } from '../components/chat/ChatThreadContextMenu';
import { TextPromptModal } from '../components/chat/TextPromptModal';
import { HapticService } from '../utils/haptics';
import { useTranslation } from 'react-i18next';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ChatThreadListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const safeBack = useSafeBack();
  const { colors, spacing } = useTokens();
  const headerHeight = useScreenHeaderHeight();
  const tabBarHeight = useTabBarHeight();

  const threads = useChatStore((state) => state.threads);
  const isLoading = useChatStore((state) => state.isLoading);
  const storeError = useChatStore((state) => state.error);
  const loadThreads = useChatStore((state) => state.loadThreads);
  const deleteThread = useChatStore((state) => state.deleteThread);
  const renameThread = useChatStore((state) => state.renameThread);

  const chatRepoOwner = useAIStore((state) => state.chatRepoOwner);
  const chatRepoName = useAIStore((state) => state.chatRepoName);
  const chatRepoBranch = useAIStore((state) => state.chatRepoBranch);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const isPullRefreshingRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [longPressedThread, setLongPressedThread] = useState<ChatThreadSummary | null>(null);
  const [renamingThread, setRenamingThread] = useState<ChatThreadSummary | null>(null);

  const selectionMode = selectedIds.size > 0;
  const isFocused = useIsFocused();

  // Reset refresh state when screen loses focus (tab switch, stack push, etc.)
  useEffect(() => {
    if (!isFocused) {
      isPullRefreshingRef.current = false;
      setIsPullRefreshing(false);
    }
  }, [isFocused]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, chatRepoOwner, chatRepoName, chatRepoBranch]);

  const handleRefresh = async () => {
    if (isPullRefreshingRef.current) return;
    isPullRefreshingRef.current = true;
    setIsPullRefreshing(true);

    const safetyTimeout = setTimeout(() => {
      isPullRefreshingRef.current = false;
      setIsPullRefreshing(false);
    }, 30000);

    await loadThreads();

    clearTimeout(safetyTimeout);
    isPullRefreshingRef.current = false;
    setIsPullRefreshing(false);
  };

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleThreadPress = useCallback(
    (threadId: string) => {
      if (selectionMode) {
        toggleSelected(threadId);
      } else {
        navigation.navigate('ChatScreen', { threadId });
      }
    },
    [navigation, selectionMode, toggleSelected],
  );

  const handleThreadLongPress = useCallback((thread: ChatThreadSummary) => {
    HapticService.selection();
    setLongPressedThread(thread);
  }, []);

  const handleOpenThread = (thread: ChatThreadSummary) => {
    setLongPressedThread(null);
    navigation.navigate('ChatScreen', { threadId: thread.id });
  };

  const handleRenameConfirm = (title: string) => {
    const target = renamingThread;
    setRenamingThread(null);
    if (!target) return;
    renameThread({ threadId: target.id, title });
    HapticService.success();
  };

  const handleDeleteThread = async (thread: ChatThreadSummary) => {
    githubActivity.begin(t('chat.deleting'));
    try {
      const deleted = await deleteThread(thread);
      if (!deleted) {
        Alert.alert(t('chat.deleteFailed'), useChatStore.getState().error ?? t('chat.couldNotDelete'));
        HapticService.error();
        return;
      }
      HapticService.success();
    } finally {
      githubActivity.end();
    }
  };

  const handleBulkDelete = useCallback(() => {
    const targets = threads.filter((thread) => selectedIds.has(thread.id));
    if (targets.length === 0) return;
    Alert.alert(
      t('chat.deleteBulkConfirm', { count: targets.length }),
      t('common.cannotBeUndone'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            githubActivity.begin(t('chat.deletingMany'));
            try {
              for (const target of targets) {
                const deleted = await deleteThread(target);
                if (!deleted) {
                  Alert.alert(t('chat.deleteFailed'), useChatStore.getState().error ?? t('chat.couldNotDeleteMany'));
                  HapticService.error();
                  return;
                }
              }
              HapticService.success();
            } finally {
              setSelectedIds(new Set());
              githubActivity.end();
            }
          },
        },
      ],
    );
  }, [deleteThread, selectedIds, t, threads]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const renderThread = useCallback(
    ({ item }: { item: ChatThreadSummary }) => (
      <SwipeableListItem
        itemId={item.id}
        selected={selectedIds.has(item.id)}
        selectionMode={selectionMode}
        onToggleSelect={() => toggleSelected(item.id)}
      >
        <ChatThreadCard
          thread={item}
          onPress={() => handleThreadPress(item.id)}
          onLongPress={() => handleThreadLongPress(item)}
        />
      </SwipeableListItem>
    ),
    [selectedIds, selectionMode, toggleSelected, handleThreadPress, handleThreadLongPress],
  );

  const blocked = useProScreenGuard(() => useAIHubStore.getState().closeChatRepoPicker());

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View className="flex-1 justify-center items-center pt-16">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    return (
      <EmptyState
        icon="sparkles"
        iconColor={colors.primary}
        title={storeError ? t('chat.listLoadFailed') : t('chat.emptyTitle')}
        subtitle={storeError ?? t('chat.emptySubtitle')}
      />
    );
  };

  if (blocked) return null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <View className="flex-1" style={{ paddingTop: headerHeight }}>
        <View className="px-4 pt-4 pb-3">
          <Button
            testID="chat-thread-list.button.new-chat"
            label={t('chat.newChat')}
            onPress={() => useAIHubStore.getState().goNewChat(navigation)}
            variant="primary"
            leadingIcon={<Ionicons name="add" size={20} color={colors.accent} />}
            iconAlign="edge"
            fullWidth
          />
        </View>

        <FlatList
          data={threads}
          renderItem={renderThread}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: spacing[6] }}
          refreshControl={
            <RefreshControl
              refreshing={isPullRefreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={['transparent']}
            />
          }
          ListEmptyComponent={renderEmptyState}
          ItemSeparatorComponent={() => <View style={{ height: spacing[3] }} />}
        />
      </View>

      <ChatThreadContextMenu
        thread={longPressedThread}
        visible={longPressedThread !== null}
        onClose={() => setLongPressedThread(null)}
        onOpen={handleOpenThread}
        onRename={setRenamingThread}
        onDelete={handleDeleteThread}
        bottomSheet
      />

      <TextPromptModal
        visible={renamingThread !== null}
        title={t('chat.renameTitle')}
        message={t('chat.renameBody')}
        initialValue={renamingThread?.title ?? ''}
        confirmLabel={t('common.save')}
        testIDPrefix="chat-rename"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenamingThread(null)}
      />

      <BulkActionBar
        count={selectedIds.size}
        itemNoun={t('chat.chat')}
        bottomOffset={Math.max(tabBarHeight + 4, 8)}
        onCancel={clearSelection}
        onDelete={handleBulkDelete}
      />

      <ScreenHeader
        title={t('chat.title')}
        onBack={safeBack}
      />
    </SafeAreaView>
  );
}
