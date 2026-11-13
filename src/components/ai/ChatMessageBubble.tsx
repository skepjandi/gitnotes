import React, { Fragment, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';
import { useTokens, useTheme } from '../../contexts/ThemeContext';
import type { ChatMessage, ImageAttachment } from '../../models/Chat';
import { parseThoughtContent } from '../../utils/chatThoughts';
import { ImageViewerModal } from '../chat/composer/ImageViewerModal';
import { PlanCard } from '../chat/PlanCard';
import { ThoughtBlock } from '../chat/ThoughtBlock';
import { ToolCallCard } from '../chat/ToolCallCard';
import { resolveMessageKind } from '../chat/toolPresentation';

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onLongPress?: (message: ChatMessage) => void;
}

export function SystemNote({ content }: { content: string }) {
  const { colors, type } = useTokens();
  return (
    <View testID="chat-notice" style={{ alignItems: 'center', paddingHorizontal: 24 }}>
      <Text style={{ color: colors.textSecondary, fontSize: type.sm, textAlign: 'center' }}>{content}</Text>
    </View>
  );
}

export function TypingDots() {
  const { colors, type } = useTokens();
  return (
    <View testID="chat-typing" className="self-start flex-row items-center" style={{ height: type.md * 1.4 }}>
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

const USER_BUBBLE_RADIUS = 18;
const IMAGE_SIZE = 96;
const MONOSPACE = Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined });

/** A user message that is a slash command (`/compact`, `/review src`) reads as a command chip, not prose. */
export function isCommandEcho(content: string): boolean {
  return /^\/[^\s/]/.test(content) && !content.includes('\n');
}

function TextRow({ message, isStreaming, onLongPress }: ChatMessageBubbleProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const colorScheme = useColorScheme();
  const [viewerImage, setViewerImage] = useState<ImageAttachment | null>(null);

  const isUser = message.role === 'user';
  const { thought: legacyThought, visible: visibleContent } = useMemo(
    () => parseThoughtContent(message.content),
    [message.content],
  );
  const markdownTheme = useMemo(
    () => ({
      colors: {
        text: colors.text,
        code: colors.text,
        link: colors.primary,
        border: colors.border,
        background: 'transparent' as const,
      },
    }),
    [colors.text, colors.primary, colors.border],
  );
  const codeBackground = isDark ? '#1c1c1e' : '#ececf0';
  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      paragraph: { backgroundColor: 'transparent', marginVertical: 0, paddingVertical: 2 },
      text: { color: colors.text, backgroundColor: 'transparent' },
      em: { color: colors.text },
      strong: { color: colors.text },
      li: { color: colors.text },
      codespan: { color: colors.text, backgroundColor: codeBackground },
      code: { backgroundColor: codeBackground, borderRadius: 10 },
      blockquote: { backgroundColor: 'transparent', borderLeftColor: colors.border },
    }),
    [colors.text, colors.border, codeBackground],
  );
  // react-native-marked's <Markdown> wraps output in a FlatList that captures
  // pan gestures even with `scrollEnabled: false`, which deadlocks the outer
  // list on iOS for long rows (see #748). Render via the `useMarkdown` hook
  // directly into a plain <View>: same tokens, no inner virtualized list.
  const markdownNodes = useMarkdown(isUser ? '' : (visibleContent ?? ''), {
    theme: markdownTheme,
    styles: markdownStyles,
    colorScheme,
    selectable: true,
  });

  if (!isUser && isStreaming && !message.content) return <TypingDots />;

  if (isUser) {
    const command = isCommandEcho(message.content);
    return (
      <Pressable
        testID="chat-message-bubble.button.long-press"
        style={{ alignSelf: 'flex-end', maxWidth: '85%' }}
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}
        delayLongPress={350}
        android_ripple={{ color: 'transparent' }}
      >
        {message.attachedImages && message.attachedImages.length > 0 ? (
          <View testID="chat-message-bubble.images" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing[1], marginBottom: spacing[1] }}>
            {message.attachedImages.map((image) => (
              <Pressable
                key={image.id}
                testID={`chat-message-bubble.image.${image.id}`}
                accessibilityRole="imagebutton"
                accessibilityLabel={image.name}
                onPress={() => setViewerImage(image)}
              >
                <Image
                  source={{ uri: image.uri }}
                  contentFit="cover"
                  style={{ width: IMAGE_SIZE, height: IMAGE_SIZE, borderRadius: 12, backgroundColor: colors.border }}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        <View
          testID={command ? 'chat-message-bubble.command' : undefined}
          style={{
            alignSelf: 'flex-end',
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: command ? 999 : USER_BUBBLE_RADIUS,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <Text
            selectable
            style={{
              color: colors.text,
              fontSize: type.md,
              lineHeight: type.md * 1.4,
              fontFamily: command ? MONOSPACE : undefined,
            }}
          >
            {message.content}
          </Text>
        </View>
        {message.attachedContexts && message.attachedContexts.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: spacing[1], gap: spacing[1] }}>
            {message.attachedContexts.map((ctx, idx) => (
              <View
                key={`${ctx.type}-${ctx.path}-${idx}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: spacing[2],
                  paddingVertical: 2,
                  borderRadius: 999,
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
        ) : null}
        {viewerImage ? <ImageViewerModal image={viewerImage} onClose={() => setViewerImage(null)} /> : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      testID="chat-message-bubble.button.long-press"
      style={{ alignSelf: 'stretch' }}
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      delayLongPress={350}
      android_ripple={{ color: 'transparent' }}
    >
      <View style={{ width: '100%' }}>
        {legacyThought ? <ThoughtBlock messageId={message.id} text={legacyThought} /> : null}
        {markdownNodes.map((node, idx) => (
          <Fragment key={idx}>{node}</Fragment>
        ))}
      </View>
    </Pressable>
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
      return <TextRow message={message} isStreaming={isStreaming} onLongPress={onLongPress} />;
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
    && a.attachedImages === b.attachedImages
  );
}

export const ChatMessageBubble = React.memo(ChatMessageBubbleImpl, areBubblePropsEqual);
