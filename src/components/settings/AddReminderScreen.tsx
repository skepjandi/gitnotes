import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotes } from '../../contexts/NoteContext';
import {
  Button,
  Group,
  Modal,
  ScreenHeader,
  useScreenHeaderHeight,
} from '../ui';
import { useReminderStore } from '../../stores/reminderStore';
import {
  type DayOfWeek,
  type ReminderEntityType,
  type ReminderRepeat,
  DAY_OF_WEEK_OPTIONS,
} from '../../models/Reminder';
import { ReminderService } from '../../services/ReminderService';
import { NotePickerModal } from '../NotePickerModal';
import RepoFolderPickerModal from '../RepoFolderPickerModal';
import type { RootStackParamList } from '../../navigation/types';
import { ON_FILLED } from '../../theme/tokens';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const TARGET_OPTIONS: {
  value: ReminderEntityType;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: 'note',
    label: 'Note',
    description: 'Open a specific note when the reminder fires',
    icon: 'document-outline',
  },
  {
    value: 'folder',
    label: 'Folder',
    description: 'Open the notes list filtered to a folder',
    icon: 'folder-outline',
  },
  {
    value: 'repo',
    label: 'Repo',
    description: 'Open the notes list filtered to a repository',
    icon: 'git-branch-outline',
  },
  {
    value: 'tag',
    label: 'Tag',
    description: 'Open the notes list filtered to a tag',
    icon: 'pricetag-outline',
  },
];

