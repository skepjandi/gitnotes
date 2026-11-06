import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native/datetimepicker';
import { format } from 'date-fns';

import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { PRIORITY_COLORS, PRIORITY_LABELS, REMINDER_OPTIONS, Todo, TodoPriority } from '../../models/Todo';
import GitContextPicker from '../GitContextPicker';
import { findReminderLabel } from './todosShared';
import { Palette, readableInk } from '../../theme/tokens';

interface TodoEditorModalProps {
  visible: boolean;
  editingTodo: Todo | null;
  todoText: string;
  todoNotes: string;
  todoPriority: TodoPriority;
  todoDueDate?: number;
  todoReminderMinutes: number;
  showDatePicker: boolean;
  showTimePicker: boolean;
  showReminderPicker: boolean;
  todoRepo?: string;
  isDark: boolean;
  onClose: () => void;
  onChangeText: (value: string) => void;
  onChangeNotes: (value: string) => void;
  onChangePriority: (value: TodoPriority) => void;
  onToggleDatePicker: () => void;
  onToggleTimePicker: () => void;
  onDateChange: (_event: any, selectedDate?: Date) => void;
  onTimeChange: (_event: any, selectedDate?: Date) => void;
  onAddDeadline: () => void;
  onRemoveDeadline: () => void;
  onToggleReminderPicker: () => void;
  onSelectReminderMinutes: (minutes: number) => void;
  onRepoChange: (repo: string | undefined) => void;
  onSubmit: () => void;
}

