import { memo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ChatThreadSummary } from '../../models/Chat';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatRunStatus } from '../../services/chat/types';

interface ChatThreadCardProps {
  thread: ChatThreadSummary;
  status?: ChatRunStatus;
  onPress: () => void;
  onLongPress: () => void;
}

function ChatThreadCardImpl({ thread, status = 'idle', onPress, onLongPress }: ChatThreadCardProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const isAgent = thread.backend === 'agent';
  const isDemo = thread.backend === 'demo';

  // formatDistanceToNow throws RangeError on a missing/NaN timestamp; never let a
  // persisted thread summary with an invalid updatedAt crash the whole chat render.
  const timeAgo = Number.isFinite(thread.updatedAt)
    ? formatDistanceToNow(thread.updatedAt, { addSuffix: true })
    : '';

  const glyphName = isAgent ? 'terminal-outline' : isDemo ? 'sparkles-outline' : 'chatbubble-outline';
  const badgeLabel = isAgent ? thread.agentName : isDemo ? t('chat.demoBadge') : undefined;

  const renderGlyph = () => {
    if (status === 'running') {
      return <ActivityIndicator testID="chat-thread-card.running-indicator" size="small" color={colors.primary} />;
    }
    if (status === 'awaiting-permission') return <Ionicons name="alert-circle" size={20} color={colors.warning} />;
    if (status === 'error') return <Ionicons name="close-circle" size={20} color={colors.error} />;
    return <Ionicons name={glyphName} size={20} color={colors.textSecondary} />;
  };

  return (
    <TouchableOpacity
      testID={`chat-thread-card.${thread.id}`}
      activeOpacity={0.6}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{
        flexDirection: 'row',
        gap: spacing[3],
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[3],
        borderBottomWidth: 1,
        borderBottomColor: `${colors.border}80`,
      }}
    >
      <View style={{ width: 24, alignItems: 'center', paddingTop: 2 }}>{renderGlyph()}</View>
      <View style={{ flex: 1 }}>
        <View className="flex-row items-center">
          <Text className="flex-1 font-semibold text-md text-text" numberOfLines={1}>
            {thread.title}
          </Text>
          <Text className="ml-2 text-xs text-text-secondary">{timeAgo}</Text>
        </View>

        {thread.preview ? (
          <Text className="mt-0.5 text-sm text-text-secondary" numberOfLines={2}>
            {thread.preview}
          </Text>
        ) : null}

        <View className="flex-row items-center mt-1.5" style={{ gap: spacing[2] }}>
          {status === 'running' ? (
            <View testID="chat-thread-card.status-badge" className="rounded-sm px-2 py-0.5" style={{ backgroundColor: `${colors.primary}20` }}>
              <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                {t('chat.statusWorking')}
              </Text>
            </View>
          ) : null}
          {status === 'awaiting-permission' ? (
            <View testID="chat-thread-card.status-badge" className="rounded-sm px-2 py-0.5" style={{ backgroundColor: `${colors.warning}25` }}>
              <Text className="text-xs font-semibold" style={{ color: colors.warning }}>
                {t('chat.statusNeedsYou')}
              </Text>
            </View>
          ) : null}
          {status === 'error' ? (
            <View testID="chat-thread-card.status-badge" className="rounded-sm px-2 py-0.5" style={{ backgroundColor: `${colors.error}20` }}>
              <Text className="text-xs font-semibold" style={{ color: colors.error }}>
                {t('chat.statusError')}
              </Text>
            </View>
          ) : null}
          {badgeLabel ? (
            <View testID="chat-thread-card.agent-badge" className="rounded-sm px-2 py-0.5" style={{ backgroundColor: `${colors.accent}20` }}>
              <Text className="text-xs font-semibold text-accent" numberOfLines={1}>
                {badgeLabel}
              </Text>
            </View>
          ) : null}
          <Text className="text-xs text-text-secondary">{t('chat.messageCount', { count: thread.messageCount })}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export const ChatThreadCard = memo(ChatThreadCardImpl);

export default ChatThreadCard;