export function AddReminderScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, isDark, tokens } = useTheme();
  const { spacing, type } = tokens;
  const insets = useSafeAreaInsets();
  const headerHeight = useScreenHeaderHeight();
  const createItem = useReminderStore((s) => s.createItem);
  const { notes } = useNotes();

  const [entityType, setEntityType] = useState<ReminderEntityType | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>(['monday']);
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [repeat, setRepeat] = useState<ReminderRepeat>('weekly');

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [showRepoFolderPicker, setShowRepoFolderPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [submitState, setSubmitState] = useState<
    'idle' | 'saving' | 'added'
  >('idle');

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) n.tags?.forEach((tg) => s.add(tg));
    return Array.from(s).sort();
  }, [notes]);

  const resetForm = useCallback(() => {
    setEntityType(null);
    setNoteId(null);
    setNoteTitle('');
    setRepoPath(null);
    setBranch(null);
    setFolderPath(null);
    setTag(null);
    setSelectedDays(['monday']);
    setSelectedTime(new Date());
    setRepeat('weekly');
  }, []);

  const toggleDay = useCallback((day: DayOfWeek) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }, []);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const handleNoteSelected = useCallback(
    (id: string, title: string) => {
      setNoteId(id);
      setNoteTitle(title);
      setEntityType('note');
      setShowNotePicker(false);
    },
    [],
  );

  const handleRepoFolderSelect = useCallback(
    (
      r: string | null,
      b: string | null,
      f: string | null,
    ) => {
      setRepoPath(r);
      setBranch(b);
      if (f) {
        setFolderPath(f);
        setEntityType('folder');
      } else if (r) {
        setFolderPath(null);
        setEntityType('repo');
      }
      setShowRepoFolderPicker(false);
    },
    [],
  );

  useEffect(() => {
    if (submitState !== 'added') return;
    const timer = setTimeout(() => {
      if (navigation.canGoBack()) navigation.goBack();
    }, 700);
    return () => clearTimeout(timer);
  }, [submitState, navigation]);

  const buildEntityLabel = useCallback((): string => {
    switch (entityType) {
      case 'note':
        return noteTitle || 'Untitled note';
      case 'folder':
        return folderPath || 'Unnamed folder';
      case 'repo':
        return repoPath?.split('/').pop() || repoPath || 'Unnamed repo';
      case 'tag':
        return tag || 'Unnamed tag';
      default:
        return '';
    }
  }, [entityType, noteTitle, folderPath, repoPath, tag]);

  const handleAdd = useCallback(async () => {
    if (submitState !== 'idle') return;
    if (!entityType) {
      Alert.alert('Pick a target', 'Choose what to be reminded about.');
      return;
    }
    if (entityType === 'note' && !noteId) {
      Alert.alert('Pick a note', 'Select the note to open.');
      return;
    }
    if (entityType === 'folder' && (!repoPath || !folderPath)) {
      Alert.alert('Pick a folder', 'Select a repository and folder.');
      return;
    }
    if (entityType === 'repo' && !repoPath) {
      Alert.alert('Pick a repo', 'Select a repository.');
      return;
    }
    if (entityType === 'tag' && !tag) {
      Alert.alert('Pick a tag', 'Select a tag to filter by.');
      return;
    }
    if (selectedDays.length === 0 && repeat !== 'daily') {
      Alert.alert('Pick a day', 'Select at least one day.');
      return;
    }

    const timeStr = selectedTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    setSubmitState('saving');

    const newItem = await createItem({
      entityType,
      entityLabel: buildEntityLabel(),
      time: timeStr,
      repeat,
      daysOfWeek: repeat === 'daily' ? selectedDays : selectedDays,
      noteId: noteId ?? undefined,
      repoPath: repoPath ?? undefined,
      folderPath: folderPath ?? undefined,
      tag: tag ?? undefined,
    });

    if (newItem) {
      await ReminderService.scheduleNotification(newItem);
      setSubmitState('added');
      resetForm();
      return;
    }

    setSubmitState('idle');
  }, [
    submitState,
    entityType,
    noteId,
    repoPath,
    folderPath,
    tag,
    selectedDays,
    selectedTime,
    repeat,
    createItem,
    resetForm,
    buildEntityLabel,
  ]);

  const clearTarget = useCallback(() => {
    setEntityType(null);
    setNoteId(null);
    setNoteTitle('');
    setRepoPath(null);
    setBranch(null);
    setFolderPath(null);
    setTag(null);
  }, []);

  const showDaysRow = repeat !== 'daily';

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['bottom']}
    >
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing[4],
          paddingTop: headerHeight + spacing[4],
          paddingBottom: insets.bottom + spacing[8],
          gap: spacing[4],
        }}
      >
        <Group title="Target">
          <View style={{ padding: spacing[4], gap: spacing[3] }}>
            {TARGET_OPTIONS.map((opt) => {
              const isSelected = entityType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => {
                    if (opt.value === 'note') {
                      setShowNotePicker(true);
                    } else if (opt.value === 'folder' || opt.value === 'repo') {
                      setShowRepoFolderPicker(true);
                    } else {
                      setShowTagPicker(true);
                    }
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing[3],
                    padding: spacing[4],
                    borderRadius: 16,
                    backgroundColor: isSelected
                      ? colors.primary + '16'
                      : colors.surfaceSecondary,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                  }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={24}
                    color={isSelected ? colors.primary : colors.textSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: isSelected ? colors.primary : colors.text,
                        fontSize: type.sm,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: type.xs,
                        marginTop: 2,
                      }}
                    >
                      {opt.description}
                    </Text>
                  </View>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={colors.primary}
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}

            {entityType && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[2],
                  backgroundColor: colors.primary + '16',
                  borderWidth: 1,
                  borderColor: colors.primary + '28',
                  paddingHorizontal: spacing[3],
                  paddingVertical: spacing[2],
                  borderRadius: 999,
                  alignSelf: 'flex-start',
                }}
              >
                <Ionicons
                  name={
                    TARGET_OPTIONS.find((o) => o.value === entityType)?.icon ??
                    'help-outline'
                  }
                  size={16}
                  color={colors.primary}
                />
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: type.sm,
                    fontWeight: '600',
                  }}
                  numberOfLines={1}
                >
                  {buildEntityLabel()}
                </Text>
                <TouchableOpacity onPress={clearTarget} hitSlop={4}>
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Group>

        <Group title="Schedule">
          <View
            style={{
              paddingHorizontal: spacing[4],
              paddingVertical: spacing[3],
              gap: spacing[3],
            }}
          >
            <View style={{ flexDirection: 'row', gap: spacing[1] }}>
              <TouchableOpacity
                onPress={() => setRepeat('daily')}
                style={{
                  flex: 1,
                  paddingVertical: spacing[3],
                  borderRadius: 16,
                  alignItems: 'center',
                  backgroundColor:
                    repeat === 'daily'
                      ? colors.primary
                      : colors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor:
                    repeat === 'daily' ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: repeat === 'daily' ? ON_FILLED : colors.text,
                    fontSize: type.sm,
                    fontWeight: '600',
                  }}
                >
                  Daily
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setRepeat('weekly')}
                style={{
                  flex: 1,
                  paddingVertical: spacing[3],
                  borderRadius: 16,
                  alignItems: 'center',
                  backgroundColor:
                    repeat === 'weekly'
                      ? colors.primary
                      : colors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor:
                    repeat === 'weekly' ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: repeat === 'weekly' ? ON_FILLED : colors.text,
                    fontSize: type.sm,
                    fontWeight: '600',
                  }}
                >
                  Weekly
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setRepeat('one-time')}
                style={{
                  flex: 1,
                  paddingVertical: spacing[3],
                  borderRadius: 16,
                  alignItems: 'center',
                  backgroundColor:
                    repeat === 'one-time'
                      ? colors.primary
                      : colors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor:
                    repeat === 'one-time' ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: repeat === 'one-time' ? ON_FILLED : colors.text,
                    fontSize: type.sm,
                    fontWeight: '600',
                  }}
                >
                  One-time
                </Text>
              </TouchableOpacity>
            </View>

            {showDaysRow && (
              <View style={{ flexDirection: 'row', gap: spacing[1] }}>
                {DAY_OF_WEEK_OPTIONS.map((opt) => {
                  const isSelected = selectedDays.includes(opt.value);
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => toggleDay(opt.value)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        paddingVertical: spacing[2],
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSelected
                          ? colors.primary
                          : colors.surfaceSecondary,
                        borderWidth: 1,
                        borderColor: isSelected
                          ? colors.primary
                          : colors.border,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: type.xs,
                          fontWeight: '700',
                          color: isSelected ? ON_FILLED : colors.text,
                        }}
                      >
                        {opt.short}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              onPress={() => setShowTimePicker(true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: spacing[3],
                paddingVertical: spacing[3],
                minHeight: 48,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 16,
                backgroundColor:
                  colors.surfaceSecondary,
              }}
            >
              <Text
                className="text-base"
                style={{ color: colors.text }}
              >
                Time
              </Text>
              <View className="flex-row items-center gap-1">
                <Text
                  className="text-[15px]"
                  style={{ color: colors.textSecondary }}
                >
                  {formatTime(selectedTime)}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color={colors.textSecondary}
                />
              </View>
            </TouchableOpacity>
          </View>
        </Group>

        <Button
          onPress={handleAdd}
          disabled={submitState !== 'idle'}
          fullWidth
          style={{
            backgroundColor:
              submitState === 'added' ? colors.success : colors.primary,
            minHeight: 54,
            opacity: submitState === 'saving' ? 0.85 : 1,
          }}
          textStyle={{ color: ON_FILLED, fontWeight: '700' }}
          leadingIcon={
            submitState === 'saving' ? (
              <ActivityIndicator size="small" color={ON_FILLED} />
            ) : submitState === 'added' ? (
              <Ionicons name="checkmark-circle" size={20} color={ON_FILLED} />
            ) : undefined
          }
          testID="add-reminder-submit"
        >
          {submitState === 'saving'
            ? 'Saving'
            : submitState === 'added'
              ? 'Reminder Added'
              : 'Add Reminder'}
        </Button>
      </ScrollView>

      <ScreenHeader
        title="New Reminder"
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <Modal
        visible={showTimePicker}
        onRequestClose={() => setShowTimePicker(false)}
        bottomSheet
        contentStyle={{ padding: 16, paddingBottom: 34 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <Text
            style={{ fontSize: 18, fontWeight: '600', color: colors.text }}
          >
            Select Time
          </Text>
          <TouchableOpacity
            onPress={() => setShowTimePicker(false)}
            hitSlop={8}
          >
            <Ionicons
              name="close"
              size={22}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
        <DateTimePicker
          value={selectedTime}
          mode="time"
          display="spinner"
          onChange={(_, date) => {
            if (date) {
              setSelectedTime(date);
              setShowTimePicker(false);
            }
          }}
          accentColor={colors.primary}
          themeVariant={isDark ? 'dark' : 'light'}
        />
      </Modal>

      <NotePickerModal
        visible={showNotePicker}
        onClose={() => setShowNotePicker(false)}
        onSelect={handleNoteSelected}
      />

      <RepoFolderPickerModal
        visible={showRepoFolderPicker}
        repoPath={repoPath}
        branch={branch}
        folderPath={folderPath}
        onSelect={handleRepoFolderSelect}
        onClose={() => setShowRepoFolderPicker(false)}
      />

      <Modal
        visible={showTagPicker}
        onRequestClose={() => setShowTagPicker(false)}
        bottomSheet
        contentStyle={{ padding: 16, paddingBottom: 34, maxHeight: '70%' }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <Text
            style={{ fontSize: 18, fontWeight: '600', color: colors.text }}
          >
            Pick a Tag
          </Text>
          <TouchableOpacity
            onPress={() => setShowTagPicker(false)}
            hitSlop={8}
          >
            <Ionicons
              name="close"
              size={22}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
        <ScrollView>
          {allTags.length === 0 ? (
            <Text
              style={{
                textAlign: 'center',
                color: colors.textSecondary,
                paddingVertical: 24,
              }}
            >
              No tags yet
            </Text>
          ) : (
            allTags.map((tg) => (
              <TouchableOpacity
                key={tg}
                onPress={() => {
                  setTag(tg);
                  setEntityType('tag');
                  setShowTagPicker(false);
                }}
                style={{
                  paddingVertical: 12,
                  borderBottomWidth: 0.5,
                  borderBottomColor: colors.border,
                }}
              >
                <Text
                  style={{
                    color: tag === tg ? colors.primary : colors.text,
                    fontSize: 16,
                  }}
                >
                  #{tg}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}
