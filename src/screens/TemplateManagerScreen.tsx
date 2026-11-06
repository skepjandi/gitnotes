import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../contexts/ThemeContext';
import { useResponsive } from '../hooks/useResponsive';
import { ScreenHeader, IconButton, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { useTemplateStore } from '../stores/templateStore';
import { NoteTemplate, NoteTemplateIcon } from '../services/TemplateService';
import { HapticService } from '../utils/haptics';
import { TemplateRepoPreferenceService, TemplateRepoPreference } from '../services/TemplateRepoPreferenceService';
import { pullTemplatesFromConfiguredRepo } from '../services/RepoPullService';
import {
  commitPendingTag,
  parseTagInput,
} from '../utils/templateTags';
import { TemplateEditorModal } from '../components/templates/TemplateEditorModal';
import { TemplateListItem } from '../components/templates/TemplateListItem';
import { TemplatesEmptyState } from '../components/templates/TemplatesEmptyState';
import { DEFAULT_ICON } from '../components/templates/templateManagerShared';
import { RADII, readableInk } from '../theme/tokens';
import { useTranslation } from 'react-i18next';
import { useProScreenGuard } from '../hooks/useProScreenGuard';

export default function TemplateManagerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { isTablet } = useResponsive();
  const headerHeight = useScreenHeaderHeight({ subtitle: true });

  const customTemplates = useTemplateStore((s) => s.customTemplates);
  const pinnedIds = useTemplateStore((s) => s.pinnedIds);
  const loadTemplates = useTemplateStore((s) => s.loadTemplates);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const togglePin = useTemplateStore((s) => s.togglePin);
  const getAllTemplates = useTemplateStore((s) => s.getAllTemplates);

  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftIcon, setDraftIcon] = useState<NoteTemplateIcon>(DEFAULT_ICON);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [templatesRepoPref, setTemplatesRepoPref] = useState<TemplateRepoPreference | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const isFocused = useIsFocused();

  // Reset refresh state when screen loses focus (tab switch, stack push, etc.)
  useEffect(() => {
    if (!isFocused) {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [isFocused]);

  useEffect(() => {
    loadTemplates();
    TemplateRepoPreferenceService.get().then(setTemplatesRepoPref);
  }, [loadTemplates]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);

    const safetyTimeout = setTimeout(() => {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }, 30000);

    try {
      await pullTemplatesFromConfiguredRepo();
      await loadTemplates();
    } catch (err) {
      console.warn('[TemplateManager] Refresh failed:', err);
    } finally {
      clearTimeout(safetyTimeout);
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [loadTemplates]);

  const allTemplates = useMemo(
    () => getAllTemplates(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customTemplates, pinnedIds, getAllTemplates],
  );

  const resetDraft = useCallback(() => {
    setEditingId(null);
    setDraftName('');
    setDraftContent('');
    setDraftIcon(DEFAULT_ICON);
    setDraftDescription('');
    setDraftTitle('');
    setDraftTags([]);
    setTagDraft('');
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetDraft();
    setShowEditor(true);
  }, [resetDraft]);

  const handleOpenEdit = useCallback((template: NoteTemplate) => {
    setEditingId(template.id);
    setDraftName(template.name);
    setDraftContent(template.content);
    setDraftIcon(template.icon ?? DEFAULT_ICON);
    setDraftDescription(template.description ?? '');
    setDraftTitle(template.title ?? '');
    setDraftTags(template.tags ?? []);
    setTagDraft('');
    setShowEditor(true);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setShowEditor(false);
  }, []);

  const handleTagInputChange = useCallback(
    (text: string) => {
      const { committed, remainder } = parseTagInput(text, draftTags);
      if (committed.length !== draftTags.length) {
        setDraftTags(committed);
      }
      setTagDraft(remainder);
    },
    [draftTags],
  );

  const handleTagSubmit = useCallback(() => {
    const next = commitPendingTag(tagDraft, draftTags);
    setDraftTags(next);
    setTagDraft('');
  }, [tagDraft, draftTags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setDraftTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleSave = useCallback(async () => {
    const name = draftName.trim();
    if (!name) {
      Alert.alert(t('templates.nameRequiredTitle'), t('templates.nameRequiredBody'));
      return;
    }
    const description = draftDescription.trim();
    const trimmedTitle = draftTitle.trim();
    const title = trimmedTitle ? draftTitle : '';
    const finalTags = commitPendingTag(tagDraft, draftTags);

    try {
      if (editingId) {
        await updateTemplate(editingId, {
          name,
          icon: draftIcon,
          description,
          title: title || undefined,
          content: draftContent,
          tags: finalTags,
        });
      } else {
        await createTemplate({
          name,
          icon: draftIcon,
          description,
          title: title || undefined,
          content: draftContent,
          tags: finalTags,
        });
      }

      HapticService.success();
      setShowEditor(false);
    } catch (error) {
      console.error('[TemplateManagerScreen] save failed', error);
      HapticService.error();
      Alert.alert(t('templates.saveFailedTitle'), t('templates.saveFailedBody'));
    }
  }, [
    draftName,
    draftDescription,
    draftTitle,
    draftIcon,
    draftContent,
    draftTags,
    tagDraft,
    editingId,
    createTemplate,
    updateTemplate,
    t,
  ]);

  const handleDelete = useCallback(
    (template: NoteTemplate) => {
      if (!template.isCustom) return;
      Alert.alert(
        t('templates.deleteConfirmTitle'),
        t('templates.deleteConfirmBody', { name: template.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              await deleteTemplate(template.id);
              HapticService.success();
            },
          },
        ],
      );
    },
    [deleteTemplate, t],
  );

  const handleTogglePin = useCallback(
    async (template: NoteTemplate) => {
      await togglePin(template.id);
    },
    [togglePin],
  );

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  const customCount = customTemplates.length;

  const blocked = useProScreenGuard();

  if (blocked) return null;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: isTablet ? 24 : 16, paddingTop: 16, paddingBottom: 40, gap: 10, flexGrow: 1 }}
        style={{ paddingTop: headerHeight }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          templatesRepoPref ? (
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          ) : undefined
        }
      >
        <TouchableOpacity
          testID="template-manager.button.create"
          onPress={handleOpenCreate}
          className="flex-row items-center justify-center py-3 gap-1.5"
          style={{ backgroundColor: colors.primary, borderRadius: RADII.sm }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color={readableInk(colors.primary)} />
          <Text className="text-[15px] font-semibold" style={{ color: readableInk(colors.primary) }}>{t('templates.newTemplate')}</Text>
        </TouchableOpacity>

        {allTemplates.length === 0
          ? <TemplatesEmptyState />
          : allTemplates.map((template) => (
              <TemplateListItem
                key={template.id}
                template={template}
                pinned={pinnedIds.includes(template.id)}
                onTogglePin={handleTogglePin}
                onEdit={handleOpenEdit}
                onDelete={handleDelete}
              />
            ))}
      </ScrollView>

      <TemplateEditorModal
        visible={showEditor}
        editingId={editingId}
        draftName={draftName}
        draftContent={draftContent}
        draftIcon={draftIcon}
        draftDescription={draftDescription}
        draftTitle={draftTitle}
        draftTags={draftTags}
        tagDraft={tagDraft}
        onClose={handleCloseEditor}
        onSave={handleSave}
        onNameChange={setDraftName}
        onContentChange={setDraftContent}
        onIconChange={setDraftIcon}
        onDescriptionChange={setDraftDescription}
        onTitleChange={setDraftTitle}
        onTagInputChange={handleTagInputChange}
        onTagSubmit={handleTagSubmit}
        onRemoveTag={handleRemoveTag}
      />
      <ScreenHeader
        title={t('settings.templates')}
        subtitle={
          templatesRepoPref
            ? t('templates.subtitle', { total: allTemplates.length, custom: customCount, repo: templatesRepoPref.repoPath })
            : t('templates.subtitleNoRepo', { total: allTemplates.length, custom: customCount })
        }
        onBack={handleBack}
        actions={
          <IconButton size="sm" testID="template-manager.icon-button.new-template" onPress={handleOpenCreate} accessibilityLabel={t('templates.newTemplateA11y')}>
            <Ionicons name="add" size={20} color={colors.accent} />
          </IconButton>
        }
      />
    </SafeAreaView>
  );
}
