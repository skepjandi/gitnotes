import React, { useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  startOfWeek,
  getDay,
  addMonths,
  subMonths,
} from 'date-fns';

import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../contexts/ThemeContext';
import { useNotes } from '../contexts/NoteContext';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { ScreenHeader, useScreenHeaderHeight } from '../components/ui/ScreenHeader';
import {
  getJournalEntries,
  findJournalEntry,
  buildJournalEditorParams,
  journalNoteTitle,
  parseJournalDateFromTitle,
} from '../services/JournalService';
import { HapticService } from '../utils/haptics';
import { readableInk } from '../theme/tokens';

type CalendarRouteProp = RouteProp<RootStackParamList, 'Calendar'>;
type CalendarNavProp = NativeStackNavigationProp<RootStackParamList>;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarScreen() {
  const navigation = useNavigation<CalendarNavProp>();
  const route = useRoute<CalendarRouteProp>();
  const { colors } = useTheme();
  const { notes } = useNotes();
  const headerHeight = useScreenHeaderHeight();

  const initialDate = route.params?.selectedDate
    ? new Date(route.params.selectedDate)
    : new Date();

  const [currentMonth, setCurrentMonth] = React.useState(() =>
    startOfMonth(initialDate),
  );

  const journalEntries = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return getJournalEntries(notes, start, end);
  }, [notes, currentMonth]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = monthEnd;

    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const hasEntryOnDate = useCallback(
    (date: Date) => {
      return !!findJournalEntry(notes, date);
    },
    [notes],
  );

  const handlePrevMonth = useCallback(() => {
    HapticService.light();
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    HapticService.light();
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const handleDayPress = useCallback(
    (date: Date) => {
      HapticService.medium();
      const existing = findJournalEntry(notes, date);
      if (existing) {
        navigation.navigate('NoteEditor', { noteId: existing.id });
        return;
      }
      navigation.navigate('NoteEditor', buildJournalEditorParams(date));
    },
    [navigation, notes],
  );

  const renderDay = useCallback(
    ({ item }: { item: Date }) => {
      const inMonth = isSameMonth(item, currentMonth);
      const today = isToday(item);
      const entryExists = hasEntryOnDate(item);

      return (
        <TouchableOpacity
          onPress={() => handleDayPress(item)}
          style={{
            flex: 1,
            aspectRatio: 1,
            alignItems: 'center',
            justifyContent: 'center',
            margin: 2,
            borderRadius: 8,
            backgroundColor: today
              ? colors.primary
              : inMonth
                ? colors.surface
                : colors.background,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: today ? '700' : '500',
              color: today
                ? readableInk(colors.primary)
                : inMonth
                  ? colors.text
                  : colors.textSecondary,
            }}
          >
            {format(item, 'd')}
          </Text>
          {entryExists && (
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: today ? readableInk(colors.primary) : colors.primary,
                marginTop: 2,
              }}
            />
          )}
        </TouchableOpacity>
      );
    },
    [currentMonth, colors, hasEntryOnDate, handleDayPress],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Calendar"
        onBack={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 16, paddingVertical: 12, paddingTop: headerHeight }}>
        {/* Month Navigation Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <TouchableOpacity onPress={handlePrevMonth} style={{ padding: 8 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text
            style={{ fontSize: 18, fontWeight: '600', color: colors.text }}
          >
            {format(currentMonth, 'MMMM yyyy')}
          </Text>
          <TouchableOpacity onPress={handleNextMonth} style={{ padding: 8 }}>
            <Ionicons name="chevron-forward" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Weekday Headers */}
        <View
          style={{
            flexDirection: 'row',
            marginBottom: 8,
          }}
        >
          {WEEKDAYS.map((day) => (
            <View key={day} style={{ flex: 1, alignItems: 'center' }}>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: colors.textSecondary,
                }}
              >
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Calendar Grid */}
        <FlatList
          data={calendarDays}
          renderItem={renderDay}
          keyExtractor={(item) => format(item, 'yyyy-MM-dd')}
          numColumns={7}
          scrollEnabled={false}
          contentContainerStyle={{ gap: 0 }}
        />


        <View style={{ marginTop: 16 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: colors.textSecondary,
              marginBottom: 8,
            }}
          >
            {journalEntries.length === 0
              ? 'No entries this month'
              : `${journalEntries.length} ${journalEntries.length === 1 ? 'entry' : 'entries'} this month`}
          </Text>
          <FlatList
            data={journalEntries}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => {
              const entryDate = parseJournalDateFromTitle(item.title);
              const dayLabel = entryDate ? format(entryDate, 'EEE, MMM d') : '';
              const preview =
                item.content.split('\n')[0]?.slice(0, 60) ||
                item.content.slice(0, 60);
              return (
                <TouchableOpacity
                  onPress={() => navigation.navigate('NoteEditor', { noteId: item.id })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }}>
                      {dayLabel}
                    </Text>
                    {preview ? (
                      <Text
                        style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}
                        numberOfLines={1}
                      >
                        {preview}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
