import React, { ReactNode, useCallback, useState } from 'react';
import { Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Surface } from './Surface';
import { useTokens, useTheme } from '../../contexts/ThemeContext';
import { ON_FILLED, type Radius } from '../../theme/tokens';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

interface ButtonSizeStyle {
  minHeight: number;
  contentClass: string;
  ghostClass: string;
  radius: Radius;
}

// Compact sizes follow the app button norm: rounded-sm (12px) or smaller,
// tighter padding, smaller type. md keeps the original 44px touch target.
const SIZE_STYLES: Record<ButtonSize, ButtonSizeStyle> = {
  xs: { minHeight: 28, contentClass: 'py-1 px-3', ghostClass: 'py-1 px-2 rounded-sm', radius: 'sm' },
  sm: { minHeight: 36, contentClass: 'py-2 px-4', ghostClass: 'py-1.5 px-2.5 rounded-sm', radius: 'sm' },
  md: { minHeight: 44, contentClass: 'py-3 px-5', ghostClass: 'py-2 px-3 rounded-md', radius: 'md' },
};

export { ButtonText } from './text';

export interface ButtonProps {
  label?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  iconAlign?: 'inline' | 'edge';
  size?: ButtonSize;
  className?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLabel?: string;
  children?: ReactNode;
}

export function Button(props: ButtonProps) {
  const {
    label,
    onPress,
    onLongPress,
    variant = 'secondary',
    disabled = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    iconAlign = 'inline',
    size,
    className,
    style,
    textStyle,
    testID,
    accessibilityLabel,
    children,
  } = props;
  const { colors, type } = useTokens();
  const { style: themeStyle } = useTheme();
  const [isPressed, setIsPressed] = useState(false);
  const scale = useSharedValue(1);
  const sizeStyle = SIZE_STYLES[size ?? 'md'];
  const fontSize = size === 'xs' ? type.xs : size === 'sm' ? type.sm : type.md;

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, { mass: 0.4, damping: 14, stiffness: 220 });
    setIsPressed(true);
    Haptics.selectionAsync().catch(() => undefined);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { mass: 0.4, damping: 14, stiffness: 220 });
    setIsPressed(false);
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const textColor = (variant === 'primary' || variant === 'danger') ? ON_FILLED : colors.text;
  const isGhost = variant === 'ghost';

  const labelNode = label !== undefined && (
    <Text
      style={[
        { color: textColor, fontSize, fontWeight: (variant === 'primary' || variant === 'danger') ? '600' : '500' },
        textStyle,
      ]}
    >
      {label}
    </Text>
  );

  const childrenNode = typeof children === 'string' ? (
    <Text
      style={[
        { color: textColor, fontSize, fontWeight: (variant === 'primary' || variant === 'danger') ? '600' : '500' },
        textStyle,
      ]}
    >
      {children}
    </Text>
  ) : children;

  const content = (
    <View className={cn(
      'flex-row items-center justify-center',
      iconAlign === 'edge' ? 'gap-3' : 'gap-2'
    )}>
      {leadingIcon}
      {labelNode}
      {childrenNode}
      {trailingIcon}
    </View>
  );

  // An edge icon (leading or trailing) optically shifts the centered label:
  // the icon adds width to one side, so the text sits off the button's true
  // center. Pin the icon(s) to the edge (absolute) and reserve the same space
  // on both sides so the label stays dead-center. This fixes the trailing
  // onboarding "Next" bug and the leading-icon "New Chat" button, which
  // rendered its label ~half-an-icon right of center with inline alignment.
  //
  // iconAlign="edge" keeps that behavior for wide/fullWidth buttons where the
  // pinned icon has room. iconAlign="inline" (default) renders the icon next
  // to the label in the flex row instead — needed for narrow buttons (e.g. the
  // header "Save" button) where the absolutely-pinned icon overlaps the text.
  const hasLeadingIcon = leadingIcon != null;
  const hasTrailingIcon = trailingIcon != null;
  const useEdgeIcon = (hasLeadingIcon || hasTrailingIcon) && iconAlign === 'edge';
  const centeredContent = (
    <View className="flex-row items-center justify-center">
      <View style={{ width: hasLeadingIcon || hasTrailingIcon ? 20 : 0 }} />
      {labelNode}
      {childrenNode}
      <View style={{ width: hasLeadingIcon || hasTrailingIcon ? 20 : 0 }} />
    </View>
  );
  const edgeLeadingIcon = hasLeadingIcon ? (
    <View className="absolute left-5">
      {leadingIcon}
    </View>
  ) : null;
  const edgeIcon = hasTrailingIcon ? (
    <View className="absolute right-5">
      {trailingIcon}
    </View>
  ) : null;

  if (isGhost) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={disabled ? undefined : onPress}
        onLongPress={disabled ? undefined : onLongPress}
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        disabled={disabled}
        style={({ pressed }) => [
          {
            opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          },
          style,
        ]}
        className={cn(
          sizeStyle.ghostClass,
          'items-center justify-center',
          fullWidth && 'self-stretch',
          className
        )}
      >
        {useEdgeIcon ? (
          <>
            {centeredContent}
            {edgeLeadingIcon}
            {edgeIcon}
          </>
        ) : content}
      </Pressable>
    );
  }

  return (
    <Animated.View style={[{ opacity: disabled ? 0.5 : 1 }, animatedStyle]} className={cn(fullWidth && 'self-stretch', className)}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={disabled ? undefined : onPress}
        onLongPress={disabled ? undefined : onLongPress}
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        disabled={disabled}
        style={fullWidth ? { alignSelf: 'stretch' } : undefined}
      >
        <Surface
          elevation={themeStyle === 'flat' || variant === 'primary' || variant === 'outline' ? 'flat' : 'raised'}
          radius={sizeStyle.radius}
          inset={isPressed}
          style={[
            {
              minHeight: sizeStyle.minHeight,
              alignSelf: 'stretch',
            },
            // variant="primary" carries a filled primary background; the
            // raised Surface alone renders a white card, which made primary
            // labels overridden to white invisible (white-on-white).
            variant === 'primary'
              ? { backgroundColor: colors.primary }
              : variant === 'danger'
                ? { backgroundColor: colors.error }
                : variant === 'outline'
                  ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }
                  : { backgroundColor: colors.surface },
            style,
          ]}
        >
          <View className={cn(sizeStyle.contentClass, 'items-center justify-center self-stretch')}>
            {useEdgeIcon ? (
              <>
                {centeredContent}
                {edgeLeadingIcon}
                {edgeIcon}
              </>
            ) : content}
          </View>
        </Surface>
      </Pressable>
    </Animated.View>
  );
}
