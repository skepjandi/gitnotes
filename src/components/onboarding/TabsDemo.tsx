import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { DemoFrame, type IoniconName } from './TourPage';
import { useTourText, type TourCopyKey } from './tourCopy';

interface TabSpec {
  readonly focused: IoniconName;
  readonly outline: IoniconName;
  readonly label: TourCopyKey;
}

/** Mirrors the icons and order of the real tab bar (TabNavigator). */
export const TOUR_TABS: readonly TabSpec[] = [
  { focused: 'home', outline: 'home-outline', label: 'tabs.home.lead' },
  { focused: 'document-text', outline: 'document-text-outline', label: 'tabs.notes.lead' },
  { focused: 'git-branch', outline: 'git-branch-outline', label: 'tabs.git.lead' },
  { focused: 'checkbox', outline: 'checkbox-outline', label: 'tabs.todos.lead' },
  { focused: 'settings', outline: 'settings-outline', label: 'tabs.settings.lead' },
];

interface TabsDemoProps {
  readonly activeIndex: number;
}

export function TabsDemo({ activeIndex }: TabsDemoProps) {
  const { colors } = useTheme();
  const tx = useTourText();
  return (
    <DemoFrame testID="onboarding.demo.tabs" height={150} accessibilityLabel={tx(TOUR_TABS[activeIndex].label)}>
      <View style={{ flex: 1, justifyContent: 'space-between', padding: 16 }}>
        <View style={{ gap: 8 }}>
          <View style={{ height: 12, width: '46%', borderRadius: 6, backgroundColor: colors.border }} />
          <View style={{ height: 8, width: '78%', borderRadius: 4, backgroundColor: colors.border, opacity: 0.6 }} />
          <View style={{ height: 8, width: '62%', borderRadius: 4, backgroundColor: colors.border, opacity: 0.6 }} />
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            paddingVertical: 8,
            borderRadius: 16,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {TOUR_TABS.map((tab, index) => {
            const active = index === activeIndex;
            return (
              <View key={tab.label} style={{ alignItems: 'center', minWidth: 52, gap: 2 }}>
                <Ionicons
                  name={active ? tab.focused : tab.outline}
                  size={22}
                  color={active ? colors.accent : colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: active ? '800' : '500',
                    color: active ? colors.accent : colors.textSecondary,
                  }}
                >
                  {tx(tab.label)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </DemoFrame>
  );
}
