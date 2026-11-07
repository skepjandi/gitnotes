import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Group, GroupRow, ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { FlatList } from '@/components/ui/flat-list';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import NavLinksEditor from '../components/site/NavLinksEditor';
import { TextFieldRow } from '../components/site/SiteControls';
import { useTheme } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import { useSiteArtifact } from '../hooks/useSiteArtifact';
import type { Note } from '../models/Note';
import type { RootStackParamList } from '../navigation/types';
import { SiteProRequiredError, SiteShareUnavailableError, shareSiteZip } from '../services/site/siteExport';
import { SiteWarning } from '../services/site/siteTypes';
import { useNoteStore } from '../stores/noteStore';
import { useSitePublishStore } from '../stores/sitePublishStore';
import { promptProUpgrade } from '../utils/proAlerts';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PublishSite'>;

const HOSTS = [
  { id: 'netlify', url: 'https://app.netlify.com/drop' },
  { id: 'cloudflare', url: 'https://developers.cloudflare.com/pages/get-started/direct-upload/' },
  { id: 'github', url: 'https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site' },
] as const;

const ACTION_BAR_HEIGHT = 84;
const MAX_LISTED_WARNINGS = 5;

function isPublishable(note: Note): boolean {
  return (note.format ?? 'markdown') !== 'pdf';
}

