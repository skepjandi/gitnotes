import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { PermissionDecision, PermissionOption, PermissionOptionKind, PermissionRequest } from '../../services/chat/types';
import { Button, Surface, type ButtonVariant } from '../ui';

const VARIANT_BY_KIND: Record<PermissionOptionKind, ButtonVariant> = {
  allow_once: 'primary',
  allow_always: 'secondary',
  reject_once: 'danger',
  reject_always: 'outline',
};

export interface PermissionCardProps {
  request: PermissionRequest;
  onResolve: (requestId: string, decision: PermissionDecision) => void;
}

export function PermissionCard({ request, onResolve }: PermissionCardProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();

  const renderOption = (option: PermissionOption) => {
    const allow = option.kind.startsWith('allow');
    const tint = option.kind === 'allow_once' || option.kind === 'reject_once' ? '#ffffff' : colors.text;
    return (
      <Button
        key={option.id}
        testID={`chat-permission.button.${option.id}`}
        variant={VARIANT_BY_KIND[option.kind]}
        size="sm"
        label={option.label}
        onPress={() => onResolve(request.id, { optionId: option.id })}
        leadingIcon={<Ionicons name={allow ? 'checkmark' : 'close'} size={16} color={tint} />}
      />
    );
  };

  return (
    <Surface
      testID="chat-permission.card"
      elevation="raised"
      radius="md"
      accessibilityRole="alert"
      className="mx-4 mb-3 p-4 border border-accent"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing[1] }}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
        <Text className="text-xs font-semibold uppercase" style={{ color: colors.accent, marginLeft: spacing[1] }}>
          {t('chat.permissionRequired')}
        </Text>
      </View>
      <Text testID="chat-permission.title" className="text-md font-bold text-text">
        {request.title}
      </Text>
      {request.description ? (
        <Text testID="chat-permission.description" className="text-sm mt-1 text-text-secondary">
          {request.description}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
        {request.options.map(renderOption)}
      </View>
    </Surface>
  );
}
