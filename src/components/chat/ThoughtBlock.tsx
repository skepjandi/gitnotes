import React from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { HapticService } from '../../utils/haptics';
import { CARD_RADIUS, CHAT_TYPE, CONTINUOUS_CORNERS, HAIRLINE } from './chatStyle';
import { useChatTransitions } from './motion/transitions';

export interface ThoughtBlockProps {
  /** Resets the expanded state when the list recycles this cell for another message. */
  messageId: string;
  text: string;
  isStreaming?: boolean;
}

function ThoughtBlockImpl({ messageId, text, isStreaming }: ThoughtBlockProps) {
  const { colors, spacing } = useTokens();
  const { entering, exiting, layout } = useChatTransitions();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [messageId]);

  return (
    <Animated.View
      layout={layout}
      testID="chat-thought.block"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        marginVertical: spacing[1],
        borderRadius: CARD_RADIUS,
        borderWidth: expanded ? HAIRLINE : 0,
        borderColor: colors.border,
        backgroundColor: expanded ? colors.surface : 'transparent',
        overflow: 'hidden',
        ...CONTINUOUS_CORNERS,
      }}
    >
      <Pressable
        testID="chat-thought.button.toggle"
        accessibilityRole="button"
        accessibilityLabel={t('chat.thoughtTitle')}
        accessibilityState={{ expanded }}
        onPress={() => {
          void HapticService.selection();
          setExpanded((current) => !current);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 36,
          paddingHorizontal: expanded ? spacing[3] : spacing[1],
        }}
      >
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textSecondary} />
        <Ionicons
          name="bulb-outline"
          size={14}
          color={colors.textSecondary}
          style={{ marginLeft: spacing[1], marginRight: spacing[1] }}
        />
        <Text
          style={{ ...CHAT_TYPE.status, color: colors.textSecondary, fontWeight: '600' }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {t('chat.thoughtTitle')}
        </Text>
        {isStreaming ? (
          <Text style={{ ...CHAT_TYPE.status, color: colors.textSecondary, marginLeft: spacing[1] }}>…</Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <Animated.View
          entering={entering}
          exiting={exiting}
          style={{
            paddingHorizontal: spacing[3],
            paddingBottom: spacing[3],
            borderTopWidth: HAIRLINE,
            borderTopColor: colors.border,
            paddingTop: spacing[2],
          }}
        >
          <Text testID="chat-thought.text" selectable style={{ ...CHAT_TYPE.status, color: colors.textSecondary, lineHeight: 20 }}>
            {text}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export const ThoughtBlock = React.memo(ThoughtBlockImpl);
