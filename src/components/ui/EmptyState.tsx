import React from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../contexts/ThemeContext';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  iconColor?: string;
  /** Label of the call-to-action button; rendered only together with `onAction`. */
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  iconColor,
  actionLabel,
  onAction,
  actionTestID,
  testID,
  style,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const accessibilityLabel = subtitle ? `${title}. ${subtitle}` : title;
  const glyphColor = iconColor ?? colors.primary;
  const showAction = !!actionLabel && !!onAction;

  return (
    <View className="flex-1 items-center justify-center py-16 px-6" style={style} testID={testID}>
      <View
        className="items-center"
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
      >
        <View
          className="items-center justify-center"
          style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: `${glyphColor}14` }}
        >
          <View
            className="items-center justify-center"
            style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: `${glyphColor}22` }}
          >
            <Ionicons name={icon} size={36} color={glyphColor} />
          </View>
        </View>
        <Text
          className="text-[19px] font-bold mt-5 text-center"
          style={{ color: colors.text, letterSpacing: -0.3 }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-sm mt-1.5 text-center" style={{ color: colors.textSecondary, maxWidth: 280, lineHeight: 20 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showAction ? (
        <View className="mt-6">
          <Button variant="primary" size="md" label={actionLabel} onPress={onAction} testID={actionTestID} />
        </View>
      ) : null}
    </View>
  );
}
