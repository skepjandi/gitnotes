import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { useTokens } from '../../contexts/ThemeContext';
import type { SectionTabColor } from '../explore/exploreShared';

export interface SectionTab {
  id: string;
  label: string;
  shortLabel?: string;
  color?: SectionTabColor;
}

interface SectionTabsProps {
  tabs: readonly SectionTab[];
  value: string;
  onChange: (id: string) => void;
  testID?: string;
  renderLabel?: (tab: SectionTab, isActive: boolean) => React.ReactNode;
}

const COLOR_MAP: Record<SectionTabColor, keyof ReturnType<typeof useTokens>['colors']> = {
  success: 'success',
  warning: 'warning',
  primary: 'primary',
  accent: 'accent',
};

export function SectionTabs({ tabs, value, onChange, testID, renderLabel }: SectionTabsProps) {
  const { colors, spacing, type } = useTokens();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', gap: 0 }}
      style={{ flexGrow: 0 }}
      testID={testID}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === value;
        const activeColor = tab.color ? colors[COLOR_MAP[tab.color]] : colors.accent;
        return (
          <Pressable
            key={tab.id}
            testID={`explore.tab.${tab.id}`}
            onPress={() => onChange(tab.id)}
            style={{
              paddingHorizontal: spacing[3] + 2,
              paddingVertical: spacing[2],
              borderBottomWidth: 2,
              borderBottomColor: isActive ? activeColor : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: type.sm - 1,
                fontWeight: isActive ? '600' : '500',
                color: isActive ? activeColor : colors.textSecondary,
              }}
            >
              {renderLabel ? renderLabel(tab, isActive) : tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
