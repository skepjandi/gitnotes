import React, { ReactNode } from 'react';
import { Platform, Text, View, StyleProp, ViewStyle, LayoutChangeEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useTokens } from '../../contexts/ThemeContext';
import { IconButton } from './IconButton';
import { ON_FILLED } from '../../theme/tokens';

export const SCREEN_HEADER_BASE_HEIGHT = 60;
export const SCREEN_HEADER_SUBTITLE_HEIGHT = 88;

export function useScreenHeaderHeight(opts?: { subtitle?: boolean }): number {
  const insets = useSafeAreaInsets();
  const base = opts?.subtitle ? SCREEN_HEADER_SUBTITLE_HEIGHT : SCREEN_HEADER_BASE_HEIGHT;
  return insets.top + base;
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onBack?: () => void;
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  testID?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}

export function ScreenHeader(props: ScreenHeaderProps) {
  const { title, subtitle, badge, onBack, actions, style, footer, testID, onLayout } = props;
  const { isDark } = useTheme();
  const { colors, spacing } = useTokens();
  const insets = useSafeAreaInsets();

  const headerContent = (
    <View
      style={[
        {
          paddingHorizontal: spacing[4],
          paddingTop: spacing[3],
          paddingBottom: spacing[3],
          gap: spacing[3],
        },
        style,
      ]}
      className="flex-row items-center"
    >
      {onBack && (
        <IconButton size="sm" onPress={onBack} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={18} color={colors.accent} />
        </IconButton>
      )}
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-2xl font-bold flex-shrink-1"
            style={{ color: colors.text }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {badge && (
            <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: colors.accent }}>
              <Text className="text-[10px] font-extrabold" style={{ color: ON_FILLED, letterSpacing: 0.5 }}>
                {badge}
              </Text>
            </View>
          )}
        </View>
        {subtitle && (
          <Text
            className="text-sm mt-0.5"
            style={{ color: colors.textSecondary }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {actions && (
        <View className="flex-row items-center gap-2">
          {actions}
        </View>
      )}
    </View>
  );

  if (Platform.OS === 'android') {
    return (
      <View
        pointerEvents="box-none"
        testID={testID}
        onLayout={onLayout}
        className="absolute top-0 left-0 right-0 z-10"
        style={{
          paddingTop: insets.top,
          backgroundColor: `${colors.bg}D9`,
        }}
      >
        {headerContent}
        {footer}
      </View>
    );
  }

  return (
    <BlurView
      pointerEvents="box-none"
      testID={testID}
      onLayout={onLayout}
      intensity={60}
      tint={isDark ? 'dark' : 'light'}
      className="absolute top-0 left-0 right-0 z-10"
      style={{ paddingTop: insets.top }}
    >
      {headerContent}
      {footer}
    </BlurView>
  );
}
