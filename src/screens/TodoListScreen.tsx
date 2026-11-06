import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Alert, Platform, RefreshControl, LayoutChangeEvent } from 'react-native';
import { FlatList, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { requireRepo } from '../utils/requireRepo';
import { useTodos } from '../contexts/TodoContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { slugifyTodoText, Todo, TodoPriority } from '../models/Todo';
import { SortMode } from '../types/SortTypes';
import { HapticService } from '../utils/haptics';
import { syncTodoToGitHub } from '../services/TodoGitHubSyncService';
import { syncNow } from '../services/git/manualSync';
import { IconButton, ScreenHeader, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { EntityFilterModal } from '../components/EntityFilterModal';
import { FilterBar, FilterChip } from '../components/FilterBar';
import { useEntityFilter } from '../hooks/useEntityFilter';
import { useRepos } from '../contexts/RepoContext';
import { useTodoStore } from '../stores/todoStore';
import { useEntityList } from '../hooks/useEntityList';
import { TodoCard } from '../components/todos/TodoCard';
import { TodosEmptyState } from '../components/todos/TodosEmptyState';
import { TodosListHeader } from '../components/todos/TodosListHeader';
import { TodoEditorModal } from '../components/todos/TodoEditorModal';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { useResponsive } from '../hooks/useResponsive';
import { useGitHubActivityStore } from '../stores/githubActivityStore';
import { useGitOperationStore } from '../stores/gitOperationStore';
import { GitSyncGate } from '../services/git/GitSyncGate';
import { useTranslation } from 'react-i18next';
import { LastSelectionPreferenceService } from '../services/LastSelectionPreferenceService';
import { useProGate } from '../hooks/useProGate';
import KanbanBoard from '../components/todos/KanbanBoard';

const FILTER_COMPLETED_PERSISTENCE_KEY = '@gitnotes:filters:todo-completed';
const VIEW_MODE_PERSISTENCE_KEY = '@gitnotes:todo:view-mode';

export default function TodoListScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const headerHeight = useScreenHeaderHeight();
  const tabBarHeight = useTabBarHeight();
  const navigation = useNavigation();
  const { todos, createTodo, updateTodo, toggleTodo } = useTodos();
  const deleteTodo = useTodoStore((state) => state.deleteTodo);
  const { activeAccountId } = useAuth();
  const { repositories } = useRepos();
  const { columnCount } = useResponsive('list');

  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const [gitOperationActive, setGitOperationActive] = useState(false);

  // Unified height of the single blurred header region (title + banners + tools).
  // Initial estimate is the bare header height so the list is never under the header
  // before onLayout fires with the real measured value.
  const [headerBlurHeight, setHeaderBlurHeight] = useState(headerHeight);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [todoText, setTodoText] = useState('');
  const [todoNotes, setTodoNotes] = useState('');
  const [todoPriority, setTodoPriority] = useState<TodoPriority>('medium');
  const [todoDueDate, setTodoDueDate] = useState<number | undefined>(undefined);
  const [todoReminderMinutes, setTodoReminderMinutes] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);
  const [filterCompletedHydrated, setFilterCompletedHydrated] = useState(false);
  const [todoRepo, setTodoRepo] = useState<string | undefined>(undefined);
  const [todoBranch, setTodoBranch] = useState<string | undefined>(undefined);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const isDeletingRef = useRef(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [viewModeHydrated, setViewModeHydrated] = useState(false);
  const { isPro, openPaywall } = useProGate();

  useEffect(() => {
    if (!showAddModal) return;
    if (todoRepo) return;
    void LastSelectionPreferenceService.get('todo').then((sel) => {
      if (!todoRepo && sel.repo) setTodoRepo(sel.repo);
    });
  }, [showAddModal, todoRepo, todoBranch]);

  const filter = useEntityFilter<Todo>(todos, '@gitnotes:filters:todo-entity');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const selectionMode = selectedIds.size > 0;
  const isFocused = useIsFocused();
  const { inflight } = useGitHubActivityStore();

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
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [isFocused]);

  useEffect(() => {
    AsyncStorage.getItem(FILTER_COMPLETED_PERSISTENCE_KEY)
      .then((raw) => {
        if (raw === 'true') setFilterCompleted(true);
      })
      .finally(() => setFilterCompletedHydrated(true));
  }, []);

  useEffect(() => {
    if (!filterCompletedHydrated) return;
    AsyncStorage.setItem(FILTER_COMPLETED_PERSISTENCE_KEY, String(filterCompleted)).catch(() => {/* noop */});
  }, [filterCompleted, filterCompletedHydrated]);

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_PERSISTENCE_KEY)
      .then((raw) => {
        if (raw === 'kanban' || raw === 'list') setViewMode(raw);
      })
      .finally(() => setViewModeHydrated(true));
  }, []);

  useEffect(() => {
    if (!viewModeHydrated) return;
    AsyncStorage.setItem(VIEW_MODE_PERSISTENCE_KEY, viewMode).catch(() => {/* noop */});
  }, [viewMode, viewModeHydrated]);

  useEffect(() => {
    if (inflight > 0) {
      setGitOperationActive(true);
      return;
    }
    const timer = setTimeout(() => {
      setGitOperationActive(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [inflight]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const todosAfterEntityFilters = useMemo(() => {
    const baseTodos = filter.applyFilters(todos);
    return filterCompleted ? baseTodos.filter((todo) => !todo.completed) : baseTodos;
  }, [filter, filterCompleted, todos]);

  const {
    filteredData: filteredTodos,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
  } = useEntityList<Todo>({
    data: todosAfterEntityFilters,
    searchFields: ['text', 'notes', 'tags'],
    sortFn: (a, b, mode: SortMode) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const dir = mode.direction === 'asc' ? 1 : -1;
      switch (mode.field) {
        case 'modified':
          return dir * (a.updatedAt - b.updatedAt);
        case 'created':
          return dir * (a.createdAt - b.createdAt);
        case 'title':
          return dir * a.text.localeCompare(b.text);
      }
    },
    entityName: 'todo',
    persistenceKey: '@gitnotes:filters:todo-list',
  });

  const runApiBatchDeletes = useCallback(async (batchable: Todo[], failedIds: Set<string>) => {
    for (const todo of batchable) {
      try {
        const ok = await deleteTodo(todo.id);
        if (!ok) failedIds.add(todo.id);
      } catch {
        failedIds.add(todo.id);
      }
    }
  }, [deleteTodo]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (isDeletingRef.current) return;
    const noun = ids.length === 1 ? t('todos.todo') : t('todos.todos_');
    Alert.alert(
      t('todos.deleteBulkConfirm', { count: ids.length, noun }),
      t('common.cannotBeUndone'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (isDeletingRef.current) return;
            isDeletingRef.current = true;
            const failedIds = new Set<string>();
            try {
              const selectedTodos = todos.filter((todo) => selectedIds.has(todo.id));
              if (selectedTodos.length >= 2) {
                await runApiBatchDeletes(selectedTodos, failedIds);
              } else {
                for (const todo of selectedTodos) {
                  try {
                    const ok = await deleteTodo(todo.id);
                    if (!ok) failedIds.add(todo.id);
                  } catch {
                    failedIds.add(todo.id);
                  }
                }
              }
              if (failedIds.size > 0) {
                HapticService.warning();
              } else {
                HapticService.success();
                clearSelection();
              }
            } finally {
              isDeletingRef.current = false;
            }
          },
        },
      ],
    );
  }, [selectedIds, todos, deleteTodo, clearSelection, runApiBatchDeletes, t]);

  const resetForm = useCallback(() => {
    setTodoText('');
    setTodoNotes('');
    setTodoPriority('medium');
    setTodoDueDate(undefined);
    setTodoReminderMinutes(0);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setShowReminderPicker(false);
    setTodoRepo(undefined);
    setTodoBranch(undefined);
  }, []);

  const handleAddTodo = useCallback(async () => {
    if (!todoText.trim()) {
      Alert.alert(t('common.error'), t('todos.errorTextRequired'));
      return;
    }

    if (!todoRepo) {
      Alert.alert(t('todos.repositoryRequired'), t('todos.selectRepository'));
      return;
    }

    const slug = slugifyTodoText(todoText.trim());
    const todoFilePath = `todos/${slug}.json`;

    const newTodo = await createTodo({
      text: todoText.trim(),
      notes: todoNotes.trim() || undefined,
      priority: todoPriority,
      dueDate: todoDueDate,
      reminderBeforeMinutes: todoDueDate ? todoReminderMinutes : undefined,
      repo: todoRepo,
      branch: todoBranch,
      filePath: todoFilePath,
      accountId: activeAccountId ?? undefined,
    });

    if (todoRepo && newTodo) {
      const syncResult = await syncTodoToGitHub({
        repo: todoRepo,
        branch: todoBranch,
        filePath: todoFilePath,
        text: todoText.trim(),
        todo: newTodo,
        accountId: activeAccountId ?? undefined,
      });
      if (!syncResult.success) {
        console.warn('[TodoList] GitHub sync failed:', syncResult.error);
      }
    }

    resetForm();
    setShowAddModal(false);
    HapticService.success();
  }, [
    activeAccountId,
    createTodo,
    resetForm,
    todoBranch,
    todoDueDate,
    todoNotes,
    todoPriority,
    todoReminderMinutes,
    todoRepo,
    todoText,
  ]);

  const handleUpdateTodo = useCallback(async () => {
    if (!editingTodo || !todoText.trim()) return;

    if (!todoRepo) {
      Alert.alert(t('todos.repositoryRequired'), t('todos.selectRepository'));
      return;
    }

    const slug = slugifyTodoText(todoText.trim());
    const todoFilePath = editingTodo.filePath ?? `todos/${slug}.json`;
    const editAccountId = editingTodo.accountId ?? activeAccountId ?? undefined;

    await updateTodo({
      id: editingTodo.id,
      text: todoText.trim(),
      notes: todoNotes.trim() || undefined,
      priority: todoPriority,
      dueDate: todoDueDate,
      reminderBeforeMinutes: todoDueDate ? todoReminderMinutes : undefined,
      repo: todoRepo,
      branch: todoBranch,
      filePath: todoFilePath,
      accountId: editAccountId,
    });

    const syncResult = await syncTodoToGitHub({
      repo: todoRepo,
      branch: todoBranch,
      filePath: todoFilePath,
      text: todoText.trim(),
      todo: {
        text: todoText.trim(),
        completed: editingTodo.completed,
        priority: todoPriority,
        notes: todoNotes.trim() || undefined,
        tags: editingTodo.tags,
        dueDate: todoDueDate,
        createdAt: editingTodo.createdAt,
        updatedAt: Date.now(),
      },
      accountId: editAccountId,
    });
    if (!syncResult.success) {
      console.warn('[TodoList] GitHub sync failed:', syncResult.error);
    }

    resetForm();
    setEditingTodo(null);
  }, [
    activeAccountId,
    editingTodo,
    resetForm,
    todoBranch,
    todoDueDate,
    todoNotes,
    todoPriority,
    todoReminderMinutes,
    todoRepo,
    todoText,
    updateTodo,
    t,
  ]);

  const handleToggleTodo = useCallback(async (id: string) => {
    await toggleTodo(id);
    HapticService.light();
  }, [toggleTodo]);

  const openEditModal = useCallback((todo: Todo) => {
    setEditingTodo(todo);
    setTodoText(todo.text);
    setTodoNotes(todo.notes || '');
    setTodoPriority(todo.priority || 'medium');
    setTodoDueDate(todo.dueDate);
    setTodoReminderMinutes(todo.reminderBeforeMinutes ?? 0);
    setTodoRepo(todo.repo);
    setTodoBranch(todo.branch);
  }, []);

  const closeModals = useCallback(() => {
    setShowAddModal(false);
    setEditingTodo(null);
    resetForm();
  }, [resetForm]);

  const openAddTodo = useCallback(() => {
    if (!requireRepo(repositories.length > 0, {
      kind: 'todo',
      onOpenSettings: () => navigation.navigate('MainTabs', { screen: 'SettingsTab' }),
    })) {
      return;
    }
    setShowAddModal(true);
  }, [navigation, repositories.length]);

  const onDateChange = useCallback((_event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      const current = todoDueDate ? new Date(todoDueDate) : new Date();
      const updated = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        current.getHours(),
        current.getMinutes(),
      );
      setTodoDueDate(updated.getTime());
    }
  }, [todoDueDate]);

  const onTimeChange = useCallback((_event: any, selectedDate?: Date) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selectedDate && todoDueDate) {
      const base = new Date(todoDueDate);
      base.setHours(selectedDate.getHours(), selectedDate.getMinutes());
      setTodoDueDate(base.getTime());
    }
  }, [todoDueDate]);

  const removeDueDate = useCallback(() => {
    setTodoDueDate(undefined);
    setTodoReminderMinutes(0);
  }, []);

  const handlePullToRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    if (useGitHubActivityStore.getState().inflight > 0) return;
    if (GitSyncGate.isCycleHeld()) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    HapticService.light();

    const safetyTimeout = setTimeout(() => {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }, 30000);

    try {
      // Do NOT acquire the gate cycle here: syncNow acquires it internally,
      // and a held cycle would deadlock its own acquisition.
      await syncNow();
    } finally {
      clearTimeout(safetyTimeout);
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  const renderTodoItem = useCallback(
    ({ item }: { item: Todo }) => (
      <SwipeableListItem
        itemId={item.id}
        selected={selectedIds.has(item.id)}
        selectionMode={selectionMode}
        onToggleSelect={() => toggleSelected(item.id)}
      >
        <TodoCard todo={item} onPress={openEditModal} onToggle={handleToggleTodo} />
      </SwipeableListItem>
    ),
    [
      handleToggleTodo,
      openEditModal,
      selectedIds,
      selectionMode,
      toggleSelected,
    ],
  );

  const hasActiveFilters = filter.activeCount > 0 || !!searchQuery.trim() || filterCompleted;

  const activeFilterChips: FilterChip[] = useMemo(() => {
    const chips: FilterChip[] = [];
    if (filterCompleted) {
      chips.push({ id: 'status-active', label: t('todos.activeOnly'), type: 'status' });
    }
    for (const tag of filter.state.selectedTags) {
      chips.push({ id: `tag-${tag}`, label: tag, type: 'tag' });
    }
    if (filter.state.selectedRepo) {
      chips.push({ id: 'repo', label: filter.state.selectedRepo.name, type: 'folder' });
    }
    if (filter.state.selectedFolder) {
      chips.push({ id: 'folder', label: filter.state.selectedFolder, type: 'folder' });
    }
    return chips;
  }, [filterCompleted, filter.state, filter.state.selectedTags, filter.state.selectedRepo, filter.state.selectedFolder, t]);

  const handleRemoveTodoFilterChip = useCallback(
    (id: string) => {
      if (id === 'status-active') setFilterCompleted(false);
      else if (id === 'repo') filter.setSelectedRepo(null);
      else if (id === 'folder') filter.setSelectedFolder(null);
      else if (id.startsWith('tag-')) filter.toggleTag(id.slice(4));
    },
    [filter],
  );

  return (
    <SafeAreaView edges={[]} className="flex-1" style={{ backgroundColor: colors.background }}>
      <EntityFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        filter={filter}
        repositories={repositories}
      />

      {viewMode === 'kanban' ? (
        <View style={{ paddingTop: headerBlurHeight, flex: 1 }}>
          <KanbanBoard onSelect={openEditModal} />
        </View>
      ) : (
        <FlatList
          data={filteredTodos}
          renderItem={renderTodoItem}
          keyExtractor={(item) => item.id}
          numColumns={columnCount}
          key={`todos-${columnCount}`}
          extraData={filteredTodos}
          removeClippedSubviews={false}
          contentContainerStyle={{
            padding: 16,
            paddingTop: headerBlurHeight + 8,
            paddingBottom: tabBarHeight + 16,
            flexGrow: 1,
          }}
          columnWrapperStyle={columnCount > 1 ? { gap: 8 } : undefined}
          ListEmptyComponent={<TodosEmptyState isFiltered={hasActiveFilters} onCreate={openAddTodo} />}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              testID="todo-list.swipe.pull-refresh"
              refreshing={isRefreshing}
              onRefresh={handlePullToRefresh}
              enabled={!gateBusy && !gitOperationActive}
              tintColor="transparent"
              colors={['transparent']}
              progressViewOffset={headerBlurHeight}
            />
          }
        />
      )}

      <TodoEditorModal
        visible={showAddModal || editingTodo !== null}
        editingTodo={editingTodo}
        todoText={todoText}
        todoNotes={todoNotes}
        todoPriority={todoPriority}
        todoDueDate={todoDueDate}
        todoReminderMinutes={todoReminderMinutes}
        showDatePicker={showDatePicker}
        showTimePicker={showTimePicker}
        showReminderPicker={showReminderPicker}
        todoRepo={todoRepo}
        isDark={isDark}
        onClose={closeModals}
        onChangeText={setTodoText}
        onChangeNotes={setTodoNotes}
        onChangePriority={setTodoPriority}
        onToggleDatePicker={() => {
          setShowDatePicker(!showDatePicker);
          setShowTimePicker(false);
        }}
        onToggleTimePicker={() => {
          setShowTimePicker(!showTimePicker);
          setShowDatePicker(false);
        }}
        onDateChange={onDateChange}
        onTimeChange={onTimeChange}
        onAddDeadline={() => {
          setTodoDueDate(Date.now() + 3600000);
          setShowDatePicker(true);
        }}
        onRemoveDeadline={removeDueDate}
        onToggleReminderPicker={() => setShowReminderPicker((previous) => !previous)}
        onSelectReminderMinutes={(minutes) => {
          setTodoReminderMinutes(minutes);
          setShowReminderPicker(false);
        }}
        onRepoChange={setTodoRepo}
        onSubmit={editingTodo ? handleUpdateTodo : handleAddTodo}
      />

      <BulkActionBar
        count={selectedIds.size}
        itemNoun={t('todos.todo')}
        bottomOffset={tabBarHeight + 12}
        onCancel={clearSelection}
        onDelete={handleBulkDelete}
      />

      <ScreenHeader
        title={t('todos.title')}
        testID="todos-list.header-blur"
        onLayout={(event: LayoutChangeEvent) => setHeaderBlurHeight(event.nativeEvent.layout.height)}
        footer={
          <>
            <OfflineBanner />

            <TodosListHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} sortMode={sortMode} onSortChange={setSortMode} />

            <FilterBar
              filters={activeFilterChips}
              onRemoveFilter={handleRemoveTodoFilterChip}
              onClearAll={() => {
                filter.clearAll();
                setFilterCompleted(false);
              }}
            />
          </>
        }
        actions={
          <>
            <IconButton
              size="sm"
              testID="todo-list.icon-button.filter-completed"
              active={filterCompleted}
              onPress={() => setFilterCompleted(!filterCompleted)}
              accessibilityLabel={t('todos.toggleCompletedA11y')}
            >
              <Ionicons
                name={filterCompleted ? 'eye-off' : 'eye'}
                size={18}
                color={filterCompleted ? colors.accent : colors.textSecondary}
              />
            </IconButton>
            <IconButton
              size="sm"
              testID="todo-list.icon-button.kanban"
              active={viewMode === 'kanban'}
              onPress={() => {
                if (isPro) {
                  setViewMode(viewMode === 'kanban' ? 'list' : 'kanban');
                } else {
                  openPaywall();
                }
              }}
              accessibilityLabel={t('todos.kanbanView')}
            >
              <Ionicons
                name="grid"
                size={18}
                color={viewMode === 'kanban' ? colors.accent : colors.textSecondary}
              />
            </IconButton>
            <IconButton
              size="sm"
              testID="todo-list.icon-button.filters"
              active={filter.activeCount > 0}
              onPress={() => setShowFilterModal(true)}
              accessibilityLabel={t('common.filters')}
            >
              <Ionicons
                name="funnel-outline"
                size={18}
                color={filter.activeCount > 0 ? colors.accent : colors.textSecondary}
              />
            </IconButton>
            <IconButton
              size="sm"
              testID="todo-list.icon-button.add"
              onPress={openAddTodo}
              accessibilityLabel={t('todos.addTodoA11y')}
            >
              <Ionicons name="add" size={20} color={colors.accent} />
            </IconButton>
          </>
        }
      />
    </SafeAreaView>
  );
}
