import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { Button, Input, Modal } from '../ui';

export interface TextPromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  confirmLabel: string;
  multiline?: boolean;
  testIDPrefix?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Cross-platform replacement for the iOS-only `Alert.prompt`. Confirm is disabled while the trimmed text is empty. */
export function TextPromptModal({
  visible,
  title,
  message,
  initialValue = '',
  confirmLabel,
  multiline = false,
  testIDPrefix = 'text-prompt',
  onConfirm,
  onCancel,
}: TextPromptModalProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();

  return (
    <Modal visible={visible} onRequestClose={onCancel} fullWidth accessibilityLabel={title}>
      <Text style={{ color: colors.text, fontSize: type.lg, fontWeight: '700' }}>{title}</Text>
      {message ? (
        <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginTop: spacing[1] }}>{message}</Text>
      ) : null}
      <View style={{ marginTop: spacing[3] }}>
        <Input
          testID={`${testIDPrefix}.input`}
          value={value}
          onChangeText={setValue}
          multiline={multiline}
          multilineMinHeight={multiline ? 120 : undefined}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType={multiline ? 'default' : 'done'}
          onSubmitEditing={multiline || trimmed.length === 0 ? undefined : () => onConfirm(trimmed)}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[4] }}>
        <View style={{ flex: 1 }}>
          <Button testID={`${testIDPrefix}.button.cancel`} variant="secondary" label={t('common.cancel')} onPress={onCancel} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID={`${testIDPrefix}.button.confirm`}
            variant="primary"
            label={confirmLabel}
            disabled={trimmed.length === 0}
            onPress={() => onConfirm(trimmed)}
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
}
