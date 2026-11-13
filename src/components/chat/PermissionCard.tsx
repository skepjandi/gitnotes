import React from 'react';
import { Platform, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { PermissionDecision, PermissionOption, PermissionOptionKind, PermissionRequest } from '../../services/chat/types';
import { HapticService } from '../../utils/haptics';
import { Button, type ButtonVariant } from '../ui';

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

/** An open approval request, rendered inline in the transcript where the agent asked. */
export function PermissionCard({ request, onResolve }: PermissionCardProps) {
  const { colors, spacing, type } = useTokens();
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
        onPress={() => {
          void (allow ? HapticService.success() : HapticService.warning());
          onResolve(request.id, { optionId: option.id });
        }}
        leadingIcon={<Ionicons name={allow ? 'checkmark' : 'close'} size={16} color={tint} />}
      />
    );
  };

  return (
    <View
      testID="chat-permission.card"
      accessibilityRole="alert"
      style={{
        alignSelf: 'stretch',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.elevated,
        padding: spacing[3],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing[1], gap: spacing[1] }}>
        <Ionicons name="hand-left-outline" size={14} color={colors.warning} />
        <Text style={{ color: colors.warning, fontSize: type.xs, fontWeight: '700', letterSpacing: 0.4 }}>
          {t('chat.permissionRequired').toUpperCase()}
        </Text>
      </View>
      <Text testID="chat-permission.title" style={{ color: colors.text, fontSize: type.md, fontWeight: '600' }}>
        {request.title}
      </Text>
      {request.description ? (
        <Text
          testID="chat-permission.description"
          selectable
          style={{
            color: colors.textSecondary,
            fontSize: type.sm,
            marginTop: spacing[1],
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
          }}
        >
          {request.description}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
        {request.options.map(renderOption)}
      </View>
    </View>
  );
}
