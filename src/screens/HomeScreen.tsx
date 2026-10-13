import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../contexts/ThemeContext';
import { useNotes } from '../contexts/NoteContext';
import { useCanvases } from '../contexts/CanvasContext';
import { useRepos } from '../contexts/RepoContext';
import { requireRepo } from '../utils/requireRepo';
import { NoteFormat, NoteColor, Note } from '../models/Note';
import { parseRepoPath } from '../utils/gitPathParser';
import { HapticService } from '../utils/haptics';
import TemplateSelector from '../components/TemplateSelector';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { NoteTemplate } from '../services/TemplateService';
import { NoteFormatPreferenceService } from '../services/NoteFormatPreferenceService';
import {
  buildJournalEditorParams,
  findJournalEntry,
  isJournalEntry,
  journalNoteTitle,
} from '../services/JournalService';
import { useResponsive } from '../hooks/useResponsive';
import { Button, Card, Modal, ScreenHeader, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { BentoRecent } from '../components/home/BentoRecent';
import { QuickAccessShelf } from '../components/home/QuickAccessShelf';
import { HomeTile } from '../components/home/HomeTile';
import { buildPinnedFeed, buildRecentFeed, RecentItem } from '../utils/recentItems';
import { HomeNoteContextMenu } from '../components/home/HomeNoteContextMenu';
import ColorPicker from '../components/ColorPicker';
import { ShareFormat } from '../services/ShareService';
import { NoteSyncQueueService } from '../services/cloneSyncServiceImpl';
import { useTranslation } from 'react-i18next';
import { DailyQuoteCard } from '../components/home/DailyQuoteCard';
import { useDailyQuote } from '../hooks/useDailyQuote';
import { useProGate } from '../hooks/useProGate';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type EditableNoteFormat = Exclude<NoteFormat, 'pdf' | 'json'>;

const FORMAT_OPTIONS: { labelKey: string; value: EditableNoteFormat; ext: string }[] = [
  { labelKey: 'home.format.markdown', value: 'markdown', ext: '.md' },
  { labelKey: 'home.format.org', value: 'org', ext: '.org' },
  { labelKey: 'home.format.neorg', value: 'neorg', ext: '.norg' },
];

export default function HomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const { isPro, openPaywall } = useProGate();
  const { notes, togglePin, updateNote, deleteNote } = useNotes();
  const { canvases } = useCanvases();
  const { repositories } = useRepos();
  const openSettings = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'SettingsTab' });
  }, [navigation]);
  const { isTablet, deviceType } = useResponsive();
  const headerHeight = useScreenHeaderHeight({ subtitle: true });
  const tabBarHeight = useTabBarHeight();
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [defaultFormat, setDefaultFormat] = useState<EditableNoteFormat | null>(null);
  const [rememberFormat, setRememberFormat] = useState<boolean>(false);
  const [pickerRemember, setPickerRemember] = useState<boolean>(false);
  const [contextMenuItem, setContextMenuItem] = useState<RecentItem | null>(null);
  const [colorPickerItem, setColorPickerItem] = useState<RecentItem | null>(null);
  const { quote, isLoading: quoteLoading, refresh: quoteRefresh, error: quoteError } = useDailyQuote();

  useEffect(() => {
    (async () => {
      const fmt = await NoteFormatPreferenceService.getDefaultFormat();
      const remember = await NoteFormatPreferenceService.getRememberPreference();
      setDefaultFormat(fmt);
      setRememberFormat(remember);
    })();
  }, []);

  const handleCreateNote = useCallback(() => {
    HapticService.medium();
    if (!requireRepo(repositories.length > 0, { kind: 'note', onOpenSettings: openSettings })) {
      return;
    }
    if (rememberFormat && defaultFormat) {
      navigation.navigate('NoteEditor', { format: defaultFormat });
      return;
    }
    setPickerRemember(false);
    setShowFormatPicker(true);
  }, [navigation, rememberFormat, defaultFormat, repositories.length, openSettings]);

  const handleSelectFormat = useCallback(async (format: EditableNoteFormat) => {
    setShowFormatPicker(false);
    if (pickerRemember) {
      await NoteFormatPreferenceService.setDefaultFormat(format, true);
      setDefaultFormat(format);
      setRememberFormat(true);
    } else {
      await NoteFormatPreferenceService.setDefaultFormat(format, false);
      setDefaultFormat(format);
      setRememberFormat(false);
    }
    navigation.navigate('NoteEditor', { format });
  }, [navigation, pickerRemember]);

  const handleFormatPickerClose = useCallback(() => {
    setShowFormatPicker(false);
  }, []);

  const handleOpenTemplates = useCallback(() => {
    HapticService.medium();
    if (!isPro) {
      openPaywall();
      return;
    }
    if (!requireRepo(repositories.length > 0, { kind: 'template', onOpenSettings: openSettings })) {
      return;
    }
    setShowTemplateSelector(true);
  }, [repositories.length, openSettings, isPro, openPaywall]);

  const handleOpenTodaysJournal = useCallback(() => {
    HapticService.medium();
    const today = new Date();
    const existing = findJournalEntry(notes, today);
    if (existing) {
      // Existing journal entry — let the user open it even with no repo.
      navigation.navigate('NoteEditor', { noteId: existing.id });
      return;
    }
    if (!requireRepo(repositories.length > 0, { kind: 'journal', onOpenSettings: openSettings })) {
      return;
    }
    navigation.navigate('NoteEditor', buildJournalEditorParams(today));
  }, [navigation, notes, repositories.length, openSettings]);

  const todaysJournalTitle = journalNoteTitle(new Date());
  const hasTodaysJournal = notes.some(
    (note) => isJournalEntry(note) && note.title === todaysJournalTitle,
  );

  const handleTemplateSelect = useCallback((template: NoteTemplate) => {
    setShowTemplateSelector(false);
    navigation.navigate('NoteEditor', {
      initialTitle: template.title ?? '',
      initialContent: template.content,
    });
  }, [navigation]);

  const pinnedLimit = deviceType === 'mac' ? 16 : deviceType === 'desktop' ? 12 : isTablet ? 12 : 6;
  const recentItems = useMemo(
    () => buildRecentFeed(notes, canvases, { excludePinned: true }),
    [notes, canvases],
  );
  const pinnedItems = useMemo(
    () => buildPinnedFeed(notes, canvases, pinnedLimit),
    [notes, canvases, pinnedLimit],
  );

  const handleOpenRecentItem = useCallback(
    (item: RecentItem) => {
      if (item.kind === 'canvas') {
        navigation.navigate('CanvasEditor', { canvasId: item.data.id });
        return;
      }
      const note = item.data;
      if (item.kind === 'document' && note.repo && note.filePath) {
        const info = parseRepoPath(note.repo);
        if (info) {
          navigation.navigate('PdfViewer', {
            owner: info.owner,
            repo: info.repo,
            branch: note.branch,
            path: note.filePath,
            title: note.title,
          });
          return;
        }
      }
      navigation.navigate('NoteEditor', { noteId: note.id });
    },
    [navigation],
  );

  const handleLongPressRecentItem = useCallback((item: RecentItem) => {
    HapticService.medium();
    setContextMenuItem(item);
  }, []);

  const handleTogglePin = useCallback(
    async (item: RecentItem) => {
      const note = item.data;
      if (note && 'isPinned' in note) {
        if (!(await togglePin(note.id))) {
          Alert.alert(t('common.error'), t('errors.failedUpdatePinBody'));
        }
      }
    },
    [togglePin, t],
  );

  const handleShare = useCallback(async (note: Note, format: ShareFormat) => {
    const { ShareService } = await import('../services/ShareService');
    try {
      const ok = await ShareService.shareInFormat(note, format);
      if (!ok) {
        Alert.alert(t('errors.exportFailedTitle'), t('errors.exportFailedBody'));
      }
    } catch (error) {
      console.error('[HomeScreen] Share/export error:', error);
      Alert.alert(t('errors.exportFailedTitle'), t('errors.exportFailedBody'));
    }
  }, [t]);

  const handlePickColor = useCallback((item: RecentItem) => {
    setContextMenuItem(null);
    setColorPickerItem(item);
  }, []);

  const handleColorSelect = useCallback(
    async (color: NoteColor | null) => {
      const item = colorPickerItem;
      setColorPickerItem(null);
      if (!item || item.kind === 'canvas') return;
      const note = item.data as Note;
      if (!note.id) return;
      try {
        const updated = await updateNote({ id: note.id, color });
        if (!updated) {
          HapticService.error();
          Alert.alert(t('errors.failedUpdateColorTitle'), t('errors.failedUpdateColorBody'));
          return;
        }
        HapticService.success();
        if (updated.repo && updated.filePath && (updated.content ?? '').trim()) {
          const syncParams = {
            repo: updated.repo,
            branch: updated.branch,
            filePath: updated.filePath,
            title: updated.title,
            content: updated.content,
            format: updated.format,
            tags: updated.tags,
            color,
          };
          try {
            await NoteSyncQueueService.enqueueNoteUpsert(syncParams, updated.id);
          } catch (error) {
            console.warn('[HomeScreen] sync after color update failed:', error);
          }
        }
      } catch {
        HapticService.error();
        Alert.alert(t('errors.failedUpdateColorTitle'), t('errors.failedUpdateColorBody'));
      }
    },
    [colorPickerItem, updateNote, t],
  );

  const handleDelete = useCallback(
    async (item: RecentItem) => {
      const note = item.data;
      if (!('id' in note) || !note.id) return;
      const title = note.title || t('common.untitled');
      Alert.alert(
        t('notes.deleteConfirm', { title }),
        t('common.cannotBeUndone'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              if (!(await deleteNote(note.id as string))) {
                Alert.alert(t('errors.failedDeleteNoteTitle'), t('errors.failedDeleteNoteBody'));
              } else {
                HapticService.success();
              }
            },
          },
        ],
      );
    },
    [deleteNote, t],
  );

  return (
    <SafeAreaView edges={[]} className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingTop: headerHeight, paddingBottom: tabBarHeight + 20 }} showsVerticalScrollIndicator={false}>
      <DailyQuoteCard quote={quote} isLoading={quoteLoading} error={quoteError} onRefresh={quoteRefresh} />
      <View className="gap-3 mt-2 mb-6">
        <View className="flex-row items-stretch gap-3 overflow-hidden">
          <HomeTile
            variant="primary"
            icon="document-text"
            badgeColor="#FFFFFF"
            badgeSize={36}
            iconColor={colors.primary}
            titleNode={
              <Text className="text-xl font-bold text-white" style={{ letterSpacing: -0.3 }}>{t('notes.newNote')}</Text>
            }
            subtitleNode={
              <Text className="text-xs font-medium text-white opacity-80">{t('home.bento.blankNote')}</Text>
            }
            showTabletDecoration={isTablet}
            onPress={handleCreateNote}
            onLongPress={() => {
              HapticService.medium();
              setPickerRemember(false);
              setShowFormatPicker(true);
            }}
            testID="home.button.create-note"
          />

          <HomeTile
            variant="primary"
            icon="journal-outline"
            badgeColor="#FFFFFF"
            badgeSize={36}
            iconColor={colors.primary}
            titleNode={
              <Text className="text-xl font-bold text-white" style={{ letterSpacing: -0.3 }} numberOfLines={1}>
                {hasTodaysJournal ? t('home.bento.todaysJournal') : t('home.bento.newJournal')}
              </Text>
            }
            subtitleNode={
              <Text className="text-xs font-medium text-white opacity-80" numberOfLines={1}>
                {todaysJournalTitle.replace('Journal ', '')}
              </Text>
            }
            showTabletDecoration={isTablet}
            onPress={handleOpenTodaysJournal}
            testID="home.button.open-journal"
          />
        </View>

        <Pressable
          testID="home.button.open-calendar"
          onPress={() => navigation.navigate('Calendar', {})}
          style={({ pressed }) => [
            { height: 56, borderRadius: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
          ]}
        >
          <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary + '1F' }}>
            <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          </View>
          <Text className="text-base font-semibold" style={{ color: colors.text }}>Open Calendar</Text>
        </Pressable>

        <View className="flex-row items-stretch gap-3 overflow-hidden">
          <HomeTile
            variant="secondary"
            icon="copy-outline"
            titleNode={
              <Text className="text-base font-bold" style={{ color: colors.text, letterSpacing: -0.2 }}>{t('home.bento.fromTemplate')}</Text>
            }
            subtitleNode={
              <Text className="text-xs font-medium" style={{ color: colors.textSecondary }}>{t('home.bento.fromTemplateSub')}</Text>
            }
            contentPosition="space-between"
            onPress={handleOpenTemplates}
            testID="home.button.open-templates"
          />
          <HomeTile
            variant="secondary"
            icon="easel-outline"
            titleNode={
              <Text className="text-base font-bold" style={{ color: colors.text, letterSpacing: -0.2 }}>{t('canvases.title')}</Text>
            }
            subtitleNode={
              <Text className="text-xs font-medium" style={{ color: colors.textSecondary }}>{t('home.bento.canvasesSub')}</Text>
            }
            contentPosition="space-between"
            onPress={() => navigation.navigate('MainTabs', { screen: 'CanvasList' })}
            testID="home.button.navigate"
          />
        </View>

        <HomeTile
          variant="accent"
          icon="bulb-outline"
          badgeColor="rgba(255,255,255,0.2)"
          badgeSize={40}
          titleNode={
            <View className="flex-row items-center gap-1.5">
              <Text className="text-base font-bold" style={{ color: '#FFFFFF', letterSpacing: -0.2 }}>{t('thoughtDump.title')}</Text>
            </View>
          }
          subtitle={t('home.bento.thoughtDumpSub')}
          onPress={() => {
            HapticService.medium();
            if (!isPro) {
              openPaywall();
              return;
            }
            navigation.navigate('ThoughtDump');
          }}
          testID="home.button.open-thought-dump"
        />
      </View>

      <QuickAccessShelf items={pinnedItems} onOpen={handleOpenRecentItem} onLongPress={handleLongPressRecentItem} />
      <BentoRecent items={recentItems} onOpen={handleOpenRecentItem} onLongPress={handleLongPressRecentItem} />

      <Modal
        visible={showFormatPicker}
        onRequestClose={handleFormatPickerClose}
        fullWidth
        contentStyle={{ minWidth: 320, maxWidth: 420 }}
      >
        <Text className="text-lg font-bold text-center mb-4" style={{ color: colors.text }}>{t('home.format.pickerTitle')}</Text>
        <View style={{ gap: 10 }}>
          {FORMAT_OPTIONS.map((option) => (
            <Card
              key={option.value}
              testID={`home.button.select-format-${option.value}`}
              onPress={() => handleSelectFormat(option.value)}
              padding={14}
              accessibilityRole="button"
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-base font-medium" style={{ color: colors.text }}>{t(option.labelKey)}</Text>
                <Text className="text-sm font-mono" style={{ color: colors.textSecondary }}>{option.ext}</Text>
              </View>
            </Card>
          ))}
        </View>
        <TouchableOpacity
          testID="home.checkbox.picker-remember"
          className="flex-row items-center gap-2 py-3 px-1"
          onPress={() => setPickerRemember((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: pickerRemember }}
        >
          <Ionicons
            name={pickerRemember ? 'checkbox' : 'square-outline'}
            size={22}
            color={pickerRemember ? colors.accent : colors.textSecondary}
          />
          <Text className="text-sm" style={{ color: colors.text }}>{t('home.format.remember')}</Text>
        </TouchableOpacity>
        <View style={{ marginTop: 12 }}>
          <Button variant="ghost" fullWidth label={t('common.cancel')} testID="home.button.close-format-picker" onPress={handleFormatPickerClose} />
        </View>
      </Modal>

      <TemplateSelector
        visible={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onSelect={handleTemplateSelect}
      />

      <HomeNoteContextMenu
        item={contextMenuItem}
        visible={contextMenuItem !== null}
        onClose={() => setContextMenuItem(null)}
        onOpen={handleOpenRecentItem}
        onTogglePin={handleTogglePin}
        onShare={handleShare}
        onPickColor={handlePickColor}
        onDelete={handleDelete}
      />

      <ColorPicker
        visible={colorPickerItem !== null}
        onClose={() => setColorPickerItem(null)}
        selected={colorPickerItem?.kind === 'note' ? (colorPickerItem.data as Note).color ?? null : null}
        onSelect={handleColorSelect}
      />
      </ScrollView>
      <ScreenHeader
        title={t('home.appTitle')}
        subtitle={t('home.subtitle')}
      />
    </SafeAreaView>
  );
}
