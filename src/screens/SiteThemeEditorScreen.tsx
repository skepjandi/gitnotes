import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import HexColorPickerModal from '../components/HexColorPickerModal';
import SitePreviewFrame from '../components/site/SitePreviewFrame';
import { ChoiceOption, ChoiceRow, ColorRow, StepperRow, TextFieldRow, ToggleRow } from '../components/site/SiteControls';
import { Chip, Group, IconButton, ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import { useSiteArtifact } from '../hooks/useSiteArtifact';
import type { RootStackParamList } from '../navigation/types';
import { SAMPLE_NOTES } from '../services/site/siteSample';
import { SITE_PRESETS } from '../services/site/siteThemes';
import {
  CUSTOM_CSS_MAX_LENGTH,
  SITE_COLOR_MODES,
  SITE_FONT_KEYS,
  SITE_HEADER_STYLES,
  SITE_INDEX_LAYOUTS,
  SITE_LINK_STYLES,
  SITE_PRESET_IDS,
  SitePaletteKey,
} from '../services/site/siteTypes';
import { useNoteStore } from '../stores/noteStore';
import { useSitePublishStore } from '../stores/sitePublishStore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'SiteThemeEditor'>;

const PREVIEW_HEIGHT = 240;
const PREVIEW_NOTE_COUNT = 3;
const PER_MODE_COLORS: readonly SitePaletteKey[] = ['background', 'surface', 'text', 'muted', 'border', 'link', 'codeBackground'];

type PickerTarget = { key: SitePaletteKey } | null;

export default function SiteThemeEditorScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const safeBack = useSafeBack();
  const { colors } = useTheme();
  const headerHeight = useScreenHeaderHeight();
  const blocked = useProScreenGuard();

  const notes = useNoteStore((s) => s.notes);
  const config = useSitePublishStore((s) => s.config);
  const noteIds = useSitePublishStore((s) => s.noteIds);
  const { updateConfig, setPreset, setAccent, setPaletteColor } = useSitePublishStore.getState();

  const [editMode, setEditMode] = useState<'light' | 'dark'>('light');
  const [picker, setPicker] = useState<PickerTarget>(null);

  const previewNotes = useMemo(() => {
    const chosen = new Set(noteIds);
    const own = notes.filter((n) => chosen.has(n.id) && (n.format ?? 'markdown') !== 'pdf').slice(0, PREVIEW_NOTE_COUNT);
    return own.length ? own : SAMPLE_NOTES;
  }, [notes, noteIds]);
  const { artifact, building } = useSiteArtifact(previewNotes, config, 350);

  const options = <T extends string>(values: readonly T[], group: string): ChoiceOption<T>[] =>
    values.map((value) => ({ value, label: t(`publishSite.theme.${group}.${value}`) }));

  if (blocked) return null;

  const palette = config.colors[editMode];
  const pickerColor = picker ? (picker.key === 'accent' ? config.colors.light.accent : palette[picker.key]) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScreenHeader
        title={t('publishSite.theme.title')}
        badge="PRO"
        onBack={safeBack}
        actions={
          <IconButton size="sm" onPress={() => navigation.navigate('SitePreview')} accessibilityLabel={t('publishSite.preview')} testID="site-theme.open-preview">
            <Ionicons name="expand-outline" size={18} color={colors.primary} />
          </IconButton>
        }
      />

      <View style={{ marginTop: headerHeight, height: PREVIEW_HEIGHT, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {artifact ? (
          <SitePreviewFrame artifact={artifact} style={{ flex: 1 }} testID="site-theme.preview" />
        ) : (
          <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
        )}
        {building && artifact ? <ActivityIndicator size="small" color={colors.primary} style={{ position: 'absolute', top: 8, right: 8 }} /> : null}
      </View>

      <ScrollView contentContainerClassName="gap-5 py-4 pb-12" keyboardShouldPersistTaps="handled">
        <Group title={t('publishSite.theme.presetsTitle')} style={{ marginHorizontal: 12 }}>
          <View className="flex-row flex-wrap gap-2 px-4 py-3" testID="site-theme.presets">
            {SITE_PRESET_IDS.map((id) => (
              <Chip
                key={id}
                label={t(`publishSite.theme.presets.${id}`)}
                active={config.presetId === id}
                onPress={() => setPreset(id)}
                leading={<View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: SITE_PRESETS[id].colors.light.accent }} />}
                testID={`site-theme.preset.${id}`}
              />
            ))}
          </View>
        </Group>

        <Group title={t('publishSite.theme.colorsTitle')} style={{ marginHorizontal: 12 }}>
          <ChoiceRow
            label={t('publishSite.theme.colorMode')}
            value={config.colorMode}
            options={options(SITE_COLOR_MODES, 'colorModes')}
            onChange={(colorMode) => updateConfig({ colorMode })}
            testID="site-theme.color-mode"
          />
          <ColorRow label={t('publishSite.theme.accent')} color={config.colors.light.accent} onPress={() => setPicker({ key: 'accent' })} testID="site-theme.accent" />
          <ChoiceRow
            label={t('publishSite.theme.editPalette')}
            value={editMode}
            options={[
              { value: 'light', label: t('publishSite.theme.colorModes.light') },
              { value: 'dark', label: t('publishSite.theme.colorModes.dark') },
            ]}
            onChange={setEditMode}
            testID="site-theme.edit-mode"
          />
          {PER_MODE_COLORS.map((key) => (
            <ColorRow key={key} label={t(`publishSite.theme.palette.${key}`)} color={palette[key]} onPress={() => setPicker({ key })} testID={`site-theme.color.${key}`} />
          ))}
        </Group>

        <Group title={t('publishSite.theme.typographyTitle')} style={{ marginHorizontal: 12 }}>
          <ChoiceRow label={t('publishSite.theme.bodyFont')} value={config.bodyFont} options={options(SITE_FONT_KEYS, 'fonts')} onChange={(bodyFont) => updateConfig({ bodyFont })} testID="site-theme.body-font" />
          <ChoiceRow label={t('publishSite.theme.headingFont')} value={config.headingFont} options={options(SITE_FONT_KEYS, 'fonts')} onChange={(headingFont) => updateConfig({ headingFont })} testID="site-theme.heading-font" />
          <StepperRow label={t('publishSite.theme.textSize')} value={config.fontScale} min={0.85} max={1.4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(fontScale) => updateConfig({ fontScale })} testID="site-theme.font-scale" />
          <StepperRow label={t('publishSite.theme.lineHeight')} value={config.lineHeight} min={1.3} max={2.1} step={0.1} format={(v) => v.toFixed(1)} onChange={(lineHeight) => updateConfig({ lineHeight })} testID="site-theme.line-height" />
          <StepperRow label={t('publishSite.theme.contentWidth')} value={config.contentWidth} min={480} max={1100} step={40} format={(v) => `${v}px`} onChange={(contentWidth) => updateConfig({ contentWidth })} testID="site-theme.content-width" />
        </Group>

        <Group title={t('publishSite.theme.layoutTitle')} style={{ marginHorizontal: 12 }}>
          <StepperRow label={t('publishSite.theme.cornerRadius')} value={config.radius} min={0} max={28} step={2} format={(v) => `${v}px`} onChange={(radius) => updateConfig({ radius })} testID="site-theme.radius" />
          <ChoiceRow label={t('publishSite.theme.headerStyle')} value={config.headerStyle} options={options(SITE_HEADER_STYLES, 'headerStyles')} onChange={(headerStyle) => updateConfig({ headerStyle })} testID="site-theme.header-style" />
          <ChoiceRow label={t('publishSite.theme.indexLayout')} value={config.indexLayout} options={options(SITE_INDEX_LAYOUTS, 'indexLayouts')} onChange={(indexLayout) => updateConfig({ indexLayout })} testID="site-theme.index-layout" />
          <ChoiceRow label={t('publishSite.theme.linkStyle')} value={config.linkStyle} options={options(SITE_LINK_STYLES, 'linkStyles')} onChange={(linkStyle) => updateConfig({ linkStyle })} testID="site-theme.link-style" />
        </Group>

        <Group title={t('publishSite.theme.detailsTitle')} style={{ marginHorizontal: 12 }}>
          <ToggleRow label={t('publishSite.theme.showDates')} value={config.showDates} onChange={(showDates) => updateConfig({ showDates })} testID="site-theme.show-dates" />
          <ToggleRow label={t('publishSite.theme.showTags')} value={config.showTags} onChange={(showTags) => updateConfig({ showTags })} testID="site-theme.show-tags" />
          <ToggleRow label={t('publishSite.theme.showReadingTime')} value={config.showReadingTime} onChange={(showReadingTime) => updateConfig({ showReadingTime })} testID="site-theme.show-reading-time" />
          <ToggleRow label={t('publishSite.theme.showToc')} value={config.showToc} onChange={(showToc) => updateConfig({ showToc })} testID="site-theme.show-toc" />
          <ToggleRow label={t('publishSite.theme.showPrevNext')} value={config.showPrevNext} onChange={(showPrevNext) => updateConfig({ showPrevNext })} testID="site-theme.show-prev-next" />
        </Group>

        <Group title={t('publishSite.theme.advancedTitle')} style={{ marginHorizontal: 12 }}>
          <TextFieldRow
            label={t('publishSite.theme.customCss')}
            value={config.customCss}
            multiline
            maxLength={CUSTOM_CSS_MAX_LENGTH}
            autoCapitalize="none"
            placeholder="a { text-decoration: underline wavy; }"
            hint={t('publishSite.theme.customCssHint')}
            onCommit={(customCss) => updateConfig({ customCss })}
            testID="site-theme.custom-css"
          />
        </Group>

        <Text className="px-4 text-xs" style={{ color: colors.textSecondary }}>
          {t('publishSite.theme.previewHint')}
        </Text>
      </ScrollView>

      <HexColorPickerModal
        visible={picker !== null}
        initialColor={pickerColor}
        title={picker ? t(picker.key === 'accent' ? 'publishSite.theme.accent' : `publishSite.theme.palette.${picker.key}`) : undefined}
        onClose={() => setPicker(null)}
        onSelect={(hex) => {
          if (hex && picker) {
            if (picker.key === 'accent') setAccent(hex);
            else setPaletteColor(editMode, picker.key, hex);
          }
          setPicker(null);
        }}
      />
    </SafeAreaView>
  );
}
