import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';

type Props = {
  message: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

export function ChatErrorCard({ message, canRetry, onRetry, onDismiss }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, type } = useTokens();
  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing[2],
        marginHorizontal: spacing[3],
        marginBottom: spacing[2],
        padding: spacing[3],
        borderRadius: 14,
        backgroundColor: `${colors.error}1A`,
      }}
    >
      <Ionicons name="alert-circle" size={16} color={colors.error} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text testID="chat-error.message" selectable style={{ color: colors.text, fontSize: type.sm }}>
          {message}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing[4], marginTop: spacing[2] }}>
          {canRetry ? (
            <Pressable testID="chat-error.button.retry" accessibilityRole="button" hitSlop={8} onPress={onRetry}>
              <Text style={{ color: colors.primary, fontSize: type.sm, fontWeight: '600' }}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}
          <Pressable testID="chat-error.button.dismiss" accessibilityRole="button" hitSlop={8} onPress={onDismiss}>
            <Text style={{ color: colors.textSecondary, fontSize: type.sm, fontWeight: '600' }}>{t('common.dismiss')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
