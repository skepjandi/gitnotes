import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Alert, View, Text, ActivityIndicator, RefreshControl, FlatList, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useNotes } from '../contexts/NoteContext';
import { useTheme } from '../contexts/ThemeContext';
import { useViewMode } from '../contexts/ViewModeContext';
import { useAuth } from '../contexts/AuthContext';
import { useRepos } from '../contexts/RepoContext';
import { RootStackParamList } from '../navigation/types';
import { Note } from '../models/Note';
import { GitHubService } from '../services/GitHubService';
import { useGitOperationStore } from '../stores/gitOperationStore';
import { GitSyncGate } from '../services/git/GitSyncGate';
import { syncNow } from '../services/git/manualSync';
import ColorPicker from '../components/ColorPicker';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { IconButton, ScreenHeader, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { requireRepo } from '../utils/requireRepo';
import { HapticService } from '../utils/haptics';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useProGate } from '../hooks/useProGate';
import { GitHubActivityIndicator } from '../components/GitHubActivityIndicator';
import { ViewMode, VIEW_MODE_ICONS } from '../utils/viewModes';
import { formatJournalDate, isJournalEntry } from '../services/JournalService';
import { NoteCard as NotesListCard } from '../components/notes/NoteCard';
import { NotesListHeader } from '../components/notes/NotesListHeader';
import { NotesViewModePicker } from '../components/notes/NotesViewModePicker';
import { NotesFilterModal } from '../components/notes/NotesFilterModal';
import { FilterBar, FilterChip } from '../components/FilterBar';
import { NotesEmptyState } from '../components/notes/NotesEmptyState';
import { NotesContextMenu } from '../components/notes/NotesContextMenu';
import { useNotesListFilters } from '../components/notes/useNotesListFilters';
import { useNotesListNoteActions } from '../components/notes/useNotesListNoteActions';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { useResponsive } from '../hooks/useResponsive';
import { useGitHubActivityStore } from '../stores/githubActivityStore';
import { useReminderStore } from '../stores/reminderStore';
import { useTranslation } from 'react-i18next';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface NotesListRowProps {
  item: Note;
  prevDateKey?: string;
  viewMode: ViewMode;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onPress: (note: Note) => void;
  onLongPress: (note: Note) => void;
  highlighted: boolean;
  isOffline: boolean;
  isCached: boolean;
  onTagPress: (tag: string) => void;
  index: number;
}

const NotesListRow = React.memo(function NotesListRow({
  item,
  prevDateKey,
  viewMode,
  selected,
  selectionMode,
  onToggleSelect,
  onPress,
  onLongPress,
  highlighted,
  isOffline,
  isCached,
  onTagPress,
  index,
}: NotesListRowProps) {
  const handleToggleSelect = useCallback(() => onToggleSelect(item.id), [item.id, onToggleSelect]);

  return (
    <SwipeableListItem
      itemId={item.id}
      selected={selected}
      selectionMode={selectionMode}
      onToggleSelect={handleToggleSelect}
    >
      <NotesListCard
        note={item}
        viewMode={viewMode}
        onPress={onPress}
        onLongPress={onLongPress}
        highlighted={highlighted}
        isOffline={isOffline}
        isCached={isCached}
        onTagPress={onTagPress}
        prevDateKey={prevDateKey}
        index={index}
      />
    </SwipeableListItem>
  );
});

