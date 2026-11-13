import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated from 'react-native-reanimated';
import { useTokens } from '../../contexts/ThemeContext';
import type { PermissionDecision, PermissionOption, PermissionOptionKind, PermissionRequest } from '../../services/chat/types';
import { HapticService } from '../../utils/haptics';
import { Button, type ButtonVariant } from '../ui';
import { CARD_RADIUS, CHAT_TYPE, CONTINUOUS_CORNERS, MONO_FONT } from './chatStyle';
import { useChatTransitions } from './motion/transitions';

const announcedRequests = new Set<string>();

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
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const { entering } = useChatTransitions();

  useEffect(() => {
    if (announcedRequests.has(request.id)) return;
    announcedRequests.add(request.id);
    void HapticService.warning();
  }, [request.id]);

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
          void (allow ? HapticService.success() : option.kind === 'reject_always' ? HapticService.error() : HapticService.warning());
          onResolve(request.id, { optionId: option.id });
        }}
        leadingIcon={<Ionicons name={allow ? 'checkmark' : 'close'} size={16} color={tint} />}
      />
    );
  };

  return (
    <Animated.View
      entering={entering}
      testID="chat-permission.card"
      accessibilityRole="alert"
      style={{
        alignSelf: 'stretch',
        borderRadius: CARD_RADIUS,
        borderWidth: 1.5,
        borderColor: colors.warning,
        backgroundColor: colors.elevated,
        padding: spacing[3],
        ...CONTINUOUS_CORNERS,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing[1], gap: spacing[1] }}>
        <Ionicons name="hand-left-outline" size={14} color={colors.warning} />
        <Text style={{ color: colors.warning, ...CHAT_TYPE.caption, fontWeight: '700', letterSpacing: 0.4 }}>
          {t('chat.permissionRequired').toUpperCase()}
        </Text>
      </View>
      <Text testID="chat-permission.title" style={{ ...CHAT_TYPE.body, color: colors.text, fontWeight: '600' }}>
        {request.title}
      </Text>
      {request.description ? (
        <Text
          testID="chat-permission.description"
          selectable
          style={{
            color: colors.textSecondary,
            ...CHAT_TYPE.status,
            marginTop: spacing[1],
            fontFamily: MONO_FONT,
          }}
        >
          {request.description}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
        {request.options.map(renderOption)}
      </View>
    </Animated.View>
  );
}
