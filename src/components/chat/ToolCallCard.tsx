import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import Animated from 'react-native-reanimated';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatMessage, ToolStatus } from '../../models/Chat';
import type { RootStackParamList } from '../../navigation/types';
import { HapticService } from '../../utils/haptics';
import { CARD_RADIUS, CHAT_TYPE, CONTINUOUS_CORNERS, HAIRLINE, MONO_FONT as MONO } from './chatStyle';
import { useChatTransitions } from './motion/transitions';
import { ToolDiffView } from './ToolDiffView';
import {
  NOTE_TOOL_NAMES,
  TOOL_STATUS_LABEL_KEYS,
  describeToolStep,
  parseNoteToolResult,
  resolveToolStatus,
  stringifyArgs,
  TOOL_KIND_ICONS,
  TOOL_STATUS_ICONS,
  truncateText,
  type NoteToolResult,
} from './toolPresentation';

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
        backgroundColor: pressed ? `${colors.shadow}14` : `${colors.shadow}0D`,
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
      <View style={{ borderRadius: 8, padding: spacing[2], backgroundColor: `${colors.shadow}0D` }}>
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
  const { colors } = useTokens();
  const { t } = useTranslation();
  const tint =
    status === 'completed' ? colors.textSecondary
    : status === 'failed' ? colors.error
    : status === 'awaiting-approval' ? colors.warning
    : status === 'running' ? colors.primary
    : colors.textSecondary;

  return (
    <View
      testID={`chat-tool.status.${status}`}
      accessible
      accessibilityLabel={t(TOOL_STATUS_LABEL_KEYS[status])}
      style={{ flexShrink: 0 }}
    >
      {status === 'running' ? (
        <ActivityIndicator size="small" color={tint} style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <Ionicons name={TOOL_STATUS_ICONS[status]} size={14} color={tint} />
      )}
    </View>
  );
}

function ToolCallCardImpl({ message, isStreaming }: ToolCallCardProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const { entering, exiting, layout } = useChatTransitions();
  const [expanded, setExpanded] = useRecyclingState(false, [message.id]);

  const status = resolveToolStatus(message, isStreaming);
  const step = useMemo(() => describeToolStep(message), [message]);
  const verbLabel = step.verb ? t(`chat.step.${step.verb}`) : null;
  const title = verbLabel ? `${verbLabel} ${step.detail}` : step.detail;
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

  const toggle = () => {
    void HapticService.selection();
    setExpanded((current) => !current);
  };

  return (
    <Animated.View
      layout={layout}
      testID="chat-tool.card"
      style={{
        alignSelf: 'flex-start',
        width: '92%',
        marginVertical: 2,
        borderRadius: CARD_RADIUS,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        ...CONTINUOUS_CORNERS,
      }}
    >
      <Pressable
        testID="chat-tool.button.toggle"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${t(TOOL_STATUS_LABEL_KEYS[status])}`}
        accessibilityState={{ expanded, disabled: !hasDetails }}
        onPress={hasDetails ? toggle : undefined}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 40,
          paddingHorizontal: spacing[3],
          gap: spacing[2],
        }}
      >
        <Ionicons name={TOOL_KIND_ICONS[message.toolKind ?? 'other']} size={15} color={colors.textSecondary} />
        {verbLabel ? (
          <Text style={{ ...CHAT_TYPE.status, color: colors.textSecondary, fontWeight: '600', flexShrink: 0 }}>
            {verbLabel}
          </Text>
        ) : null}
        <Text
          testID="chat-tool.title"
          style={{
            flex: 1,
            minWidth: 0,
            color: verbLabel ? colors.text : colors.textSecondary,
            ...CHAT_TYPE.status,
            fontFamily: step.monospace ? MONO : undefined,
          }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {step.detail}
        </Text>
        <StatusBadge status={status} />
        {hasDetails ? (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textSecondary} />
        ) : null}
      </Pressable>
      {expanded && hasDetails ? (
        <Animated.View
          entering={entering}
          exiting={exiting}
          style={{
            paddingHorizontal: spacing[3],
            paddingTop: spacing[1],
            paddingBottom: spacing[3],
            borderTopWidth: HAIRLINE,
            borderTopColor: colors.border,
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
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export const ToolCallCard = React.memo(ToolCallCardImpl);
