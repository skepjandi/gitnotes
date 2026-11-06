import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Surface } from './Surface';
import { useTheme, useTokens } from '../../contexts/ThemeContext';
import { useResponsive } from '../../hooks/useResponsive';

type IoniconName = keyof typeof Ionicons.glyphMap;

export const TAB_BAR_BASE_HEIGHT = 84;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  const { style } = useTheme();
  const { isTablet } = useResponsive();
  const useFloatingBar = !isTablet && style === 'neumorphic';
  if (!useFloatingBar) return 0;
  return insets.bottom + TAB_BAR_BASE_HEIGHT;
}

const TAB_ICONS: Record<string, { focused: IoniconName; outline: IoniconName; labelKey: string }> = {
  HomeTab: { focused: 'home', outline: 'home-outline', labelKey: 'tabs.home' },
  NotesTab: { focused: 'document-text', outline: 'document-text-outline', labelKey: 'tabs.notes' },
  ExploreTab: { focused: 'git-branch', outline: 'git-branch-outline', labelKey: 'tabs.explore' },
  TodosTab: { focused: 'checkbox', outline: 'checkbox-outline', labelKey: 'tabs.todos' },
  SettingsTab: { focused: 'settings', outline: 'settings-outline', labelKey: 'tabs.settings' },
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, spacing } = useTokens();
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const parentState = navigation?.getParent?.()?.getState();
  const parentRouteName = parentState?.routes?.[parentState.index]?.name;
  if (parentRouteName === 'Paywall') return null;

  if (Platform.OS === 'android') {
    return (
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 bottom-0"
        style={{
          paddingHorizontal: spacing[6],
          paddingBottom: insets.bottom + spacing[3],
          paddingTop: spacing[4],
          backgroundColor: 'transparent',
          zIndex: 10000,
        }}
      >
        <View
          className="flex-row items-center justify-around py-2 px-3 rounded-full overflow-hidden"
          style={{
            backgroundColor: `${colors.bg}D9`,
          }}
        >
          {state.routes.map((route, index) => {
            const isFocused = state.index === index;
            const config = TAB_ICONS[route.name];
            if (!config) return null;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            };

            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <Pressable
                key={route.key}
                testID={`tab-bar.tab.press-${route.name}`}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={t(config.labelKey)}
                onPress={onPress}
                onLongPress={onLongPress}
                hitSlop={6}
              >
                <Surface
                  elevation={Platform.OS === 'android' ? 'flat' : 'subtle'}
                  radius="pill"
                  inset={Platform.OS !== 'android' && isFocused}
                  style={{
                    width: 48,
                    height: 40,
                    backgroundColor: 'transparent',
                  }}
                  className="items-center justify-center"
                >
                  <Ionicons
                    name={isFocused ? config.focused : config.outline}
                    size={22}
                    color={isFocused ? colors.accent : colors.textSecondary}
                  />
                </Surface>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 bottom-0"
      style={{
        paddingHorizontal: spacing[6],
        paddingBottom: insets.bottom + spacing[3],
        paddingTop: spacing[4],
        backgroundColor: 'transparent',
        zIndex: 10000,
      }}
    >
      <BlurView
        intensity={60}
        tint={isDark ? 'dark' : 'light'}
        pointerEvents="box-none"
        className="flex-row items-center justify-around py-2 px-3 rounded-full overflow-hidden"
      >
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const config = TAB_ICONS[route.name];
          if (!config) return null;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name as never);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <Pressable
              key={route.key}
              testID={`tab-bar.tab.press-${route.name}`}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={t(config.labelKey)}
              onPress={onPress}
              onLongPress={onLongPress}
              hitSlop={6}
            >
              <Surface
                elevation="subtle"
                radius="pill"
                inset={isFocused}
                style={{
                  width: 48,
                  height: 40,
                  backgroundColor: 'transparent',
                }}
                className="items-center justify-center"
              >
                <Ionicons
                  name={isFocused ? config.focused : config.outline}
                  size={22}
                  color={isFocused ? colors.accent : colors.textSecondary}
                />
              </Surface>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}
