import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatMessage } from '../../models/Chat';
import { HapticService } from '../../utils/haptics';
import { CHAT_TYPE } from './chatStyle';
import { useChatTransitions } from './motion/transitions';
import { ToolCallCard } from './ToolCallCard';
import { summarizeWork, workStatus, type WorkStatus } from './timeline';

export interface WorkLineProps {
  /** Stable across growth of the group; resets the expanded state when the list recycles the cell. */
  groupKey: string;
  messages: ChatMessage[];
  /** The turn is still running and this group is the one being written. */
  isStreaming: boolean;
}

function StatusGlyph({ status }: { status: WorkStatus }) {
  const { colors } = useTokens();
  if (status === 'running') return <ActivityIndicator size="small" color={colors.textSecondary} style={{ transform: [{ scale: 0.7 }] }} />;
  if (status === 'awaiting-approval') return <Ionicons name="hand-left-outline" size={14} color={colors.warning} />;
  if (status === 'failed') return <Ionicons name="alert-circle" size={14} color={colors.error} />;
  return <Ionicons name="checkmark" size={14} color={colors.textSecondary} />;
}

function WorkLineImpl({ groupKey, messages, isStreaming }: WorkLineProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const { entering, exiting, layout } = useChatTransitions();
  const [expanded, setExpanded] = useRecyclingState(false, [groupKey]);

  const status = workStatus(messages, isStreaming);
  const summary = useMemo(
    () =>
      summarizeWork(messages)
        .map(({ counter, count }) => t(`chat.work.${counter}`, { count }))
        .join(' · '),
    [messages, t],
  );
  const lead = status === 'running' || status === 'awaiting-approval' ? t('chat.work.working') : t('chat.work.worked');

  return (
    <Animated.View layout={layout} testID="chat-work" style={{ alignSelf: 'stretch' }}>
      <Pressable
        testID="chat-work.button.toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${lead}: ${summary}`}
        onPress={() => {
          void HapticService.selection();
          setExpanded((current) => !current);
        }}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: 32 }}
      >
        <StatusGlyph status={status} />
        <Animated.View key={`${lead}|${summary}`} entering={entering} style={{ flexShrink: 1 }}>
          <Text style={{ ...CHAT_TYPE.status, color: colors.textSecondary }} numberOfLines={1}>
            <Text style={{ fontWeight: '600' }}>{lead}</Text>
            {summary ? ` · ${summary}` : ''}
          </Text>
        </Animated.View>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textSecondary} />
      </Pressable>
      {expanded ? (
        <Animated.View entering={entering} exiting={exiting} testID="chat-work.steps" style={{ marginTop: spacing[1], gap: spacing[1] }}>
          {messages.map((message, index) => (
            <ToolCallCard
              key={message.id}
              message={message}
              isStreaming={isStreaming && index === messages.length - 1}
            />
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export const WorkLine = React.memo(WorkLineImpl);
