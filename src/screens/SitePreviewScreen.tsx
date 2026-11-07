import React, { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import SitePreviewFrame from '../components/site/SitePreviewFrame';
import { ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { useTheme } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import { useSiteArtifact } from '../hooks/useSiteArtifact';
import { SAMPLE_NOTES } from '../services/site/siteSample';
import { useNoteStore } from '../stores/noteStore';
import { useSitePublishStore } from '../stores/sitePublishStore';

export default function SitePreviewScreen() {
  const { t } = useTranslation();
  const safeBack = useSafeBack();
  const { colors } = useTheme();
  const headerHeight = useScreenHeaderHeight();
  const blocked = useProScreenGuard();

  const notes = useNoteStore((s) => s.notes);
  const config = useSitePublishStore((s) => s.config);
  const noteIds = useSitePublishStore((s) => s.noteIds);

  const selected = useMemo(() => {
    const chosen = new Set(noteIds);
    return notes.filter((n) => chosen.has(n.id) && (n.format ?? 'markdown') !== 'pdf');
  }, [notes, noteIds]);
  const usingSample = selected.length === 0;
  const { artifact, error } = useSiteArtifact(usingSample ? SAMPLE_NOTES : selected, config, 0);

  if (blocked) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScreenHeader title={t('publishSite.previewTitle')} subtitle={usingSample ? t('publishSite.sampleContent') : undefined} onBack={safeBack} />
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        {artifact ? (
          <SitePreviewFrame artifact={artifact} style={{ flex: 1 }} testID="site-preview.frame" />
        ) : error ? (
          <Text className="p-4 text-sm" style={{ color: colors.error }}>
            {error}
          </Text>
        ) : (
          <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
        )}
      </View>
    </SafeAreaView>
  );
}
