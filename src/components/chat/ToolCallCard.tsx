import React, { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { useTheme, useTokens } from '../../contexts/ThemeContext';
import type { ChatMessage, ToolStatus } from '../../models/Chat';
import type { RootStackParamList } from '../../navigation/types';
import { ToolDiffView } from './ToolDiffView';
import {
  NOTE_TOOL_NAMES,
  TOOL_STATUS_LABEL_KEYS,
  formatToolCallLabel,
  parseNoteToolResult,
  resolveToolStatus,
  stringifyArgs,
  TOOL_KIND_ICONS,
  TOOL_STATUS_ICONS,
  truncateText,
  type NoteToolResult,
} from './toolPresentation';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export interface ToolCallCardProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function NoteResultChip({ result }: { result: NoteToolResult }) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Pressable
      testID="chat-message-bubble.tool-result.note-link"
      accessibilityRole="link"
      onPress={() => navigation.navigate('NoteEditor', { noteId: result.noteId })}
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
        {result.title ?? t('chat.toolDetails.openNote')}
      </Text>
    </Pressable>
  );
}

interface MonoBlockProps {
  testID: string;
  label: string;
  text: string;
  resetKey: string;
}

function MonoBlock({ testID, label, text, resetKey }: MonoBlockProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [showAll, setShowAll] = useRecyclingState(false, [resetKey]);
  const view = useMemo(() => (showAll ? { text, hiddenChars: 0 } : truncateText(text)), [showAll, text]);

  return (
    <View style={{ marginTop: spacing[2] }}>
      <Text style={{ color: colors.textSecondary, fontSize: type.xs, fontWeight: '600', marginBottom: spacing[1] }}>
        {label}
      </Text>
      <View style={{ borderRadius: 8, padding: spacing[2], backgroundColor: 'rgba(0,0,0,0.05)' }}>
        <Text testID={testID} selectable style={{ color: colors.text, fontSize: type.xs, lineHeight: 16, fontFamily: MONO }}>
          {view.text}
        </Text>
        {view.hiddenChars > 0 ? (
          <Pressable
            testID={`${testID}.show-all`}
            accessibilityRole="button"
            onPress={() => setShowAll(true)}
            hitSlop={8}
            style={{ marginTop: spacing[1] }}
          >
            <Text style={{ color: colors.primary, fontSize: type.xs, fontWeight: '600' }}>
              {t('chat.toolDetails.showAll', { count: view.hiddenChars })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function StatusBadge({ status }: { status: ToolStatus }) {
  const { colors, type } = useTokens();
  const { t } = useTranslation();
  const tint =
    status === 'completed' ? colors.success
    : status === 'failed' ? colors.error
    : status === 'awaiting-approval' ? colors.warning
    : status === 'running' ? colors.primary
    : colors.textSecondary;

  return (
    <View testID={`chat-tool.status.${status}`} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
      {status === 'running' ? (
        <ActivityIndicator size="small" color={tint} style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <Ionicons name={TOOL_STATUS_ICONS[status]} size={14} color={tint} />
      )}
      <Text style={{ color: tint, fontSize: type.xs, fontWeight: '600', marginLeft: 3 }} numberOfLines={1}>
        {t(TOOL_STATUS_LABEL_KEYS[status])}
      </Text>
    </View>
  );
}

function ToolCallCardImpl({ message, isStreaming }: ToolCallCardProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [message.id]);

  const status = resolveToolStatus(message, isStreaming);
  const title = message.toolTitle?.trim() || formatToolCallLabel(message.toolCallName);
  const argsText = useMemo(() => stringifyArgs(message.toolCallArgs), [message.toolCallArgs]);
  const noteResult = useMemo(
    () =>
      message.toolCallName && NOTE_TOOL_NAMES.includes(message.toolCallName)
        ? parseNoteToolResult(message.toolCallResult)
        : null,
    [message.toolCallName, message.toolCallResult],
  );
  const result = message.toolCallResult;
  const diffs = message.toolDiffs;
  const locations = message.toolLocations;
  const hasDetails = Boolean(argsText || result || noteResult || diffs?.length || locations?.length);

  return (
    <View
      testID="chat-tool.card"
      style={{
        alignSelf: 'flex-start',
        width: '92%',
        marginVertical: spacing[1],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: expanded ? (isDark ? '#4a4a4f' : '#d8dbe5') : colors.border,
        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.04)',
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID="chat-tool.button.toggle"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${t(TOOL_STATUS_LABEL_KEYS[status])}`}
        accessibilityState={{ expanded, disabled: !hasDetails }}
        onPress={hasDetails ? () => setExpanded((current) => !current) : undefined}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 44,
          paddingHorizontal: spacing[3],
          gap: spacing[2],
        }}
      >
        <Ionicons name={TOOL_KIND_ICONS[message.toolKind ?? 'other']} size={16} color={colors.primary} />
        <Text
          testID="chat-tool.title"
          style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: type.sm, fontWeight: '600' }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {title}
        </Text>
        <StatusBadge status={status} />
        {hasDetails ? (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
        ) : null}
      </Pressable>
      {expanded && hasDetails ? (
        <View
          style={{
            paddingHorizontal: spacing[3],
            paddingTop: spacing[1],
            paddingBottom: spacing[3],
            borderTopWidth: 1,
            borderTopColor: isDark ? '#3a3a3f' : '#e5e7eb',
          }}
        >
          {locations && locations.length > 0 ? (
            <View testID="chat-tool.locations" style={{ marginTop: spacing[2], gap: 2 }}>
              {locations.map((location, index) => (
                <View key={`${location.path}-${index}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="location-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                  <Text
                    style={{ flex: 1, color: colors.textSecondary, fontSize: type.xs, fontFamily: MONO }}
                    numberOfLines={1}
                    ellipsizeMode="head"
                  >
                    {location.line != null ? `${location.path}:${location.line}` : location.path}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {argsText ? (
            <MonoBlock testID="chat-tool.args" label={t('chat.toolDetails.arguments')} text={argsText} resetKey={message.id} />
          ) : null}
          {diffs && diffs.length > 0 ? (
            <View style={{ marginTop: spacing[2] }}>
              <ToolDiffView diffs={diffs} />
            </View>
          ) : null}
          {noteResult ? (
            <View style={{ marginTop: spacing[2] }}>
              <NoteResultChip result={noteResult} />
            </View>
          ) : result ? (
            <MonoBlock testID="chat-tool.result" label={t('chat.toolDetails.result')} text={result} resetKey={message.id} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const ToolCallCard = React.memo(ToolCallCardImpl);
