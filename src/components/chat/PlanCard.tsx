import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useTokens } from '../../contexts/ThemeContext';
import type { PlanEntry } from '../../models/Chat';
import { PLAN_STATUS_ICONS, PLAN_STATUS_LABEL_KEYS } from './toolPresentation';

export interface PlanCardProps {
  entries: PlanEntry[];
}

function PlanCardImpl({ entries }: PlanCardProps) {
  const { colors, spacing, type } = useTokens();
  const { isDark } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      testID="chat-plan.card"
      style={{
        alignSelf: 'flex-start',
        width: '92%',
        marginVertical: spacing[1],
        padding: spacing[3],
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isDark ? '#4a4a4f' : '#d8dbe5',
        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.05)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] }}>
        <Ionicons name="list-outline" size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: type.sm, marginLeft: spacing[1] }}>
          {t('chat.planTitle')}
        </Text>
      </View>
      {entries.map((entry, index) => {
        const done = entry.status === 'completed';
        const active = entry.status === 'in_progress';
        return (
          <View
            key={`${index}-${entry.content}`}
            testID={`chat-plan.entry.${entry.status}`}
            accessible
            accessibilityLabel={`${t(PLAN_STATUS_LABEL_KEYS[entry.status])}: ${entry.content}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 }}
          >
            <Ionicons
              name={PLAN_STATUS_ICONS[entry.status]}
              size={18}
              color={done ? colors.success : active ? colors.primary : colors.textSecondary}
              style={{ marginRight: spacing[2], marginTop: 1 }}
            />
            <Text
              style={{
                flex: 1,
                fontSize: type.sm,
                lineHeight: 20,
                fontWeight: active ? '600' : '400',
                color: done ? colors.textSecondary : colors.text,
                textDecorationLine: done ? 'line-through' : 'none',
              }}
            >
              {entry.content}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export const PlanCard = React.memo(PlanCardImpl);
