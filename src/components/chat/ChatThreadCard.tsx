import { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ChatThreadSummary } from '../../models/Chat';
import { useTokens } from '../../contexts/ThemeContext';
import { Surface } from '../ui/Surface';

interface ChatThreadCardProps {
  thread: ChatThreadSummary;
  onPress: () => void;
  onLongPress: () => void;
}

function ChatThreadCardImpl({ thread, onPress, onLongPress }: ChatThreadCardProps) {
  const { colors } = useTokens();
  const { t } = useTranslation();
  const isAgent = thread.backend === 'agent';

  // formatDistanceToNow throws RangeError on a missing/NaN timestamp; never let a
  // persisted thread summary with an invalid updatedAt crash the whole chat render.
  const timeAgo = Number.isFinite(thread.updatedAt)
    ? formatDistanceToNow(thread.updatedAt, { addSuffix: true })
    : '';

  return (
    <TouchableOpacity
      testID={`chat-thread-card.${thread.id}`}
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Surface elevation="raised" radius="md" className="p-3">
        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <Ionicons
              name={isAgent ? 'terminal-outline' : 'chatbubble-outline'}
              size={18}
              color={colors.primary}
              className="mr-2"
            />
            <Text
              className="flex-1 font-semibold text-md text-text"
              numberOfLines={1}
            >
              {thread.title}
            </Text>
            {isAgent && thread.agentName ? (
              <View
                testID="chat-thread-card.agent-badge"
                className="rounded-sm px-2 py-0.5 ml-2"
                style={{ backgroundColor: colors.accent + '20' }}
              >
                <Text className="text-xs font-semibold text-accent" numberOfLines={1}>
                  {thread.agentName}
                </Text>
              </View>
            ) : null}
          </View>

          {thread.preview && (
            <Text
              className="mb-2 text-sm text-text-secondary"
              style={{ lineHeight: 18 }}
              numberOfLines={2}
            >
              {thread.preview}
            </Text>
          )}

          <View className="flex-row justify-between items-center">
            <Text className="text-xs text-text-secondary">
              {timeAgo}
            </Text>
            <Text className="text-xs font-semibold text-primary">
              {t('chat.messageCount', { count: thread.messageCount })}
            </Text>
          </View>
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

export const ChatThreadCard = memo(ChatThreadCardImpl);

export default ChatThreadCard;
