import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { CARD_RADIUS, CHAT_TYPE, CONTINUOUS_CORNERS } from './chatStyle';

export function isRateLimitMessage(message: string): boolean {
  return /\b429\b|rate[\s_-]?limit|too many requests/i.test(message);
}

type Props = {
  message: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

export function ChatErrorCard({ message, canRetry, onRetry, onDismiss }: Props) {
  const { t } = useTranslation();
  const { colors, spacing } = useTokens();
  if (!message) return null;

  const rateLimited = isRateLimitMessage(message);
  const tint = rateLimited ? colors.warning : colors.error;

  return (
    <View
      testID={rateLimited ? 'chat-error.rate-limit' : 'chat-error.card'}
      accessibilityRole={rateLimited ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing[2],
        marginHorizontal: spacing[3],
        marginBottom: spacing[2],
        padding: spacing[3],
        borderRadius: CARD_RADIUS,
        backgroundColor: rateLimited ? colors.surface : `${colors.error}1A`,
        ...CONTINUOUS_CORNERS,
      }}
    >
      <Ionicons name={rateLimited ? 'time-outline' : 'alert-circle'} size={16} color={tint} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text testID="chat-error.message" selectable style={{ ...CHAT_TYPE.status, color: colors.text }}>
          {rateLimited ? t('chat.rateLimited') : message}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing[4], marginTop: spacing[2] }}>
          {canRetry ? (
            <Pressable testID="chat-error.button.retry" accessibilityRole="button" hitSlop={8} onPress={onRetry}>
              <Text style={{ color: colors.primary, ...CHAT_TYPE.status, fontWeight: '600' }}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}
          <Pressable testID="chat-error.button.dismiss" accessibilityRole="button" hitSlop={8} onPress={onDismiss}>
            <Text style={{ color: colors.textSecondary, ...CHAT_TYPE.status, fontWeight: '600' }}>{t('common.dismiss')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