export default function NotesListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const { authState } = useAuth();
  const headerHeight = useScreenHeaderHeight();
  const tabBarHeight = useTabBarHeight();
  const { viewMode, setViewMode } = useViewMode();
  const { isConnected } = useNetworkStatus();
  const { isPro, openPaywall } = useProGate();
  const { repositories } = useRepos();
  const { columnCount } = useResponsive('list');
  const {
    notes,
    filteredNotes,
    isLoading,
    searchQuery,
    setSearchQuery,
    deleteNote,
    togglePin,
    error,
    clearError,
    createNote,
    updateNote,
  } = useNotes();

  const listRef = useRef<FlatList<Note>>(null);
  const isPullRefreshingRef = useRef(false);

  // Unified height of the single blurred header region (title + banners + tools).
  // Initial estimate is the bare header height so the list is never under the header
  // before onLayout fires with the real measured value.
  const [headerBlurHeight, setHeaderBlurHeight] = useState(headerHeight);

  const [showViewModePicker, setShowViewModePicker] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState(0);
  const [longPressedNote, setLongPressedNote] = useState<Note | null>(null);
  const [colorPickerNote, setColorPickerNote] = useState<Note | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeletingRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isFocused = useIsFocused();
  useGitHubActivityStore();

  const viewScopedNotes = useMemo(
    () => (viewMode === 'journal' ? notes.filter(isJournalEntry) : notes),
    [notes, viewMode],
  );
  const viewScopedFilteredNotes = useMemo(
    () => (viewMode === 'journal' ? filteredNotes.filter(isJournalEntry) : filteredNotes),
    [filteredNotes, viewMode],
  );

  // GitSyncGate publishes registry ops for the held cycle (kind 'pull')
  // and push markers (kind 'push'); the registry is the reactive busy source.
  const gateBusy = useGitOperationStore((s) =>
    Object.values(s.ops).some(
      (op) =>
        (op.status === 'queued' || op.status === 'running') &&
        (op.kind === 'pull' || op.kind === 'push'),
    ),
  );

  // Reset refresh state when screen loses focus (tab switch, stack push, etc.)
  useEffect(() => {
    if (!isFocused) {
      isPullRefreshingRef.current = false;
      setIsPullRefreshing(false);
    }
  }, [isFocused]);

  const selectionMode = selectedIds.size > 0;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const closeOpenSwipeable = useCallback(() => {/* noop */}, []);

  const {
    filters,
    displayNotes,
    hasActiveSearch,
    searchMatchCount,
    activeFilterCount,
    allColors,
    allTags,
    allFolders,
    allBranches,
    sortMode,
    setSortMode,
    handleClearFilters,
    handleSelectRepo,
    handleSelectFormat,
    handleSelectBranch,
    handleSelectFolder,
    handleToggleTag,
    handleToggleColor,
  } = useNotesListFilters({
    notes: viewScopedNotes,
    filteredNotes: viewScopedFilteredNotes,
    searchQuery,
    persistenceKey: '@gitnotes:filters:notes-list',
  });

  // Consume pending reminder filter pushed by App.tsx on notification tap.
  const consumePendingFilter = useReminderStore((s) => s.consumePendingFilter);
  useEffect(() => {
    if (!isFocused) return;
    const pending = consumePendingFilter();
    if (!pending) return;
    handleClearFilters();
    if (pending.kind === 'repo' && pending.repoPath) {
      const repo = repositories.find((r) => r.path === pending.repoPath) ?? null;
      if (repo) handleSelectRepo(repo);
    } else if (pending.kind === 'folder') {
      if (pending.repoPath) {
        const repo = repositories.find((r) => r.path === pending.repoPath) ?? null;
        if (repo) handleSelectRepo(repo);
      }
      if (pending.folderPath) handleSelectFolder(pending.folderPath);
    } else if (pending.kind === 'tag' && pending.tag) {
      handleToggleTag(pending.tag);
    }
  }, [isFocused, consumePendingFilter, handleClearFilters, handleSelectRepo, handleSelectFolder, handleToggleTag, repositories]);

  const activeFilterChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (filters.selectedFormat) {
      chips.push({ id: 'format', label: String(filters.selectedFormat), type: 'tag' });
    }
    if (filters.selectedBranch) {
      chips.push({ id: 'branch', label: filters.selectedBranch, type: 'folder' });
    }
    if (filters.selectedFolder) {
      chips.push({ id: 'folder', label: filters.selectedFolder, type: 'folder' });
    }
    for (const tag of filters.selectedTags) {
      chips.push({ id: `tag-${tag}`, label: tag, type: 'tag' });
    }
    for (const color of filters.selectedColors) {
      chips.push({ id: `color-${color}`, label: color, type: 'tag' });
    }
    return chips;
  }, [filters]);

  const handleRemoveFilterChip = useCallback(
    (id: string) => {
      if (id === 'format') handleSelectFormat(null);
      else if (id === 'branch') handleSelectBranch(null);
      else if (id === 'folder') handleSelectFolder(null);
      else if (id.startsWith('tag-')) handleToggleTag(id.slice(4));
      else if (id.startsWith('color-')) {
        const color = id.slice(6) as import('../models/Note').NoteColor;
        handleToggleColor(color);
      }
    },
    [handleSelectFormat, handleSelectBranch, handleSelectFolder, handleToggleTag, handleToggleColor],
  );

  const {
    handleNotePress,
    handleColorSelect,
    handleDeleteNote,
    handleNoteLongPress,
    handleTogglePin,
    handleExport,
    handleOpenColorPicker,
    handleDuplicate,
  } = useNotesListNoteActions({
    navigation,
    isConnected,
    closeOpenSwipeable,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
    setLongPressedNote,
    setColorPickerNote,
    setIsDeleting,
  });

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (isDeletingRef.current) return;
    const noun = ids.length === 1 ? t('notes.note') : t('notes.notes_');
    Alert.alert(
      t('notes.deleteBulkConfirm', { count: ids.length, noun }),
      t('common.cannotBeUndone'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (isDeletingRef.current) return;
            isDeletingRef.current = true;
            setIsDeleting(true);
            try {
              const selectedNotes = notes.filter((note) => selectedIds.has(note.id));
              let localFailure = false;
              // Store owns the sync-mode split (clone → real local delete
              // commit, API → enqueue), same path as single delete (#1030).
              for (const note of selectedNotes) {
                const removed = await deleteNote(note.id);
                if (!removed) localFailure = true;
              }
              if (localFailure) {
                HapticService.warning();
              } else {
                HapticService.success();
                clearSelection();
              }
            } finally {
              setIsDeleting(false);
              isDeletingRef.current = false;
            }
          },
        },
      ],
    );
  }, [selectedIds, notes, deleteNote, clearSelection, t]);

  useEffect(() => {
    if (authState.token) GitHubService.setToken(authState.token);
  }, [authState.token]);

  useEffect(() => {
    const ref = listRef.current;
    if (ref && typeof ref.scrollToOffset === 'function') {
      ref.scrollToOffset({ offset: 0, animated: false });
    }
  }, [filters.selectedRepo, filters.selectedBranch, filters.selectedFolder, filters.selectedFormat, filters.selectedTags, filters.selectedColors]);

  useEffect(() => {
    if (!hasActiveSearch || searchMatchCount === 0) {
      setCurrentSearchMatchIndex(0);
      return;
    }
    setCurrentSearchMatchIndex((previous) =>
      previous >= searchMatchCount ? searchMatchCount - 1 : previous,
    );
  }, [hasActiveSearch, searchMatchCount]);

  const handleAddNote = useCallback(() => {
    HapticService.medium();
    if (!requireRepo(repositories.length > 0, {
      kind: 'note',
      onOpenSettings: () => navigation.navigate('MainTabs', { screen: 'SettingsTab' }),
    })) {
      return;
    }
    navigation.navigate('NoteEditor', {});
  }, [navigation, repositories.length]);

  const handlePullToRefresh = useCallback(async () => {
    if (isPullRefreshingRef.current) return;
    if (useGitHubActivityStore.getState().inflight > 0) return;
    if (GitSyncGate.isCycleHeld()) return;
    isPullRefreshingRef.current = true;
    setIsPullRefreshing(true);
    HapticService.light();

    const safetyTimeout = setTimeout(() => {
      isPullRefreshingRef.current = false;
      setIsPullRefreshing(false);
    }, 30000);

    try {
      // Do NOT acquire the gate cycle here: syncNow acquires it internally,
      // and a held cycle would deadlock its own acquisition.
      const result = await syncNow();
      if (result.ok) {
        HapticService.success();
      } else {
        HapticService.warning();
      }
    } finally {
      clearTimeout(safetyTimeout);
      isPullRefreshingRef.current = false;
      setIsPullRefreshing(false);
    }
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      HapticService.selection();
      if (mode === 'graph' && !isPro) {
        openPaywall();
        setShowViewModePicker(false);
        return;
      }
      if (mode === 'graph') {
        navigation.navigate('GraphView');
      } else {
        setViewMode(mode);
      }
      setShowViewModePicker(false);
    },
    [navigation, setViewMode, isPro, openPaywall],
  );

  const scrollToSearchMatch = useCallback(
    (targetIndex: number) => {
      if (searchMatchCount === 0) return;
      const boundedIndex = ((targetIndex % searchMatchCount) + searchMatchCount) % searchMatchCount;
      setCurrentSearchMatchIndex(boundedIndex);
      listRef.current?.scrollToIndex({ index: boundedIndex, animated: true, viewPosition: 0.4 });
    },
    [searchMatchCount],
  );

  const handleSearchNavigate = useCallback(
    (step: -1 | 1) => {
      if (searchMatchCount === 0) return;
      scrollToSearchMatch(currentSearchMatchIndex + step);
    },
    [currentSearchMatchIndex, scrollToSearchMatch, searchMatchCount],
  );

  const handleTagPress = useCallback(
    (tag: string) => {
      handleToggleTag(tag);
      HapticService.light();
    },
    [handleToggleTag],
  );

  const listExtraData = useMemo(
    () => ({
      searchActive: hasActiveSearch,
      searchIndex: currentSearchMatchIndex,
      selectionCount: selectedIds.size,
    }),
    [currentSearchMatchIndex, hasActiveSearch, selectedIds.size],
  );

  const renderNote = useCallback(
    ({ item, index }: { item: Note; index: number }) => {
      const prev = index > 0 ? displayNotes[index - 1] : undefined;
      const prevDateKey =
        viewMode === 'journal' && prev?.updatedAt ? formatJournalDate(new Date(prev.updatedAt)) : undefined;
      return (
        <NotesListRow
          item={item}
          prevDateKey={prevDateKey}
          viewMode={viewMode}
          selected={selectedIds.has(item.id)}
          selectionMode={selectionMode}
          onToggleSelect={toggleSelected}
          onPress={handleNotePress}
          onLongPress={handleNoteLongPress}
          highlighted={hasActiveSearch && index === currentSearchMatchIndex}
          isOffline={isConnected === false}
          isCached={!!item.content?.trim()}
          onTagPress={handleTagPress}
          index={index}
        />
      );
    },
    [
      currentSearchMatchIndex,
      displayNotes,
      handleNoteLongPress,
      handleNotePress,
      handleTagPress,
      hasActiveSearch,
      isConnected,
      selectedIds,
      selectionMode,
      toggleSelected,
      viewMode,
    ],
  );

  // Only show full-screen spinner for initial load when there are no cached notes.
  // Pull-to-refresh uses the RefreshControl spinner instead.
  if (isLoading && notes.length === 0 && !isPullRefreshing) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={[]} className="flex-1" style={{ backgroundColor: colors.background }}>
      {isDeleting ? <GitHubActivityIndicator /> : null}

      <NotesViewModePicker
        visible={showViewModePicker}
        viewMode={viewMode}
        onClose={() => setShowViewModePicker(false)}
        onChange={handleViewModeChange}
        isPro={isPro}
        onLockedPress={() => {
          setShowViewModePicker(false);
          openPaywall();
        }}
      />

      <View style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={displayNotes}
          renderItem={renderNote}
          keyExtractor={(item) => item.id}
          key={`${viewMode}-${columnCount}`}
          numColumns={viewMode === 'journal' ? 1 : columnCount}
          extraData={listExtraData}
          initialNumToRender={10}
          maxToRenderPerBatch={6}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={false}
          onScrollToIndexFailed={({ index, highestMeasuredFrameIndex, averageItemLength }) => {
            // Without this, scrollToIndex for a search match beyond the
            // measured window silently fails — search nav appears broken.
            const offset = Math.max(
              0,
              (highestMeasuredFrameIndex < index
                ? highestMeasuredFrameIndex
                : index - 1) * averageItemLength,
            );
            listRef.current?.scrollToOffset({ offset, animated: true });
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.4,
              });
            }, 250);
          }}
          contentContainerStyle={{
            padding: 12,
            paddingTop: headerBlurHeight + 16,
            paddingBottom: tabBarHeight + 16,
            flexGrow: 1,
          }}
          columnWrapperStyle={viewMode !== 'journal' && columnCount > 1 ? { gap: 8 } : undefined}
          refreshControl={
            <RefreshControl
              testID="notes-list.swipe.pull-refresh"
              refreshing={isPullRefreshing}
              onRefresh={handlePullToRefresh}
              enabled={!gateBusy}
              tintColor="transparent"
              colors={['transparent']}
              progressViewOffset={headerBlurHeight}
            />
          }
          ListEmptyComponent={<NotesEmptyState isFiltered={!!searchQuery || activeFilterCount > 0} onCreate={handleAddNote} />}
        />
      </View>

      <NotesFilterModal
        visible={showFilterModal}
        filters={filters}
        repositories={repositories}
        allBranches={allBranches}
        allFolders={allFolders}
        allTags={allTags}
        allColors={allColors}
        displayCount={displayNotes.length}
        activeFilterCount={activeFilterCount}
        onClose={() => setShowFilterModal(false)}
        onClearFilters={handleClearFilters}
        onSelectRepo={handleSelectRepo}
        onSelectFormat={handleSelectFormat}
        onSelectBranch={handleSelectBranch}
        onSelectFolder={handleSelectFolder}
        onToggleTag={handleToggleTag}
        onToggleColor={handleToggleColor}
      />

      <NotesContextMenu
        note={longPressedNote}
        visible={longPressedNote !== null}
        onClose={() => setLongPressedNote(null)}
        onOpen={handleNotePress}
        onTogglePin={handleTogglePin}
        onShare={handleExport}
        onPickColor={handleOpenColorPicker}
        onDuplicate={handleDuplicate}
        onDelete={async (note) => {
          await handleDeleteNote(note);
        }}
      />

      <ColorPicker
        visible={colorPickerNote !== null}
        onClose={() => setColorPickerNote(null)}
        selected={colorPickerNote?.color ?? null}
        onSelect={(color) => handleColorSelect(colorPickerNote, color)}
      />

      <BulkActionBar
        count={selectedIds.size}
        itemNoun={t('notes.note')}
        bottomOffset={tabBarHeight + 12}
        onCancel={clearSelection}
        onDelete={handleBulkDelete}
      />
      

      <ScreenHeader
        title={t('notes.title')}
        testID="notes-list.header-blur"
        onLayout={(event: LayoutChangeEvent) => setHeaderBlurHeight(event.nativeEvent.layout.height)}
        footer={
          <>
            <OfflineBanner />

            {error ? (
              <View className="mx-3 mb-1 p-2.5 rounded-sm border-l-4" style={{ backgroundColor: colors.error + '20', borderLeftColor: colors.error }}>
                <Text className="text-xs flex-1" style={{ color: colors.error }} numberOfLines={2}>{error}</Text>
                <TouchableOpacity onPress={clearError} className="ml-3 px-3 py-1.5 rounded-md border" style={{ borderColor: colors.error }}>
                  <Text className="text-xs font-semibold" style={{ color: colors.error }}>{t('common.dismiss')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <NotesListHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              repositories={repositories}
              selectedRepo={filters.selectedRepo}
              hasActiveSearch={hasActiveSearch}
              searchMatchCount={searchMatchCount}
              currentSearchMatchIndex={currentSearchMatchIndex}
              sortMode={sortMode}
              onSortChange={setSortMode}
              onSelectRepo={handleSelectRepo}
              onSearchNavigate={handleSearchNavigate}
            />

            <FilterBar
              filters={activeFilterChips}
              onRemoveFilter={handleRemoveFilterChip}
              onClearAll={handleClearFilters}
            />
          </>
        }
        actions={
          <>
            <IconButton
              size="sm"
              testID="notes-list.icon-button.view-mode"
              onPress={() => {
                HapticService.light();
                setShowViewModePicker((previous) => !previous);
              }}
              accessibilityLabel={t('common.viewMode')}
            >
              <Ionicons name={VIEW_MODE_ICONS[viewMode]} size={18} color={colors.textSecondary} />
            </IconButton>
            <View className="relative">
              <IconButton
                size="sm"
                testID="notes-list.icon-button.filters"
                active={activeFilterCount > 0}
                onPress={() => {
                  HapticService.light();
                  setShowFilterModal(true);
                }}
                accessibilityLabel={t('common.filters')}
              >
                <Ionicons
                  name="funnel-outline"
                  size={18}
                  color={activeFilterCount > 0 ? colors.accent : colors.textSecondary}
                />
              </IconButton>
              {activeFilterCount > 0 ? (
                <View className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                  <Text className="text-white font-bold" style={{ fontSize: 9 }}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </View>
            <IconButton
              size="sm"
              testID="notes-list.icon-button.add"
              onPress={handleAddNote}
              accessibilityLabel={t('notes.addNoteA11y')}
            >
              <Ionicons name="add" size={20} color={colors.accent} />
            </IconButton>
          </>
        }
      />

    </SafeAreaView>
  );
}
