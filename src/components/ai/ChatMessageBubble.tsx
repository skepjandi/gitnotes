import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { View, Text, Platform, Pressable, useColorScheme, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChatMessage } from '../../models/Chat';
import { useTokens, useTheme } from '../../contexts/ThemeContext';
import { formatDistanceToNow } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { Surface } from '../ui/Surface';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';
import type { ViewStyle } from 'react-native';
import type { RootStackParamList } from '../../navigation/types';
import { parseThoughtContent } from '../../utils/chatThoughts';

type NoteToolResult = { noteId: string; title?: string };
const COLLAPSIBLE_HEADER_HEIGHT = 44;

function parseNoteToolResult(raw: string | undefined): NoteToolResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.noteId === 'string') {
      return { noteId: parsed.noteId, title: typeof parsed.title === 'string' ? parsed.title : undefined };
    }
  } catch {
    return null;
  }
  return null;
}

function formatToolCallLabel(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'Tool call';
  const printable = [...trimmed]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .trim();
  if (!printable) return 'Tool call';
  const normalized = printable
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Tool call';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onLongPress?: (message: ChatMessage) => void;
}

function ChatMessageBubbleImpl({ message, isStreaming, onLongPress }: ChatMessageBubbleProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const colorScheme = useColorScheme();
  const { width: viewportWidth } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [thoughtExpanded, setThoughtExpanded] = useState(false);
  const [toolCallExpanded, setToolCallExpanded] = useState(false);

  useEffect(() => {
    setThoughtExpanded(false);
    setToolCallExpanded(false);
  }, [message.id]);

  // formatDistanceToNow throws RangeError on a missing/NaN timestamp; never let a
  // persisted message with an invalid timestamp crash the whole chat render.
  const timestamp = Number.isFinite(message.timestamp)
    ? formatDistanceToNow(message.timestamp, { addSuffix: true })
    : '';

  const isUser = message.role === 'user';
  const textColor = isUser ? '#ffffff' : colors.text;
  const toolCallLabel = formatToolCallLabel(message.toolCallName);
  const noteToolResult = useMemo(() => {
    if (!message.toolCallName) return null;
    if (!['create_note', 'edit_note', 'get_note'].includes(message.toolCallName)) return null;
    return parseNoteToolResult(message.toolCallResult);
  }, [message.toolCallName, message.toolCallResult]);
  const canExpandToolResult = Boolean(message.toolCallResult);

  const { thought: thoughtContent, visible: visibleContent } = useMemo(
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
  // ChatScreen FlatList on iOS for long bubbles (see #748). Render via the
  // `useMarkdown` hook directly into a plain <View> instead — same tokens,
  // no inner virtualized list. Hook must run unconditionally so it sits
  // above the early returns below.
  const markdownNodes = useMarkdown((!isUser ? visibleContent : message.content) ?? '', {
    theme: markdownTheme,
    styles: markdownStyles,
    colorScheme,
  });

  if (message.role === 'system') {
    return (
      <View className="items-center my-2">
        <Text className="italic text-sm" style={{ color: '#888' }}>
          {message.content}
        </Text>
      </View>
    );
  }

  const isStreamingPlaceholder = !isUser && isStreaming && !message.content && !message.toolCallName;

  if (isStreamingPlaceholder) {
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
  
  const containerStyle: ViewStyle = {
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
    marginVertical: spacing[1],
    ...(!isUser && message.toolCallName ? { minWidth: Math.min(220, viewportWidth * 0.5) } : null),
  };

  const surfaceBg = isDark ? '#2c2c2e' : '#f0f0f0';

  const bubbleStyle = message.toolCallName
    ? {
        padding: 0,
        backgroundColor: 'transparent',
      }
    : {
        backgroundColor: isUser ? colors.primary : surfaceBg,
        padding: spacing[3],
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
        borderBottomRightRadius: isUser ? 4 : 16,
      };

  return (
    <View testID="chat.message-bubble.button.long-press">
      <Pressable
        testID="chat-message-bubble.button.long-press"
      style={containerStyle}
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      delayLongPress={350}
      android_ripple={{ color: 'transparent' }}
    >
      <View style={bubbleStyle}>
        {message.toolCallName ? (
          <Pressable
            onPress={canExpandToolResult ? () => setToolCallExpanded((current) => !current) : undefined}
            style={{
              width: '100%',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: toolCallExpanded ? (isDark ? '#4a4a4f' : '#d8dbe5') : 'transparent',
              overflow: 'hidden',
              backgroundColor: toolCallExpanded ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.05)') : 'transparent',
              paddingHorizontal: spacing[3],
              paddingVertical: 0,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: COLLAPSIBLE_HEADER_HEIGHT }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: spacing[2] }}>
                <Ionicons
                  name={toolCallExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={colors.primary}
                />
                <Ionicons
                  name="build-outline"
                  size={14}
                  color={colors.primary}
                  style={{ marginLeft: spacing[1], marginRight: spacing[1], flexShrink: 0 }}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{ color: colors.primary, fontWeight: '700', fontSize: type.sm, lineHeight: 20 }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    allowFontScaling={false}
                  >
                    {toolCallLabel}
                  </Text>
                </View>
                {!message.toolCallResult && isStreaming && (
                  <View style={{ flexDirection: 'row', marginLeft: spacing[2], flexShrink: 0 }}>
                    {[0, 1, 2].map((i) => (
                      <View
                        key={i}
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: colors.primary,
                          opacity: 0.9,
                          marginRight: i < 2 ? 3 : 0,
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
              <View style={{ width: 52, alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0 }}>
                <Text
                  style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500', lineHeight: 16 }}
                  numberOfLines={1}
                  ellipsizeMode="clip"
                  allowFontScaling={false}
                >
                  {canExpandToolResult ? (toolCallExpanded ? 'Hide' : 'Show') : (isStreaming ? 'Running' : 'Pending')}
                </Text>
              </View>
            </View>
            {toolCallExpanded ? (
              <View
                style={{
                  paddingHorizontal: spacing[3],
                  paddingTop: spacing[2],
                  paddingBottom: spacing[3],
                  borderTopWidth: 1,
                  borderTopColor: isDark ? '#3a3a3f' : '#e5e7eb',
                }}
              >
                {noteToolResult ? (
                  <Pressable
                    testID="chat-message-bubble.tool-result.note-link"
                    onPress={() => navigation.navigate('NoteEditor', { noteId: noteToolResult.noteId })}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: spacing[2],
                      paddingVertical: spacing[1],
                      borderRadius: 8,
                      backgroundColor: pressed ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.05)',
                    })}
                  >
                    <Ionicons name="document-text-outline" size={16} color={colors.primary} style={{ marginRight: spacing[1] }} />
                    <Text style={{ color: colors.primary, fontSize: type.sm, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                      {noteToolResult.title ?? 'Open note'}
                    </Text>
                  </Pressable>
                ) : message.toolCallResult ? (
                  <Surface elevation="flat" style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: spacing[2], borderRadius: 8 }}>
                    <Text style={{ color: textColor, fontSize: type.sm, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }} numberOfLines={6}>
                      {message.toolCallResult}
                    </Text>
                  </Surface>
                ) : null}
              </View>
            ) : null}
          </Pressable>
        ) : isUser ? (
          <Text style={{ color: textColor, fontSize: type.md }}>
            {message.content}
          </Text>
        ) : (
          <View style={{ width: '100%' }}>
            {thoughtContent ? (
              thoughtExpanded ? (
                <View
                  style={{
                    marginBottom: spacing[2],
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isDark ? '#4a4a4f' : '#d8dbe5',
                    overflow: 'hidden',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.05)',
                  }}
                >
                  <Pressable
                    onPress={() => setThoughtExpanded(false)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: spacing[3],
                      paddingVertical: 0,
                      minHeight: COLLAPSIBLE_HEADER_HEIGHT,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, marginRight: spacing[2] }}>
                      <Ionicons
                        name="chevron-down"
                        size={14}
                        color={colors.primary}
                      />
                      <Text
                        style={{
                          marginLeft: spacing[1],
                          color: colors.primary,
                          fontSize: type.sm,
                          fontWeight: '700',
                          lineHeight: 20,
                        }}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        allowFontScaling={false}
                      >
                        Thought process
                      </Text>
                    </View>
                    <View style={{ width: 52, alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0 }}>
                      <Text
                        style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500', lineHeight: 16 }}
                        numberOfLines={1}
                        ellipsizeMode="clip"
                        allowFontScaling={false}
                      >
                        Hide
                      </Text>
                    </View>
                  </Pressable>
                  <View
                    style={{
                      paddingHorizontal: spacing[3],
                      paddingBottom: spacing[3],
                      borderTopWidth: 1,
                      borderTopColor: isDark ? '#3a3a3f' : '#e5e7eb',
                    }}
                  >
                    <Text style={{ color: textColor, fontSize: type.md }}>
                      {thoughtContent}
                    </Text>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setThoughtExpanded(true)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: spacing[1],
                  }}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={colors.primary}
                  />
                  <Text
                    style={{
                      marginLeft: spacing[1],
                      color: colors.primary,
                      fontSize: type.sm,
                      fontWeight: '700',
                      lineHeight: 20,
                    }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    allowFontScaling={false}
                  >
                    Thought process
                  </Text>
                  <Text
                    style={{ color: colors.textSecondary, fontSize: 11, marginLeft: spacing[2] }}
                  >
                    Show
                  </Text>
                </Pressable>
              )
            ) : null}
            {markdownNodes.map((node, idx) => (
              <Fragment key={idx}>{node}</Fragment>
            ))}
          </View>
        )}
      </View>
      {isUser && message.attachedContexts && message.attachedContexts.length > 0 && (
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          marginTop: spacing[1],
          gap: spacing[1],
        }}>
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
      <Text style={{
        color: colors.textSecondary,
        fontSize: 10,
        alignSelf: isUser ? 'flex-end' as const : 'flex-start' as const,
        marginTop: spacing[1]
      }}>
        {timestamp}
      </Text>
    </Pressable>
    </View>
  );
}

export const ChatMessageBubble = React.memo(ChatMessageBubbleImpl, (prev, next) => {
  if (prev.isStreaming !== next.isStreaming) return false;
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id
    && a.content === b.content
    && a.toolCallResult === b.toolCallResult
    && a.toolCallName === b.toolCallName
    && a.role === b.role
  );
});
