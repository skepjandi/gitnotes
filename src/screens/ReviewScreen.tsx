import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { useTokens } from '../contexts/ThemeContext';
import { Button, EmptyState, ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { FileChangeRow } from '../components/review/FileChangeRow';
import { PatchView } from '../components/review/PatchView';
import { groupChanges } from '../components/review/groupChanges';
import { useSafeBack } from '../hooks/useSafeBack';
import { bridgeTools, type GitDiff, type GitStatus } from '../services/agent/bridgeTools';
import { BridgeError } from '../services/agent/types';
import { HapticService } from '../utils/haptics';
import type { RootStackParamList } from '../navigation/types';

type RouteProps = RouteProp<RootStackParamList, 'ReviewScreen'>;
type Section = 'staged' | 'changes' | 'untracked';
type DiffEntry = { patch: GitDiff } | { error: string } | 'loading';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ReviewScreen() {
  const { t } = useTranslation();
  const safeBack = useSafeBack();
  const { bridgeId, cwd, path: initialPath } = useRoute<RouteProps>().params;
  const { colors, spacing, type } = useTokens();
  const headerHeight = useScreenHeaderHeight({ subtitle: true });

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<BridgeError | Error | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [diffs, setDiffs] = useState<Record<string, DiffEntry>>({});
  const autoOpened = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await bridgeTools.gitStatus(bridgeId, cwd);
      setStatus(next);
      setLoadError(null);
      setDiffs({});
    } catch (error) {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [bridgeId, cwd]);

  useEffect(() => {
    let cancelled = false;
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const grouped = useMemo(() => groupChanges(status?.files ?? []), [status]);

  useEffect(() => {
    if (autoOpened.current || !status || !initialPath) return;
    autoOpened.current = true;
    const file = grouped.changes.find((f) => f.path === initialPath) ?? grouped.staged.find((f) => f.path === initialPath) ?? grouped.untracked.find((f) => f.path === initialPath);
    if (!file) return;
    const section: Section = file.status === 'untracked' ? 'untracked' : grouped.changes.includes(file) ? 'changes' : 'staged';
    setOpen(new Set([`${section}:${file.path}`]));
  }, [status, grouped, initialPath]);

  useEffect(() => {
    for (const key of open) {
      if (diffs[key]) continue;
      const separator = key.indexOf(':');
      const section = key.slice(0, separator);
      const filePath = key.slice(separator + 1);
      setDiffs((previous) => ({ ...previous, [key]: 'loading' }));
      bridgeTools.gitDiff(bridgeId, cwd, filePath, section === 'staged').then(
        (patch) => setDiffs((previous) => ({ ...previous, [key]: { patch } })),
        (error: unknown) => setDiffs((previous) => ({ ...previous, [key]: { error: errorMessage(error) } })),
      );
    }
  }, [open, diffs, bridgeId, cwd]);

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setBanner(null);
      try {
        await action();
        await reload();
      } catch (error) {
        setBanner(errorMessage(error));
        void HapticService.error();
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setBanner(null);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const toggleOpen = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const trimmed = message.trim();
  const canCommit = grouped.staged.length > 0 && trimmed.length > 0 && !busy;

  const commit = () =>
    act(async () => {
      await bridgeTools.gitCommit(bridgeId, cwd, trimmed);
      setMessage('');
      void HapticService.success();
    });

  const repoName = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
  const subtitle = status
    ? [
        status.branch ?? t('review.detached'),
        status.ahead > 0 ? `↑${status.ahead}` : null,
        status.behind > 0 ? `↓${status.behind}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  const renderSection = (section: Section, files: typeof grouped.staged, bulk?: { label: string; testID: string; onPress: () => void }) =>
    files.length === 0 ? null : (
      <View key={section} testID={`review.section.${section}`} style={{ marginBottom: spacing[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], marginBottom: spacing[1] }}>
          <Text
            accessibilityRole="header"
            style={{ flex: 1, color: colors.textSecondary, fontSize: type.xs, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' }}
          >
            {`${t(`review.section_${section}`)} ${files.length}`}
          </Text>
          {bulk ? (
            <Text
              testID={bulk.testID}
              accessibilityRole="button"
              onPress={busy ? undefined : bulk.onPress}
              style={{ color: colors.accent, fontSize: type.sm, fontWeight: '600', opacity: busy ? 0.4 : 1 }}
            >
              {bulk.label}
            </Text>
          ) : null}
        </View>
        {files.map((file) => {
          const key = `${section}:${file.path}`;
          const entry = diffs[key];
          return (
            <FileChangeRow
              key={key}
              file={file}
              section={section}
              expanded={open.has(key)}
              disabled={busy}
              onToggle={() => toggleOpen(key)}
              onStageToggle={() =>
                act(() =>
                  section === 'staged'
                    ? bridgeTools.gitUnstage(bridgeId, cwd, [file.path])
                    : bridgeTools.gitStage(bridgeId, cwd, [file.path]),
                )
              }
            >
              {!entry || entry === 'loading' ? (
                <ActivityIndicator testID="review.diff.loading" style={{ padding: spacing[3] }} color={colors.accent} />
              ) : 'error' in entry ? (
                <Text testID="review.diff.error" style={{ color: colors.error, fontSize: type.sm, padding: spacing[3] }}>
                  {entry.error}
                </Text>
              ) : (
                <PatchView patch={entry.patch.patch} truncated={entry.patch.truncated} />
              )}
            </FileChangeRow>
          );
        })}
      </View>
    );

  const renderBody = () => {
    if (loading) return <ActivityIndicator testID="review.loading" style={{ marginTop: spacing[8] }} color={colors.accent} />;
    if (loadError) {
      const code = loadError instanceof BridgeError ? loadError.code : undefined;
      if (code === 'not-a-repo') {
        return <EmptyState testID="review.notARepo" icon="folder-open-outline" title={t('review.notARepo')} subtitle={t('review.notARepoHint')} />;
      }
      if (code === 'unsupported') {
        return <EmptyState testID="review.unsupported" icon="cloud-download-outline" title={t('review.unsupported')} subtitle={t('review.unsupportedHint')} />;
      }
      return (
        <View testID="review.error" style={{ flex: 1 }}>
          <EmptyState icon="alert-circle-outline" title={t('review.loadFailed')} subtitle={loadError.message} />
          <Button
            testID="review.retry"
            variant="primary"
            label={t('common.retry')}
            onPress={() => void onRefresh()}
            style={{ alignSelf: 'center' }}
          />
        </View>
      );
    }
    if (!status || status.files.length === 0) {
      return <EmptyState testID="review.clean" icon="checkmark-circle-outline" title={t('review.clean')} />;
    }
    return (
      <>
        {renderSection('staged', grouped.staged, {
          label: t('review.unstageAll'),
          testID: 'review.unstage-all',
          onPress: () => void act(() => bridgeTools.gitUnstage(bridgeId, cwd, grouped.staged.map((f) => f.path))),
        })}
        {renderSection('changes', grouped.changes, {
          label: t('review.stageAll'),
          testID: 'review.stage-all',
          onPress: () => void act(() => bridgeTools.gitStage(bridgeId, cwd, grouped.changes.map((f) => f.path))),
        })}
        {renderSection('untracked', grouped.untracked, {
          label: t('review.stageAll'),
          testID: 'review.stage-all-untracked',
          onPress: () => void act(() => bridgeTools.gitStage(bridgeId, cwd, grouped.untracked.map((f) => f.path))),
        })}
      </>
    );
  };

  const showComposer = !loading && !loadError && !!status && status.files.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          testID="review.scroll"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: headerHeight + spacing[2], paddingBottom: spacing[6], flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} progressViewOffset={headerHeight} />}
        >
          {banner ? (
            <Text
              testID="review.banner"
              accessibilityRole="alert"
              style={{ color: colors.error, backgroundColor: `${colors.error}1f`, fontSize: type.sm, margin: spacing[4], padding: spacing[3], borderRadius: 8 }}
            >
              {banner}
            </Text>
          ) : null}
          {renderBody()}
        </ScrollView>
        {showComposer ? (
          <View style={{ padding: spacing[3], borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing[2] }}>
            <TextInput
              testID="review.commit-message"
              value={message}
              onChangeText={setMessage}
              placeholder={t('review.commitPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              multiline
              style={{ color: colors.text, fontSize: type.md, minHeight: 40, maxHeight: 120 }}
            />
            <Button
              testID="review.commit"
              label={t('review.commit', { count: grouped.staged.length })}
              disabled={!canCommit}
              onPress={() => void commit()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <ScreenHeader title={repoName} subtitle={subtitle} onBack={safeBack} testID="review.header" />
    </SafeAreaView>
  );
}
