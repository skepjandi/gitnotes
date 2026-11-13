import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../../contexts/ThemeContext';
import type { AgentConfigOption } from '../../../models/Chat';
import { Modal, Toggle } from '../../ui';
import { currentChoiceLabel, groupConfigOptions, type ConfigGroup, type ConfigGroupKey } from './configOptions';

const CHIP_ICON: Record<ConfigGroupKey, keyof typeof Ionicons.glyphMap> = {
  model: 'sparkles-outline',
  effort: 'speedometer-outline',
  mode: 'options-outline',
};

const CHIP_MAX_WIDTH = 150;

export interface ConfigOptionsMenuProps {
  options: AgentConfigOption[];
  onChange: (optionId: string, value: string | boolean) => void;
  disabled?: boolean;
}

/** One chip per config group (model, effort, mode); each opens a bottom sheet listing that group's options. */
export function ConfigOptionsMenu({ options, onChange, disabled }: ConfigOptionsMenuProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<ConfigGroupKey | null>(null);

  const groups = groupConfigOptions(options);
  const openGroup = groups.find((group) => group.key === openKey);

  const chipLabel = (group: ConfigGroup): string => {
    const lead = group.options[0];
    if (group.key === 'model' && !group.options.some((option) => option.category === 'model')) {
      return t('chat.config.options');
    }
    return currentChoiceLabel(lead);
  };

  const sheetTitle: Record<ConfigGroupKey, string> = {
    model: t('chat.config.modelTitle'),
    effort: t('chat.config.effortTitle'),
    mode: t('chat.pickMode'),
  };

  const renderOption = (option: AgentConfigOption, showName: boolean) => (
    <View key={option.id} testID={`chat-config.option.${option.id}`}>
      {showName ? (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: type.xs,
            fontWeight: '700',
            letterSpacing: 0.4,
            paddingHorizontal: spacing[4],
            paddingTop: spacing[3],
            paddingBottom: spacing[1],
          }}
        >
          {option.name.toUpperCase()}
        </Text>
      ) : null}
      {option.type === 'boolean' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[3],
            gap: spacing[3],
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: type.md }}>{option.name}</Text>
            {option.description ? (
              <Text style={{ color: colors.textSecondary, fontSize: type.xs }}>{option.description}</Text>
            ) : null}
          </View>
          <Toggle
            testID={`chat-config.toggle.${option.id}`}
            accessibilityRole="switch"
            accessibilityLabel={option.name}
            value={option.currentValue === true}
            onValueChange={(next) => onChange(option.id, next)}
          />
        </View>
      ) : (
        (option.options ?? []).map((choice, index, all) => {
          const selected = choice.value === option.currentValue;
          const newGroup = choice.group && choice.group !== all[index - 1]?.group;
          return (
            <View key={choice.value}>
              {newGroup ? (
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: type.xs,
                    paddingHorizontal: spacing[4],
                    paddingTop: spacing[2],
                  }}
                >
                  {choice.group}
                </Text>
              ) : null}
              <Pressable
                testID={`chat-config.choice.${option.id}.${choice.value}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setOpenKey(null);
                  if (!selected) onChange(option.id, choice.value);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing[4],
                  paddingVertical: spacing[3],
                  gap: spacing[3],
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: type.md, fontWeight: selected ? '600' : '400' }}>
                    {choice.name}
                  </Text>
                  {choice.description ? (
                    <Text style={{ color: colors.textSecondary, fontSize: type.xs }} numberOfLines={2}>
                      {choice.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], flexShrink: 1 }}>
      {groups.map((group) => (
        <Pressable
          key={group.key}
          testID={`chat-config.chip.${group.key}`}
          accessibilityRole="button"
          accessibilityLabel={`${sheetTitle[group.key]}: ${chipLabel(group)}`}
          disabled={disabled}
          onPress={() => setOpenKey(group.key)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[1],
            maxWidth: CHIP_MAX_WIDTH,
            flexShrink: 1,
            paddingHorizontal: spacing[2],
            paddingVertical: spacing[1],
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Ionicons name={CHIP_ICON[group.key]} size={14} color={colors.accent} />
          <Text
            testID={`chat-config.chip.${group.key}.label`}
            style={{ color: colors.text, fontSize: type.sm, fontWeight: '500', flexShrink: 1 }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {chipLabel(group)}
          </Text>
          <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
        </Pressable>
      ))}

      <Modal visible={openGroup !== undefined} onRequestClose={() => setOpenKey(null)} bottomSheet contentStyle={{ padding: 0 }}>
        {openGroup ? (
          <View testID={`chat-config.sheet.${openGroup.key}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing[4], gap: spacing[2] }}>
              <Ionicons name={CHIP_ICON[openGroup.key]} size={16} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontSize: type.md, fontWeight: '600' }}>{sheetTitle[openGroup.key]}</Text>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {openGroup.options.map((option) => renderOption(option, openGroup.options.length > 1))}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}
