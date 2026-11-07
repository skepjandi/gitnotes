import React, { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatMessage } from '../../models/Chat';
import { ChatMessageBubble, TypingDots } from '../ai/ChatMessageBubble';
import { resolveMessageKind } from './toolPresentation';

/** Distance from the bottom beyond which the user counts as "reading history": no auto-follow, show the pill. */
const JUMP_PILL_DISTANCE = 160;
/** Fraction of the viewport within which new content keeps the list pinned to the bottom. */
const AUTOSCROLL_THRESHOLD = 0.2;

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /** A turn is in flight: the tail message is still being written. */
  isRunning: boolean;
  headerHeight: number;
  empty: ReactElement;
  onLongPress?: (message: ChatMessage) => void;
}

function keyExtractor(message: ChatMessage): string {
  return message.id;
}

function getItemType(message: ChatMessage): string {
  return `${message.role}:${resolveMessageKind(message)}`;
}

export function ChatMessageList({ messages, isRunning, headerHeight, empty, onLongPress }: ChatMessageListProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const listRef = useRef<FlashListRef<ChatMessage>>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id;
  const lastIsUser = lastMessage?.role === 'user';

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

  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item }) => {
      const legacyToolInFlight = Boolean(item.toolCallName) && !item.toolCallResult && !item.toolStatus;
      const streaming = isRunning && (item.id === lastId || legacyToolInFlight);
      return <ChatMessageBubble message={item} isStreaming={streaming} onLongPress={onLongPress} />;
    },
    [isRunning, lastId, onLongPress],
  );

  if (messages.length === 0) {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingTop: headerHeight }}
      >
        {empty}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlashList
        ref={listRef}
        data={messages}
        extraData={isRunning}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{
          autoscrollToBottomThreshold: AUTOSCROLL_THRESHOLD,
          startRenderingFromBottom: true,
        }}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        ListFooterComponent={isRunning && lastIsUser ? <TypingDots /> : null}
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[4],
        }}
      />
      {awayFromBottom ? (
        <Pressable
          testID="chat.button.jump-to-latest"
          accessibilityRole="button"
          accessibilityLabel={t('chat.jumpToLatest')}
          onPress={() => listRef.current?.scrollToEnd({ animated: true })}
          style={{
            position: 'absolute',
            alignSelf: 'center',
            bottom: spacing[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[1],
            paddingHorizontal: spacing[3],
            paddingVertical: spacing[2],
            borderRadius: 999,
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: colors.border,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Ionicons name="arrow-down" size={14} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{t('chat.jumpToLatest')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
