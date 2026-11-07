import React, { Fragment, useMemo } from 'react';
import { View, Text, Pressable, useColorScheme } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';
import { useTokens, useTheme } from '../../contexts/ThemeContext';
import type { ChatMessage } from '../../models/Chat';
import { parseThoughtContent } from '../../utils/chatThoughts';
import { PlanCard } from '../chat/PlanCard';
import { ThoughtBlock } from '../chat/ThoughtBlock';
import { ToolCallCard } from '../chat/ToolCallCard';
import { resolveMessageKind } from '../chat/toolPresentation';

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onLongPress?: (message: ChatMessage) => void;
}

function SystemNote({ content }: { content: string }) {
  return (
    <View className="items-center my-2">
      <Text className="italic text-sm" style={{ color: '#888' }}>
        {content}
      </Text>
    </View>
  );
}

export function TypingDots() {
  const { colors, type } = useTokens();
  return (
    <View className="self-start flex-row items-center px-2 my-1" style={{ height: type.md * 1.4 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          className="rounded-full opacity-70"
          style={{
            width: 6,
            height: 6,
            backgroundColor: colors.textSecondary,
            marginRight: i < 2 ? 4 : 0,
          }}
        />
      ))}
    </View>
  );
}

function TextBubble({ message, isStreaming, onLongPress }: ChatMessageBubbleProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const colorScheme = useColorScheme();

  // formatDistanceToNow throws RangeError on a missing/NaN timestamp; never let a
  // persisted message with an invalid timestamp crash the whole chat render.
  const timestamp = Number.isFinite(message.timestamp)
    ? formatDistanceToNow(message.timestamp, { addSuffix: true })
    : '';

  const isUser = message.role === 'user';
  const textColor = isUser ? '#ffffff' : colors.text;

  const { thought: legacyThought, visible: visibleContent } = useMemo(
    () => parseThoughtContent(message.content),
    [message.content],
  );
  const markdownTheme = useMemo(() => ({
    colors: {
      text: textColor,
      code: textColor,
      link: colors.primary,
      border: isDark ? '#444' : '#ddd',
      background: 'transparent' as const,
    },
  }), [textColor, colors.primary, isDark]);
  const markdownStyles = useMemo<MarkedStyles>(() => ({
    paragraph: { backgroundColor: 'transparent', marginVertical: 0, paddingVertical: 0 },
    text: { color: textColor, backgroundColor: 'transparent' },
    em: { color: textColor },
    strong: { color: textColor },
    li: { color: textColor },
    codespan: { color: textColor, backgroundColor: isDark ? '#1c1c1e' : '#e8e8e8' },
    code: { backgroundColor: isDark ? '#1c1c1e' : '#e8e8e8' },
    blockquote: { backgroundColor: 'transparent', borderLeftColor: isDark ? '#444' : '#ddd' },
  }), [textColor, isDark]);
  // react-native-marked's <Markdown> wraps output in a FlatList that captures
  // pan gestures even with `scrollEnabled: false`, which deadlocks the outer
  // list on iOS for long bubbles (see #748). Render via the `useMarkdown` hook
  // directly into a plain <View> instead: same tokens, no inner virtualized list.
  const markdownNodes = useMarkdown((!isUser ? visibleContent : message.content) ?? '', {
    theme: markdownTheme,
    styles: markdownStyles,
    colorScheme,
  });

  if (!isUser && isStreaming && !message.content) {
    return <TypingDots />;
  }

  return (
    <View testID="chat.message-bubble.button.long-press">
      <Pressable
        testID="chat-message-bubble.button.long-press"
        style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%', marginVertical: spacing[1] }}
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}
        delayLongPress={350}
        android_ripple={{ color: 'transparent' }}
      >
        <View
          style={{
            backgroundColor: isUser ? colors.primary : isDark ? '#2c2c2e' : '#f0f0f0',
            padding: spacing[3],
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: isUser ? 16 : 4,
            borderBottomRightRadius: isUser ? 4 : 16,
          }}
        >
          {isUser ? (
            <Text style={{ color: textColor, fontSize: type.md }}>{message.content}</Text>
          ) : (
            <View style={{ width: '100%' }}>
              {legacyThought ? <ThoughtBlock messageId={message.id} text={legacyThought} /> : null}
              {markdownNodes.map((node, idx) => (
                <Fragment key={idx}>{node}</Fragment>
              ))}
            </View>
          )}
        </View>
        {isUser && message.attachedContexts && message.attachedContexts.length > 0 && (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              marginTop: spacing[1],
              gap: spacing[1],
            }}
          >
            {message.attachedContexts.map((ctx, idx) => (
              <View
                key={`${ctx.type}-${ctx.path}-${idx}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isDark ? '#2c2c2e' : '#e8e8e8',
                  paddingHorizontal: spacing[2],
                  paddingVertical: 2,
                  borderRadius: 10,
                }}
              >
                <Ionicons
                  name={
                    ctx.type === 'file' || ctx.type === 'local-notes' ? 'document-text-outline'
                    : ctx.type === 'repo' ? 'git-branch-outline'
                    : ctx.type === 'local-todos' ? 'checkbox-outline'
                    : 'folder-outline'
                  }
                  size={11}
                  color={colors.textSecondary}
                  style={{ marginRight: 3 }}
                />
                <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
                  {ctx.name}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 10,
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            marginTop: spacing[1],
          }}
        >
          {timestamp}
        </Text>
      </Pressable>
    </View>
  );
}

function ChatMessageBubbleImpl({ message, isStreaming, onLongPress }: ChatMessageBubbleProps) {
  if (message.role === 'system') return <SystemNote content={message.content} />;

  switch (resolveMessageKind(message)) {
    case 'thought':
      return <ThoughtBlock messageId={message.id} text={message.content} isStreaming={isStreaming} />;
    case 'tool':
      return <ToolCallCard message={message} isStreaming={isStreaming} />;
    case 'plan':
      return message.plan ? <PlanCard entries={message.plan} /> : null;
    case 'text':
      return <TextBubble message={message} isStreaming={isStreaming} onLongPress={onLongPress} />;
  }
}

/**
 * Rows re-render only when something they display changed. The reducer replaces just the message
 * a delta touched, so array/object fields are compared by reference.
 */
export function areBubblePropsEqual(prev: ChatMessageBubbleProps, next: ChatMessageBubbleProps): boolean {
  if (prev.isStreaming !== next.isStreaming || prev.onLongPress !== next.onLongPress) return false;
  const a = prev.message;
  const b = next.message;
  if (a === b) return true;
  return (
    a.id === b.id
    && a.role === b.role
    && a.kind === b.kind
    && a.content === b.content
    && a.timestamp === b.timestamp
    && a.toolCallId === b.toolCallId
    && a.toolCallName === b.toolCallName
    && a.toolCallResult === b.toolCallResult
    && a.toolCallArgs === b.toolCallArgs
    && a.toolTitle === b.toolTitle
    && a.toolKind === b.toolKind
    && a.toolStatus === b.toolStatus
    && a.toolDiffs === b.toolDiffs
    && a.toolLocations === b.toolLocations
    && a.plan === b.plan
    && a.attachedContexts === b.attachedContexts
  );
}

export const ChatMessageBubble = React.memo(ChatMessageBubbleImpl, areBubblePropsEqual);
