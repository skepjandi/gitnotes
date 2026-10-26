import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Surface } from './Surface';
import { useTokens } from '../../contexts/ThemeContext';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
  /** Exposes the control as an assistive-technology switch (with checked state). */
  accessibilityRole?: 'switch';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 30;
const THUMB = 22;

export function Toggle(props: ToggleProps) {
  const { value, onValueChange, disabled, testID, accessibilityRole, accessibilityLabel, accessibilityHint } = props;
  const { colors } = useTokens();
  const offset = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    offset.value = withSpring(value ? 1 : 0, { mass: 0.5, damping: 16, stiffness: 220 });
  }, [value, offset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value * (TRACK_WIDTH - THUMB - 8) }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    opacity: offset.value,
  }));

  const handlePress = () => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => undefined);
    onValueChange(!value);
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityRole === 'switch' ? { checked: value } : undefined}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Surface
        elevation="subtle"
        radius="pill"
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          padding: 4,
          backgroundColor: colors.surfaceSecondary,
        }}
        className="justify-center"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 999, backgroundColor: colors.accent },
            fillStyle,
          ]}
        />
        <Animated.View style={thumbStyle}>
          <View
            style={{
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: colors.surface,
              shadowColor: colors.shadow,
              shadowOffset: { width: 1, height: 1 },
              shadowOpacity: 0.6,
              shadowRadius: 2,
              elevation: 2,
            }}
          />
        </Animated.View>
      </Surface>
    </Pressable>
  );
}
