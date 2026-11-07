import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { useTheme, useTokens } from '../../contexts/ThemeContext';

export interface ThoughtBlockProps {
  /** Resets the expanded state when the list recycles this cell for another message. */
  messageId: string;
  text: string;
  isStreaming?: boolean;
}

function ThoughtBlockImpl({ messageId, text, isStreaming }: ThoughtBlockProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useRecyclingState(false, [messageId]);

  return (
    <View
      testID="chat-thought.block"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        marginVertical: spacing[1],
        borderRadius: 12,
        borderWidth: expanded ? 1 : 0,
        borderColor: isDark ? '#4a4a4f' : '#d8dbe5',
        backgroundColor: expanded ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.05)') : 'transparent',
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID="chat-thought.button.toggle"
        accessibilityRole="button"
        accessibilityLabel={t('chat.thoughtTitle')}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
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
          style={{ color: colors.textSecondary, fontSize: type.sm, fontWeight: '600' }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {t('chat.thoughtTitle')}
        </Text>
        {isStreaming ? (
          <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginLeft: spacing[1] }}>…</Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <View
          style={{
            paddingHorizontal: spacing[3],
            paddingBottom: spacing[3],
            borderTopWidth: 1,
            borderTopColor: isDark ? '#3a3a3f' : '#e5e7eb',
            paddingTop: spacing[2],
          }}
        >
          <Text testID="chat-thought.text" selectable style={{ color: colors.textSecondary, fontSize: type.sm, lineHeight: 20 }}>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const ThoughtBlock = React.memo(ThoughtBlockImpl);
