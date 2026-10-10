import React, { Fragment, ReactNode } from 'react';
import { Pressable, StyleProp, Text, View, ViewStyle, StyleSheet } from 'react-native';
import { Surface } from './Surface';
import { useTheme, useTokens } from '../../contexts/ThemeContext';

export interface GroupProps {
  title?: string;
  badge?: string;
  footer?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

export function Group(props: GroupProps) {
  const { title, badge, footer, style, children, testID } = props;
  const { style: themeStyle } = useTheme();
  const { colors, spacing } = useTokens();
  const items = React.Children.toArray(children).filter(Boolean);

  const surfaceStyle: StyleProp<ViewStyle> =
    themeStyle === 'flat'
      ? { borderWidth: 0 }
      : undefined;

  return (
    <View testID={testID} style={[{ gap: spacing[2] }, style]}>
      {title && (
        <View className="flex-row items-center gap-2 ml-3">
          <Text
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: colors.textSecondary, letterSpacing: 0.6 }}
          >
            {title}
          </Text>
          {badge && (
            <View className="bg-blue-500 px-2 py-0.5 rounded-md">
              <Text className="text-white text-[10px] font-extrabold" style={{ letterSpacing: 0.5 }}>
                {badge}
              </Text>
            </View>
          )}
        </View>
      )}
      <Surface elevation="raised" radius="lg" style={[surfaceStyle, { overflow: 'hidden', marginTop: title ? spacing[2] : 0 }]}>
        {items.map((child, idx) => {
          const childKey =
            React.isValidElement(child) && child.key != null
              ? `c-${child.key}`
              : `i-${idx}`;
          return (
            <Fragment key={childKey}>
              {idx > 0 && (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    marginLeft: spacing[4],
                    backgroundColor: colors.shadow,
                    opacity: 0.18,
                  }}
                />
              )}
              {child}
            </Fragment>
          );
        })}
      </Surface>
      {footer && (
        <Text
          className="text-xs mx-3 mt-1"
          style={{ color: colors.textSecondary }}
        >
          {footer}
        </Text>
      )}
    </View>
  );
}

export interface GroupRowProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  accessibilityRole?: 'button' | 'link' | 'none';
  accessibilityLabel?: string;
}

export function GroupRow(props: GroupRowProps) {
  const { onPress, onLongPress, disabled, leading, trailing, style, children, testID, accessibilityRole, accessibilityLabel } = props;
  const { colors, spacing } = useTokens();

  const content = (
    <View
      style={[
        {
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          gap: spacing[3],
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      className="flex-row items-center min-h-[48px]"
    >
      {leading}
      <View className="flex-1">{children}</View>
      {trailing}
    </View>
  );

  if (!onPress && !onLongPress) return content;

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      disabled={disabled}
      android_ripple={{ color: colors.shadow + '20' }}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.shadow + '14' : 'transparent' })}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </Pressable>
  );
}
