import React, { ReactNode } from 'react';
import { Pressable, StyleProp, Text, ViewStyle } from 'react-native';
import { Surface } from './Surface';
import { useTokens } from '../../contexts/ThemeContext';

export interface ChipProps {
  label?: string;
  active?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

export function Chip(props: ChipProps) {
  const { label, active = false, onPress, onLongPress, leading, trailing, style, children, testID } = props;
  const { colors, spacing, type } = useTokens();

  const surface = (
    <Surface
      elevation="subtle"
      radius="pill"
      inset={active}
      style={[
        {
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[1] + 2,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[1],
        },
        style,
      ]}
    >
      {leading}
      {label !== undefined && (
        <Text
          style={{
            color: colors.text,
            fontSize: type.sm,
            fontWeight: active ? '600' : '500',
          }}
        >
          {label}
        </Text>
      )}
      {children}
      {trailing}
    </Surface>
  );

  if (!onPress && !onLongPress) return surface;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {surface}
    </Pressable>
  );
}