export function TodoEditorModal({
  visible,
  editingTodo,
  todoText,
  todoNotes,
  todoPriority,
  todoDueDate,
  todoReminderMinutes,
  showDatePicker,
  showTimePicker,
  showReminderPicker,
  todoRepo,
  isDark,
  onClose,
  onChangeText,
  onChangeNotes,
  onChangePriority,
  onToggleDatePicker,
  onToggleTimePicker,
  onDateChange,
  onTimeChange,
  onAddDeadline,
  onRemoveDeadline,
  onToggleReminderPicker,
  onSelectReminderMinutes,
  onRepoChange,
  onSubmit,
}: TodoEditorModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useTranslation();
  const modalScrollRef = useRef<ScrollView>(null);

  const handleReminderPickerToggle = () => {
    const next = !showReminderPicker;
    onToggleReminderPicker();
    if (next) {
      requestAnimationFrame(() => {
        modalScrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}> 
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingTodo ? t('todos.editTodo') : t('todos.newTodo')}
            </Text>
            <TouchableOpacity testID="todo-editor.button.close" onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView ref={modalScrollRef} style={styles.modalBody} contentContainerStyle={{ flexGrow: 1 }}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('todos.todoText')} *</Text>
            <TextInput
              testID="todo-editor.input.title"
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              value={todoText}
              onChangeText={onChangeText}
              placeholder={t('todos.whatNeedsToBeDone')}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="sentences"
              returnKeyType="done"
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('todos.notes')}</Text>
            <TextInput
              testID="todo-editor.input.notes"
              style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border }]}
              value={todoNotes}
              onChangeText={onChangeNotes}
              placeholder={t('todos.additionalNotes')}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="sentences"
              multiline
              numberOfLines={3}
            />

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('todos.priority')}</Text>
            <View style={styles.priorityContainer}>
              {(['low', 'medium', 'high'] as TodoPriority[]).map((priority) => (
                <TouchableOpacity
                  key={priority}
                  testID={`todo-editor.button.priority-${priority}`}
                  style={[
                    styles.priorityOption,
                    { borderColor: colors.border },
                    todoPriority === priority && {
                      borderColor: PRIORITY_COLORS[priority],
                      backgroundColor: PRIORITY_COLORS[priority] + '15',
                    },
                  ]}
                  onPress={() => onChangePriority(priority)}
                >
                  <Text
                    style={[
                      styles.priorityOptionText,
                      { color: todoPriority === priority ? PRIORITY_COLORS[priority] : colors.textSecondary },
                    ]}
                  >
                    {PRIORITY_LABELS[priority]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {todoDueDate ? (
              <View
                style={[
                  styles.deadlineCard,
                  { backgroundColor: colors.primary + '08', borderColor: colors.primary + '30' },
                ]}
              >
                <View style={styles.deadlineCardHeader}>
                  <View style={styles.deadlineCardLabel}>
                    <Ionicons name="calendar" size={15} color={colors.primary} />
                    <Text style={[styles.deadlineCardTitle, { color: colors.primary }]}>{t('todos.deadline')}</Text>
                  </View>
                  <TouchableOpacity testID="todo-editor.button.remove-deadline" onPress={onRemoveDeadline} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.deadlineCardRow}>
                  <TouchableOpacity
                    testID="todo-editor.button.date-picker"
                    style={[
                      styles.deadlineSlot,
                      {
                        backgroundColor: colors.surface,
                        borderColor: showDatePicker ? colors.primary : colors.primary + '40',
                      },
                    ]}
                    onPress={onToggleDatePicker}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                    <Text style={[styles.deadlineSlotText, { color: colors.text }]}>
                      {format(new Date(todoDueDate), 'EEE, MMM d')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.deadlineSlot,
                      {
                        backgroundColor: colors.surface,
                        borderColor: showTimePicker ? colors.primary : colors.primary + '40',
                      },
                    ]}
                    onPress={onToggleTimePicker}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="time-outline" size={16} color={colors.primary} />
                    <Text style={[styles.deadlineSlotText, { color: colors.text }]}>
                      {format(new Date(todoDueDate), 'h:mm a')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {showDatePicker ? (
                  <View style={[styles.pickerWrapper, { backgroundColor: colors.surface }]}> 
                    <DateTimePicker
                      value={new Date(todoDueDate)}
                      mode="date"
                      display="spinner"
                      onChange={onDateChange}
                      minimumDate={new Date()}
                      accentColor={colors.primary}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                  </View>
                ) : null}
                {showTimePicker ? (
                  <View style={[styles.pickerWrapper, { backgroundColor: colors.surface }]}> 
                    <DateTimePicker
                      value={new Date(todoDueDate)}
                      mode="time"
                      display="spinner"
                      onChange={onTimeChange}
                      accentColor={colors.primary}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                  </View>
                ) : null}
              </View>
            ) : (
              <TouchableOpacity
                testID="todo-editor.button.add-deadline"
                style={[styles.addDeadlineButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={onAddDeadline}
                activeOpacity={0.7}
              >
                <View style={[styles.addDeadlineIcon, { backgroundColor: colors.primary + '15' }]}> 
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                </View>
                <Text style={[styles.addDeadlineText, { color: colors.primary }]}>{t('todos.setDeadline')}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textSecondary}
                  style={{ marginLeft: 'auto' }}
                />
              </TouchableOpacity>
            )}

            {todoDueDate ? (
              <>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('todos.remindMe')}</Text>
                <TouchableOpacity
                  style={[styles.reminderPickerButton, { borderColor: colors.border }]}
                  onPress={handleReminderPickerToggle}
                >
                  <Ionicons name="notifications-outline" size={16} color={colors.warning} />
                  <Text style={[styles.reminderPickerText, { color: colors.text }]}>
                    {findReminderLabel(todoReminderMinutes)}
                  </Text>
                  <Ionicons
                    name={showReminderPicker ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {showReminderPicker ? (
                  <View style={[styles.reminderOptions, { borderColor: colors.border }]}> 
                    {REMINDER_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.minutes}
                        style={[
                          styles.reminderOption,
                          todoReminderMinutes === option.minutes && { backgroundColor: '#FF950015' },
                        ]}
                        onPress={() => onSelectReminderMinutes(option.minutes)}
                      >
                        <Text
                          style={[
                            styles.reminderOptionText,
                            { color: todoReminderMinutes === option.minutes ? colors.warning : colors.text },
                          ]}
                        >
                          {option.label}
                        </Text>
                        {todoReminderMinutes === option.minutes ? (
                          <Ionicons name="checkmark" size={16} color={colors.warning} />
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          <View style={styles.gitContextContainer}>
            <GitContextPicker
              repo={todoRepo}
              entityType="todo"
              onRepoChange={onRepoChange}
            />
          </View>

          <View style={[styles.modalFooter, { borderTopColor: colors.border }]}> 
            <TouchableOpacity
              testID="todo-editor.button.cancel"
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="todo-editor.button.submit" style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={onSubmit}>
              <Text style={styles.saveButtonText}>{editingTodo ? t('common.update') : t('common.add')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: `${colors.bg}80`,
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalBody: {
    padding: 20,
  },
  gitContextContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  priorityContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  priorityOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  priorityOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  deadlineCard: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  deadlineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deadlineCardLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deadlineCardTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  deadlineCardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  deadlineSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
  },
  deadlineSlotText: {
    fontSize: 14,
    fontWeight: '500',
  },
  addDeadlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    gap: 10,
  },
  addDeadlineIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDeadlineText: {
    fontSize: 15,
    fontWeight: '500',
  },
  reminderPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    gap: 8,
  },
  reminderPickerText: {
    flex: 1,
    fontSize: 14,
  },
  reminderOptions: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  reminderOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reminderOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pickerWrapper: {
    marginTop: 12,
    borderRadius: 10,
    alignItems: 'center',
    overflow: 'hidden',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: readableInk(colors.primary),
  },
});
