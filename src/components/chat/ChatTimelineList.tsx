import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef, type ListRenderItem, type ViewToken } from '@shopify/flash-list';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatMessage } from '../../models/Chat';
import type {
  ElicitationRequest,
  ElicitationResult,
  PermissionDecision,
  PermissionRequest,
  QueuedPrompt,
} from '../../services/chat/types';
import { ChatMessageBubble, SystemNote } from '../ai/ChatMessageBubble';
import { ElicitationCard } from './ElicitationCard';
import { earlierStartKey, HISTORY_PAGE, windowTimeline, type ListRow } from './historyWindow';
import { RowArrival } from './motion/RowArrival';
import { PermissionCard } from './PermissionCard';
import { PlanCard } from './PlanCard';
import { ThoughtBlock } from './ThoughtBlock';
import { WorkLine } from './WorkLine';
import { buildTimeline } from './timeline';

/** Distance from the bottom beyond which the user counts as "reading history": no auto-follow, show the pill. */
const JUMP_PILL_DISTANCE = 160;
/** Fraction of the viewport within which new content keeps the list pinned to the bottom. */
const AUTOSCROLL_THRESHOLD = 0.2;
const ROW_GAP = 20;
const VIEWABILITY = { itemVisiblePercentThreshold: 40 } as const;

export interface ChatTimelineListProps {
  messages: ChatMessage[];
  pendingPermissions: PermissionRequest[];
  queuedPrompts: QueuedPrompt[];
  pendingElicitations?: ElicitationRequest[];
  /** Names the asker on elicitation cards. */
  agentName?: string;
  /** A turn is in flight: the tail message is still being written. */
  isRunning: boolean;
  headerHeight: number;
  empty: ReactElement;
  onLongPress?: (message: ChatMessage) => void;
  onResolvePermission: (requestId: string, decision: PermissionDecision) => void;
  onResolveElicitation?: (requestId: string, result: ElicitationResult) => void;
  onCancelQueued: (promptId: string) => void;
  onRetryQueued: (promptId: string) => void;
}

function keyExtractor(item: ListRow): string {
  return item.key;
}

const NOOP_RESOLVE_ELICITATION = () => {
  /* noop */
};

function TimeDivider({ timestamp }: { timestamp: number }) {
  const { colors, type } = useTokens();
  return (
    <Text testID="chat-time" style={{ alignSelf: 'center', color: colors.textSecondary, fontSize: type.xs }}>
      {format(timestamp, 'MMM d, h:mm a')}
    </Text>
  );
}

interface QueuedRowProps {
  prompt: QueuedPrompt;
  onCancel: (promptId: string) => void;
  onRetry: (promptId: string) => void;
}

