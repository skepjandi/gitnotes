import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import HomeScreen from '../screens/HomeScreen';
import NotesListScreen from '../screens/NotesListScreen';
import ExploreScreen from '../screens/ExploreScreen';
import TodoListScreen from '../screens/TodoListScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CanvasListScreen from '../screens/CanvasListScreen';
import { BottomTabParamList } from './types';
import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../contexts/ThemeContext';
import { TabBar } from '../components/ui';

const Tab = createBottomTabNavigator<BottomTabParamList>();

type TabNavigatorProps = {
  observeInteractiveMarker?: typeof import('expo-observe').ObserveInteractiveMarker;
  navigationReady?: boolean;
};

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { focused: IoniconName; outline: IoniconName; labelKey: string }> = {
  HomeTab: { focused: 'home', outline: 'home-outline', labelKey: 'tabs.home' },
  NotesTab: { focused: 'document-text', outline: 'document-text-outline', labelKey: 'tabs.notes' },
  ExploreTab: { focused: 'git-branch', outline: 'git-branch-outline', labelKey: 'tabs.explore' },
  TodosTab: { focused: 'checkbox', outline: 'checkbox-outline', labelKey: 'tabs.todos' },
  SettingsTab: { focused: 'settings', outline: 'settings-outline', labelKey: 'tabs.settings' },
};

function TabletRail({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        railStyles.rail,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + 6,
        },
      ]}
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
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TouchableOpacity
              key={route.key}
              testID={`tab-bar.tab.press-${route.name}`}
              accessibilityRole="tab"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={t(config.labelKey)}
              style={[
                railStyles.tab,
                isFocused && {
                  backgroundColor: colors.primary + '18',
                  borderRadius: 12,
                },
              ]}
              onPress={onPress}
              onLongPress={onLongPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isFocused ? config.focused : config.outline}
                size={26}
                color={isFocused ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  railStyles.label,
                  { color: isFocused ? colors.primary : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {t(config.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
    </View>
  );
}

const railStyles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginHorizontal: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
});

export default function TabNavigator({
  observeInteractiveMarker,
  navigationReady,
}: TabNavigatorProps) {
  const { isTablet } = useResponsive();
  const { style, colors } = useTheme();
  const { t } = useTranslation();
  const useNeumorphicBar = !isTablet && style === 'neumorphic';
  const useNeoBrutalistBar = !isTablet && style === 'neo-brutalist';
  const useRetrofuturisticBar = !isTablet && style === 'retrofuturistic';
  const useCustomBar = useNeumorphicBar || useNeoBrutalistBar || useRetrofuturisticBar;

  // Paywall lives on the root stack (sibling of MainTabs), so the custom
  // TabBar's parent-route check never fires for the default bar (flat/tablet).
  const rootRouteName = useNavigationState((state) => state.routes[state.index]?.name);
  const isPaywallVisible = rootRouteName === 'Paywall';

return (
    <Tab.Navigator
      screenLayout={
        observeInteractiveMarker
          ? ({ children }) => (
              <>
                {children}
                {navigationReady ? React.createElement(observeInteractiveMarker) : null}
              </>
            )
          : undefined
      }
      tabBar={
        isPaywallVisible
          ? () => null
          : isTablet
            ? (props) => <TabletRail {...props} />
            : useCustomBar
              ? (props) => <TabBar {...props} />
              : undefined
      }
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const config = TAB_ICONS[route.name];
          if (!config) return null;
          const iconName = focused ? config.focused : config.outline;
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: t('tabs.home') }}
      />
      <Tab.Screen
        name="NotesTab"
        component={NotesListScreen}
        options={{ title: t('tabs.notes') }}
      />
      <Tab.Screen
        name="ExploreTab"
        component={ExploreScreen}
        options={{ title: t('tabs.explore') }}
      />
      <Tab.Screen
        name="TodosTab"
        component={TodoListScreen}
        options={{ title: t('tabs.todos') }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: t('tabs.settings') }}
      />
      <Tab.Screen
        name="CanvasList"
        component={CanvasListScreen}
        options={{ title: t('canvases.title'), tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }}
      />
    </Tab.Navigator>
  );
}
