import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '../ui';

type Props = {
  message: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

export function ChatErrorCard({ message, canRetry, onRetry, onDismiss }: Props) {
  const { t } = useTranslation();
  if (!message) return null;

  return (
    <Surface
      elevation="raised"
      radius="md"
      accessibilityRole="alert"
      className="mx-4 mb-3 p-4 border border-error"
    >
      <Text testID="chat-error.message" className="text-md font-semibold mb-2 text-text">{message}</Text>
      <View className="flex-row gap-2">
        {canRetry ? (
          <Button testID="chat-error.button.retry" variant="primary" onPress={onRetry} label={t('common.retry')} />
        ) : null}
        <Button testID="chat-error.button.dismiss" variant="secondary" onPress={onDismiss}>{t('common.dismiss')}</Button>
      </View>
    </Surface>
  );
}