function QueuedRow({ prompt, onCancel, onRetry }: QueuedRowProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const failed = prompt.state === 'failed';
  return (
    <View testID={`chat-queued.${prompt.id}`} style={{ alignSelf: 'flex-end', maxWidth: '85%', alignItems: 'flex-end' }}>
      <View
        style={{
          opacity: 0.55,
          backgroundColor: colors.elevated,
          borderWidth: 1,
          borderColor: failed ? colors.error : colors.border,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: colors.text, fontSize: type.md }}>{prompt.text}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[1] }}>
        <Text style={{ color: failed ? colors.error : colors.textSecondary, fontSize: type.xs }}>
          {t(`chat.queued.${prompt.state}`)}
        </Text>
        {failed ? (
          <Pressable testID={`chat-queued.retry.${prompt.id}`} accessibilityRole="button" hitSlop={8} onPress={() => onRetry(prompt.id)}>
            <Text style={{ color: colors.primary, fontSize: type.xs, fontWeight: '600' }}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}
        {prompt.state !== 'sending' ? (
          <Pressable testID={`chat-queued.cancel.${prompt.id}`} accessibilityRole="button" hitSlop={8} onPress={() => onCancel(prompt.id)}>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, fontWeight: '600' }}>{t('common.cancel')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ChatTimelineList({
  messages,
  pendingPermissions,
  queuedPrompts,
  pendingElicitations,
  agentName,
  isRunning,
  headerHeight,
  empty,
  onLongPress,
  onResolvePermission,
  onResolveElicitation = NOOP_RESOLVE_ELICITATION,
  onCancelQueued,
  onRetryQueued,
}: ChatTimelineListProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const listRef = useRef<FlashListRef<ListRow>>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(new Set());

  const [startKey, setStartKey] = useState<string | null>(null);
  const knownKeys = useRef<Set<string> | null>(null);
  const arrivedKeys = useRef(new Set<string>());

  const timeline = useMemo(
    () => buildTimeline(messages, pendingPermissions, queuedPrompts, pendingElicitations),
    [messages, pendingPermissions, queuedPrompts, pendingElicitations],
  );
  const { rows: items, start: windowStart } = useMemo(
    () => windowTimeline(timeline, startKey),
    [timeline, startKey],
  );

  if (knownKeys.current === null) {
    if (items.length > 0) knownKeys.current = new Set(items.map((item) => item.key));
  } else {
    for (const item of items) {
      if (!knownKeys.current.has(item.key)) {
        knownKeys.current.add(item.key);
        arrivedKeys.current.add(item.key);
      }
    }
  }

  const loadEarlier = useCallback(() => {
    const next = earlierStartKey(timeline, windowStart, HISTORY_PAGE);
    if (next === null) return;
    const nextIndex = timeline.findIndex((item) => item.key === next);
    for (let index = nextIndex; index < windowStart; index += 1) knownKeys.current?.add(timeline[index].key);
    setStartKey(next);
  }, [timeline, windowStart]);

  const getItemType = useCallback(
    (item: ListRow) => (arrivedKeys.current.has(item.key) ? `${item.kind}+arrival` : item.kind),
    [],
  );
  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id;
  const lastIsUser = lastMessage?.role === 'user';
  const needsIndex = items.findIndex((item) => item.kind === 'needs' || item.kind === 'elicitation');
  const needsOffscreen = needsIndex !== -1 && !visibleKeys.has(items[needsIndex].key);

  // Sending always jumps to the new user message, even when the user had scrolled up.
  useEffect(() => {
    if (!lastIsUser) return;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [lastId, lastIsUser]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const away = distance > JUMP_PILL_DISTANCE;
    setAwayFromBottom((previous) => (previous === away ? previous : away));
  }, []);

  const handleViewableChange = useCallback(({ viewableItems }: { viewableItems: ViewToken<ListRow>[] }) => {
    setVisibleKeys(new Set(viewableItems.flatMap((token) => (token.item ? [token.item.key] : []))));
  }, []);

  const renderItem = useCallback<ListRenderItem<ListRow>>(
    ({ item }) => {
      const row = (() => {
        switch (item.kind) {
          case 'time':
            return <TimeDivider timestamp={item.timestamp} />;
          case 'user':
          case 'reply':
            return (
              <ChatMessageBubble
                message={item.message}
                isStreaming={isRunning && item.message.id === lastId}
                onLongPress={onLongPress}
              />
            );
          case 'thought':
            return (
              <ThoughtBlock
                messageId={item.message.id}
                text={item.message.content}
                isStreaming={isRunning && item.message.id === lastId}
              />
            );
          case 'plan':
            return item.message.plan ? <PlanCard entries={item.message.plan} /> : null;
          case 'notice':
            return <SystemNote content={item.message.content} />;
          case 'work':
            return (
              <WorkLine
                groupKey={item.key}
                messages={item.messages}
                isStreaming={isRunning && item.messages[item.messages.length - 1].id === lastId}
              />
            );
          case 'needs':
            return <PermissionCard request={item.request} onResolve={onResolvePermission} />;
          case 'elicitation':
            return <ElicitationCard request={item.request} agentName={agentName} onResolve={onResolveElicitation} />;
          case 'earlier':
            return (
              <Pressable
                testID="chat.button.load-earlier"
                accessibilityRole="button"
                onPress={loadEarlier}
                style={{
                  alignSelf: 'center',
                  paddingHorizontal: spacing[3],
                  paddingVertical: spacing[2],
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.accent, fontSize: type.sm, fontWeight: '600' }}>
                  {t('chat.loadEarlier', { count: item.hidden })}
                </Text>
              </Pressable>
            );
          case 'queued':
            return <QueuedRow prompt={item.prompt} onCancel={onCancelQueued} onRetry={onRetryQueued} />;
        }
      })();
      const padded = <View style={{ paddingVertical: ROW_GAP / 2 }}>{row}</View>;
      return arrivedKeys.current.has(item.key) ? <RowArrival>{padded}</RowArrival> : padded;
    },
    [
      isRunning,
      lastId,
      agentName,
      loadEarlier,
      colors.accent,
      colors.border,
      spacing,
      type.sm,
      t,
      onLongPress,
      onResolvePermission,
      onResolveElicitation,
      onCancelQueued,
      onRetryQueued,
    ],
  );

  if (items.length === 0) {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingTop: headerHeight }}
      >
        {empty}
      </ScrollView>
    );
  }

  const pillStyle = {
    position: 'absolute' as const,
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  };

  return (
    <View style={{ flex: 1 }}>
      <FlashList
        ref={listRef}
        data={items}
        extraData={isRunning}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        maintainVisibleContentPosition={{
          autoscrollToBottomThreshold: AUTOSCROLL_THRESHOLD,
          startRenderingFromBottom: true,
        }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onViewableItemsChanged={handleViewableChange}
        viewabilityConfig={VIEWABILITY}
        contentContainerStyle={{
          paddingTop: headerHeight + spacing[2],
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[4],
        }}
      />
      {needsOffscreen ? (
        <Pressable
          testID="chat.button.jump-to-needs"
          accessibilityRole="button"
          accessibilityLabel={t('chat.jumpToNeeds')}
          onPress={() => listRef.current?.scrollToIndex({ index: needsIndex, animated: true })}
          style={{ ...pillStyle, top: headerHeight + spacing[2], borderColor: colors.warning }}
        >
          <Ionicons name="hand-left-outline" size={14} color={colors.warning} />
          <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>{t('chat.jumpToNeeds')}</Text>
        </Pressable>
      ) : null}
      {awayFromBottom ? (
        <Pressable
          testID="chat.button.jump-to-latest"
          accessibilityRole="button"
          accessibilityLabel={t('chat.jumpToLatest')}
          onPress={() => listRef.current?.scrollToEnd({ animated: true })}
          style={{ ...pillStyle, bottom: spacing[3], borderColor: colors.border }}
        >
          <Ionicons name="arrow-down" size={14} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>{t('chat.jumpToLatest')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
