import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { AgentMode } from '../../models/Chat';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';

export interface AgentModeChipProps {
  modes: AgentMode[];
  currentModeId: string | undefined;
  onSelect: (modeId: string) => void;
  disabled?: boolean;
}

export function AgentModeChip({ modes, currentModeId, onSelect, disabled }: AgentModeChipProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = modes.find((mode) => mode.id === currentModeId);
  const items = useMemo<ContextMenuItem[]>(
    () =>
      modes.map((mode) => ({
        icon: mode.id === currentModeId ? 'checkmark-circle' : 'ellipse-outline',
        label: mode.name,
        subtitle: mode.description,
        testID: `chat-mode.item.${mode.id}`,
        onPress: () => {
          if (mode.id !== currentModeId) onSelect(mode.id);
        },
      })),
    [modes, currentModeId, onSelect],
  );

  return (
    <View style={{ flexDirection: 'row' }}>
      <Pressable
        testID="chat-mode.chip"
        accessibilityRole="button"
        accessibilityLabel={t('chat.agentMode', { mode: current?.name ?? '' })}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[1],
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[1],
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Ionicons name="options-outline" size={14} color={colors.accent} />
        <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '500' }} numberOfLines={1}>
          {current?.name ?? t('chat.agentModeUnknown')}
        </Text>
        <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
      </Pressable>
      <ContextMenu
        visible={open}
        onClose={() => setOpen(false)}
        title={t('chat.pickMode')}
        headerIcon="options-outline"
        items={items}
        bottomSheet
      />
    </View>
  );
}
