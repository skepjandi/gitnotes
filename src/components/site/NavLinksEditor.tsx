import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../contexts/ThemeContext';
import { isSafeNavUrl, MAX_NAV_LINKS, SiteNavLink } from '../../services/site/siteTypes';
import { ControlLabel } from './SiteControls';

interface Props {
  links: SiteNavLink[];
  onChange: (links: SiteNavLink[]) => void;
}

/**
 * Keeps in-progress rows locally and publishes only complete, safe ones, so a
 * half-typed URL is neither lost nor written into the site config.
 */
export default function NavLinksEditor({ links, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [drafts, setDrafts] = useState<SiteNavLink[]>(links);

  const update = (next: SiteNavLink[]) => {
    setDrafts(next);
    onChange(next.filter((l) => l.label.trim() && isSafeNavUrl(l.url)));
  };

  const inputStyle = { color: colors.text, backgroundColor: colors.surfaceSecondary };

  return (
    <View className="px-4 py-3" testID="publish-site.nav-links">
      <ControlLabel>{t('publishSite.navLinks')}</ControlLabel>
      {drafts.map((link, index) => {
        const invalidUrl = link.url.length > 0 && !isSafeNavUrl(link.url);
        return (
          <View key={index} className="mb-3">
            <View className="flex-row items-center gap-2">
              <TextInput
                value={link.label}
                onChangeText={(label) => update(drafts.map((d, i) => (i === index ? { ...d, label } : d)))}
                placeholder={t('publishSite.navLabel')}
                placeholderTextColor={colors.textSecondary}
                maxLength={40}
                accessibilityLabel={t('publishSite.navLabel')}
                className="rounded-sm px-3 py-2 text-[15px] w-[34%]"
                style={inputStyle}
              />
              <TextInput
                value={link.url}
                onChangeText={(url) => update(drafts.map((d, i) => (i === index ? { ...d, url } : d)))}
                placeholder="https://"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t('publishSite.navUrl')}
                className="rounded-sm px-3 py-2 text-[15px] flex-1"
                style={inputStyle}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('publishSite.removeLink')}
                onPress={() => update(drafts.filter((_, i) => i !== index))}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            {invalidUrl ? (
              <Text className="text-xs mt-1" style={{ color: colors.error }}>
                {t('publishSite.invalidUrl')}
              </Text>
            ) : null}
          </View>
        );
      })}
      {drafts.length < MAX_NAV_LINKS ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setDrafts([...drafts, { label: '', url: '' }])}
          className="flex-row items-center gap-2"
          testID="publish-site.nav-links.add"
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text className="text-[15px] font-medium" style={{ color: colors.primary }}>
            {t('publishSite.addLink')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