export default function PublishSiteScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const safeBack = useSafeBack();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useScreenHeaderHeight();
  const blocked = useProScreenGuard();

  const notes = useNoteStore((s) => s.notes);
  const config = useSitePublishStore((s) => s.config);
  const noteIds = useSitePublishStore((s) => s.noteIds);
  const updateConfig = useSitePublishStore((s) => s.updateConfig);
  const toggleNote = useSitePublishStore((s) => s.toggleNote);
  const setNoteIds = useSitePublishStore((s) => s.setNoteIds);

  const [filter, setFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const publishable = useMemo(() => notes.filter(isPublishable), [notes]);
  const selectedSet = useMemo(() => new Set(noteIds), [noteIds]);
  const selectedNotes = useMemo(() => publishable.filter((n) => selectedSet.has(n.id)), [publishable, selectedSet]);
  const visibleNotes = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return publishable;
    return publishable.filter((n) => n.title.toLowerCase().includes(query) || n.tags.some((tag) => tag.toLowerCase().includes(query)));
  }, [publishable, filter]);

  const { artifact, building, error } = useSiteArtifact(selectedNotes, config);
  const canExport = selectedNotes.length > 0 && !!artifact && !building && !exporting;

  const handleExport = useCallback(async () => {
    if (!artifact) return;
    setExporting(true);
    try {
      await shareSiteZip(artifact, config.title);
    } catch (e) {
      if (e instanceof SiteProRequiredError) {
        promptProUpgrade(t, () => navigation.navigate('Paywall'));
      } else if (e instanceof SiteShareUnavailableError) {
        Alert.alert(t('publishSite.exportFailedTitle'), t('publishSite.shareUnavailable'));
      } else {
        Alert.alert(t('publishSite.exportFailedTitle'), t('publishSite.exportFailedBody', { message: e instanceof Error ? e.message : String(e) }));
      }
    } finally {
      setExporting(false);
    }
  }, [artifact, config.title, navigation, t]);

  const describeWarning = useCallback(
    (w: SiteWarning) => t(`publishSite.warning.${w.code}`, { note: w.noteTitle ?? '', detail: w.detail ?? '' }),
    [t],
  );

  const renderNote = useCallback(
    ({ item }: { item: Note }) => {
      const selected = selectedSet.has(item.id);
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={item.title || t('common.untitled')}
          onPress={() => toggleNote(item.id)}
          className="flex-row items-center gap-3 px-4 py-3 mx-3"
          style={{ borderBottomWidth: 0.5, borderBottomColor: colors.border }}
          testID={`publish-site.note.${item.id}`}
        >
          <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.primary : colors.textSecondary} />
          <View className="flex-1">
            <Text className="text-[15px]" style={{ color: colors.text }} numberOfLines={1}>
              {item.title || t('common.untitled')}
            </Text>
            {item.tags.length ? (
              <Text className="text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
                {item.tags.join(' · ')}
              </Text>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [colors, selectedSet, t, toggleNote],
  );

  if (blocked) return null;

  const header = (
    <View className="gap-5 pb-3" style={{ paddingTop: headerHeight + 8 }}>
      <Text className="text-sm px-4" style={{ color: colors.textSecondary }}>
        {t('publishSite.intro')}
      </Text>

      <Group title={t('publishSite.design')} style={{ marginHorizontal: 12 }}>
        <GroupRow
          testID="publish-site.customize-design"
          onPress={() => navigation.navigate('SiteThemeEditor')}
          leading={<Ionicons name="color-palette-outline" size={20} color={colors.text} />}
          trailing={<Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />}
        >
          <View>
            <Text className="text-[15px]" style={{ color: colors.text }}>
              {t('publishSite.customizeDesign')}
            </Text>
            <Text className="text-xs" style={{ color: colors.textSecondary }}>
              {t(`publishSite.theme.presets.${config.presetId}`)}
            </Text>
          </View>
        </GroupRow>
      </Group>

      <Group title={t('publishSite.siteDetails')} style={{ marginHorizontal: 12 }}>
        <TextFieldRow label={t('publishSite.siteTitle')} value={config.title} maxLength={80} onCommit={(title) => updateConfig({ title })} testID="publish-site.title" />
        <TextFieldRow label={t('publishSite.tagline')} value={config.tagline} maxLength={160} onCommit={(tagline) => updateConfig({ tagline })} />
        <TextFieldRow label={t('publishSite.author')} value={config.author} maxLength={80} onCommit={(author) => updateConfig({ author })} />
        <TextFieldRow label={t('publishSite.footer')} value={config.footer} maxLength={240} onCommit={(footer) => updateConfig({ footer })} />
        <TextFieldRow label={t('publishSite.favicon')} value={config.faviconEmoji} maxLength={8} onCommit={(faviconEmoji) => updateConfig({ faviconEmoji })} />
        <TextFieldRow
          label={t('publishSite.baseUrl')}
          value={config.baseUrl}
          placeholder="https://example.com"
          autoCapitalize="none"
          hint={t('publishSite.baseUrlHint')}
          validate={(draft) => (/^https:\/\/[^\s/]+(\/[^\s?#]*)?\/?$/i.test(draft.trim()) ? null : t('publishSite.invalidBaseUrl'))}
          onCommit={(baseUrl) => updateConfig({ baseUrl })}
          testID="publish-site.base-url"
        />
        <NavLinksEditor links={config.navLinks} onChange={(navLinks) => updateConfig({ navLinks })} />
      </Group>

      <View className="px-4 flex-row items-center justify-between">
        <Text className="text-sm font-semibold uppercase" style={{ color: colors.textSecondary, letterSpacing: 0.6 }}>
          {t('publishSite.notes')}
        </Text>
        <View className="flex-row gap-4">
          <Pressable accessibilityRole="button" onPress={() => setNoteIds(publishable.map((n) => n.id))} testID="publish-site.select-all">
            <Text className="text-sm font-medium" style={{ color: colors.primary }}>
              {t('publishSite.selectAll')}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setNoteIds([])} testID="publish-site.clear">
            <Text className="text-sm font-medium" style={{ color: colors.primary }}>
              {t('publishSite.clearSelection')}
            </Text>
          </Pressable>
        </View>
      </View>
      <View className="px-3 -mt-2">
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder={t('publishSite.filterNotes')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('publishSite.filterNotes')}
          className="rounded-sm px-3 py-2 text-[15px]"
          style={{ color: colors.text, backgroundColor: colors.surfaceSecondary }}
        />
        <Text className="text-xs mt-2 px-1" style={{ color: colors.textSecondary }} testID="publish-site.count">
          {t('publishSite.notesSelected', { count: selectedNotes.length, total: publishable.length })}
        </Text>
      </View>
    </View>
  );

  const warnings = artifact?.warnings ?? [];
  const footer = (
    <View className="gap-5 pt-5">
      {error ? (
        <Text className="px-4 text-sm" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      {warnings.length ? (
        <Group title={t('publishSite.warnings', { count: warnings.length })} style={{ marginHorizontal: 12 }}>
          {warnings.slice(0, MAX_LISTED_WARNINGS).map((w, i) => (
            <View key={i} className="px-4 py-2">
              <Text className="text-xs" style={{ color: colors.textSecondary }}>
                {describeWarning(w)}
              </Text>
            </View>
          ))}
        </Group>
      ) : null}
      <Group title={t('publishSite.hostTitle')} footer={t('publishSite.publicWarning')} style={{ marginHorizontal: 12 }}>
        {HOSTS.map((host) => (
          <GroupRow
            key={host.id}
            onPress={() => void WebBrowser.openBrowserAsync(host.url)}
            leading={<Ionicons name="globe-outline" size={20} color={colors.text} />}
            trailing={<Ionicons name="open-outline" size={18} color={colors.textSecondary} />}
            testID={`publish-site.host.${host.id}`}
          >
            <View>
              <Text className="text-[15px]" style={{ color: colors.text }}>
                {t(`publishSite.hosts.${host.id}.name`)}
              </Text>
              <Text className="text-xs" style={{ color: colors.textSecondary }}>
                {t(`publishSite.hosts.${host.id}.steps`)}
              </Text>
            </View>
          </GroupRow>
        ))}
      </Group>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScreenHeader title={t('publishSite.title')} badge="PRO" onBack={safeBack} />
      <FlatList
        data={visibleNotes}
        keyExtractor={(n) => n.id}
        renderItem={renderNote}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <Text className="text-center text-sm py-6" style={{ color: colors.textSecondary }}>
            {t('publishSite.noNotes')}
          </Text>
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: ACTION_BAR_HEIGHT + insets.bottom + 16 }}
      />
      <View
        className="absolute left-0 right-0 bottom-0 flex-row gap-3 px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12, backgroundColor: colors.surface, borderTopWidth: 0.5, borderTopColor: colors.border }}
      >
        <View className="flex-1">
          <Button
            label={t('publishSite.preview')}
            variant="outline"
            fullWidth
            onPress={() => navigation.navigate('SitePreview')}
            testID="publish-site.preview"
          />
        </View>
        <View className="flex-1">
          <Button
            label={exporting || building ? t('publishSite.building') : t('publishSite.export')}
            fullWidth
            disabled={!canExport}
            leadingIcon={exporting || building ? <ActivityIndicator size="small" color={colors.text} /> : undefined}
            onPress={() => void handleExport()}
            testID="publish-site.export"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
