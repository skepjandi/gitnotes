import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { ChatRunStatus } from '../../services/chat/types';

export interface LiveLineProps {
  status: ChatRunStatus;
  /** Connection line from the backend ("Reconnecting to the bridge…"); replaces the working label. */
  statusLine: string | null;
  /** Who is working: the agent name or the model. */
  actor?: string;
  startedAt: number;
  onStop: () => void;
}

/** The single line that stays at the foot of the transcript while a turn runs. */
export function LiveLine({ status, statusLine, actor, startedAt, onStop }: LiveLineProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const active = status === 'running' || status === 'awaiting-permission';
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    if (!active) return;
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const id = setInterval(() => setElapsedMs(Math.max(0, Date.now() - startedAt)), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  if (!active) return null;

  const waiting = status === 'awaiting-permission';
  const label = statusLine ?? (waiting ? t('chat.live.waiting') : actor ? t('chat.live.workingWith', { actor }) : t('chat.live.working'));
  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <View
      testID="chat.status.strip"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label} ${t('chat.live.seconds', { count: seconds })}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: waiting ? colors.warning : colors.accent,
        }}
      />
      <Text testID="chat.status.line" style={{ flexShrink: 1, color: colors.textSecondary, fontSize: type.sm }} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: type.xs,
          fontVariant: ['tabular-nums'],
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
        }}
      >
        {t('chat.live.seconds', { count: seconds })}
      </Text>
      <View style={{ flex: 1 }} />
      <Pressable
        testID="chat.status.cancel"
        accessibilityRole="button"
        accessibilityLabel={t('chat.cancelResponse')}
        onPress={onStop}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <Ionicons name="stop-circle-outline" size={18} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary, fontSize: type.xs }}>{t('chat.live.stop')}</Text>
      </Pressable>
    </View>
  );
}
