import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, TextInput, ActivityIndicator, Alert, Pressable, SectionList, RefreshControl, StyleSheet, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import type { ChatRunStatus } from '../services/chat/types';
import { ScreenHeader, Button, EmptyState, IconButton, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { ChatConversation } from '../components/chat/ChatConversation';
import { ChatThreadCard } from '../components/chat/ChatThreadCard';
import { BridgeSetupGuide } from '../components/chat/setup/BridgeSetupGuide';
import { ChatThreadContextMenu } from '../components/chat/ChatThreadContextMenu';
import { TextPromptModal } from '../components/chat/TextPromptModal';
import { buildThreadSections, type ThreadSection, type ThreadStatusMap } from '../components/chat/threadSections';
import { createDemoThread } from '../services/chat';
import { peekChatSession } from '../services/chat/sessions';
import { HapticService } from '../utils/haptics';
import { useTranslation } from 'react-i18next';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const SPLIT_VIEW_MIN_WIDTH = 900;
const LIST_PANE_WIDTH = 360;
export const AGENT_GUIDE_DISMISSED_KEY = '@gitnotes:agentGuideDismissed';

function useThreadStatuses(threads: ChatThreadSummary[]): ThreadStatusMap {
  const [statuses, setStatuses] = useState<ThreadStatusMap>({});

  useEffect(() => {
    const snapshot = (): ThreadStatusMap => {
      const next: Record<string, ChatRunStatus> = {};
      for (const thread of threads) {
        const status = peekChatSession(thread.id)?.store.getState().status;
        if (status && status !== 'idle') next[thread.id] = status;
      }
      return next;
    };
    const sync = () =>
      setStatuses((previous) => {
        const next = snapshot();
        const keys = Object.keys(next);
        const unchanged = keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key]);
        return unchanged ? previous : next;
      });
    sync();
    const unsubscribes = threads.flatMap((thread) => {
      const session = peekChatSession(thread.id);
      return session ? [session.store.subscribe(sync)] : [];
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [threads]);

  return statuses;
}

export default function ChatThreadListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const safeBack = useSafeBack();
  const { colors, spacing, type } = useTokens();
  const { width } = useWindowDimensions();
  const wide = width >= SPLIT_VIEW_MIN_WIDTH;
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

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(true);
  const [query, setQuery] = useState('');
  const statuses = useThreadStatuses(threads);
  const sections = useMemo(() => buildThreadSections(threads, statuses, query), [threads, statuses, query]);

  const showGuideNudge = !guideDismissed && !isLoading && !threads.some((thread) => thread.backend === 'agent');
  const activeThreadId = wide ? selectedThreadId : null;
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
    void AsyncStorage.getItem(AGENT_GUIDE_DISMISSED_KEY).then((value) => setGuideDismissed(value === 'true'));
  }, []);

  useEffect(() => {
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) setSelectedThreadId(null);
  }, [threads, selectedThreadId]);

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

  const openThread = useCallback(
    (threadId: string) => {
      if (wide) setSelectedThreadId(threadId);
      else navigation.navigate('ChatScreen', { threadId });
    },
    [navigation, wide],
  );

  const handleThreadPress = useCallback(
    (threadId: string) => {
      if (selectionMode) toggleSelected(threadId);
      else openThread(threadId);
    },
    [openThread, selectionMode, toggleSelected],
  );

  const dismissGuideNudge = useCallback(() => {
    setGuideDismissed(true);
    void AsyncStorage.setItem(AGENT_GUIDE_DISMISSED_KEY, 'true');
  }, []);

  const handleTryDemo = useCallback(async () => {
    setGuideVisible(false);
    try {
      const thread = await createDemoThread();
      openThread(thread.id);
    } catch (error) {
      Alert.alert(t('chat.createFailed'), error instanceof Error ? error.message : undefined);
    }
  }, [openThread, t]);

  const handleThreadLongPress = useCallback((thread: ChatThreadSummary) => {
    HapticService.selection();
    setLongPressedThread(thread);
  }, []);

  const handleOpenThread = (thread: ChatThreadSummary) => {
    setLongPressedThread(null);
    openThread(thread.id);
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
          status={statuses[item.id]}
          selected={item.id === activeThreadId}
          onPress={() => handleThreadPress(item.id)}
          onLongPress={() => handleThreadLongPress(item)}
        />
      </SwipeableListItem>
    ),
    [selectedIds, selectionMode, statuses, activeThreadId, toggleSelected, handleThreadPress, handleThreadLongPress],
  );

  const sectionTitle = useCallback(
    (section: ThreadSection): string => {
      switch (section.kind) {
        case 'needs-you':
          return t('chat.sectionNeedsYou');
        case 'workspace':
          return section.title || t('chat.sectionAgents');
        case 'demo':
          return t('chat.sectionDemo');
        default:
          return t('chat.sectionChats');
      }
    },
    [t],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: ThreadSection }) => (
      <Text
        testID={`chat-thread-list.section.${section.key}`}
        style={{
          color: section.kind === 'needs-you' ? colors.warning : colors.textSecondary,
          backgroundColor: colors.background,
          fontSize: 12,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          paddingHorizontal: spacing[4],
          paddingTop: spacing[4],
          paddingBottom: spacing[1],
        }}
      >
        {sectionTitle(section)}
      </Text>
    ),
    [colors.background, colors.textSecondary, colors.warning, sectionTitle, spacing],
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

  const listPane = (
    <View className="flex-1">
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

          {showGuideNudge ? (
            <View
              testID="chat-thread-list.guide-nudge"
              className="mx-4 mb-3 flex-row items-center rounded-md px-3"
              style={{ backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: spacing[2] }}
            >
              <Ionicons name="terminal-outline" size={16} color={colors.textSecondary} />
              <Pressable
                testID="chat-thread-list.guide-nudge.open"
                accessibilityRole="button"
                onPress={() => setGuideVisible(true)}
                style={{ flex: 1, paddingVertical: spacing[2] }}
              >
                <Text style={{ color: colors.text, fontSize: type.sm }}>{t('agents.guide.nudge')}</Text>
              </Pressable>
              <Pressable
                testID="chat-thread-list.guide-nudge.dismiss"
                accessibilityRole="button"
                accessibilityLabel={t('common.dismiss')}
                onPress={dismissGuideNudge}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          <View className="px-4 pb-2">
            <View
              className="flex-row items-center rounded-md px-3"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                testID="chat-thread-list.input.search"
                value={query}
                onChangeText={setQuery}
                placeholder={t('chat.searchPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                style={{ flex: 1, color: colors.text, paddingVertical: spacing[2], paddingHorizontal: spacing[2] }}
              />
            </View>
          </View>

          <SectionList
            sections={sections}
            renderItem={renderThread}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingBottom: spacing[6] }}
            refreshControl={
              <RefreshControl
                refreshing={isPullRefreshing}
                onRefresh={handleRefresh}
                tintColor="transparent"
                colors={['transparent']}
              />
            }
            ListEmptyComponent={renderEmptyState}
          />
        </View>

        <ScreenHeader
          title={t('chat.title')}
          onBack={safeBack}
          actions={
            showGuideNudge ? (
              <IconButton
                testID="chat-thread-list.button.guide"
                size="sm"
                accessibilityLabel={t('agents.guide.title')}
                onPress={() => setGuideVisible(true)}
              >
                <Ionicons name="help-circle-outline" size={20} color={colors.accent} />
              </IconButton>
            ) : undefined
          }
        />

    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      {wide ? (
        <View testID="chat-thread-list.split" className="flex-1 flex-row">
          <View style={{ width: LIST_PANE_WIDTH, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }}>
            {listPane}
          </View>
          <View className="flex-1">
            {activeThreadId ? (
              <ChatConversation key={activeThreadId} threadId={activeThreadId} embedded />
            ) : (
              <EmptyState
                testID="chat-thread-list.split.placeholder"
                icon="chatbubbles-outline"
                title={t('chat.splitPlaceholderTitle')}
                subtitle={t('chat.splitPlaceholderSubtitle')}
              />
            )}
          </View>
        </View>
      ) : (
        listPane
      )}

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

      <BridgeSetupGuide visible={guideVisible} onClose={() => setGuideVisible(false)} onTryDemo={() => void handleTryDemo()} />
    </SafeAreaView>
  );
}
