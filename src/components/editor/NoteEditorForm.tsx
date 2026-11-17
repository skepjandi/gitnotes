import React, { useCallback, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, useTokens } from '../../contexts/ThemeContext';
import { NoteFormat } from '../../models/Note';
import { HapticService } from '../../utils/haptics';
import { canPersistNoteTags } from '../../utils/noteTagSupport';
import GitContextPicker from '../GitContextPicker';
import MarkdownEditor, { type MarkdownEditorHandle } from '../MarkdownEditor';
import { MarkdownToolbar } from '../MarkdownToolbar';
import TagInput from '../TagInput';
import { FORMAT_OPTIONS } from './editorShared';

interface NoteEditorFormProps {
  repo?: string;
  title: string;
  folderPath?: string;
  noteFormat: NoteFormat;
  tags: string[];
  canvasJsonRefs: string[];
  content: string;
  placeholder: string;
  onRepoChange: (repo: string | undefined) => void;
  onTitleChange: (value: string) => void;
  onOpenFolderDialog: () => void;
  onNoteFormatChange: (format: NoteFormat) => void;
  onTagsChange: (tags: string[]) => void;
  onEditCanvasJson: (uri: string) => void;
  onContentChange: (value: string) => void;
  /** Open the in-file search bar as soon as the editor mounts. */
  autoOpenSearch?: boolean;
}

export function NoteEditorForm({
  repo,
  title,
  folderPath,
  noteFormat,
  tags,
  canvasJsonRefs,
  content,
  placeholder,
  onRepoChange,
  onTitleChange,
  onOpenFolderDialog,
  onNoteFormatChange,
  onTagsChange,
  onEditCanvasJson,
  onContentChange,
  autoOpenSearch,
}: NoteEditorFormProps) {
  const { colors } = useTheme();
  const { spacing, type } = useTokens();
  const bodyRef = useRef<MarkdownEditorHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const editorTop = useRef(0);

  // Keep the caret line visible: when it falls below the visible area (hidden by
  // the keyboard / sticky toolbar) scroll just enough to bring it back.
  const handleCaretBottomChange = useCallback((caretBottom: number) => {
    const absoluteBottom = editorTop.current + caretBottom + CARET_BOTTOM_MARGIN;
    const visibleBottom = scrollY.current + viewportHeight.current;
    if (viewportHeight.current > 0 && absoluteBottom > visibleBottom) {
      scrollRef.current?.scrollTo({ y: scrollY.current + (absoluteBottom - visibleBottom), animated: false });
    }
  }, []);

  return (
    <View style={styles.container}>
    <ScrollView
      ref={scrollRef}
      style={styles.scrollView}
      scrollEventThrottle={16}
      onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
      onLayout={(e) => { viewportHeight.current = e.nativeEvent.layout.height; }}
      contentContainerStyle={[styles.editorContent, { paddingBottom: 120 }]}
      keyboardShouldPersistTaps="handled"
      // Keep the focused body TextInput visible above the keyboard +
      // sticky format toolbar (#727) — without this the multiline input
      // sits behind the keyboard and users type blind on iOS.
      automaticallyAdjustKeyboardInsets
    >
      <View testID="note-editor-form.picker.repo" style={[styles.gitContextContainer, { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[5] }]}>
        <GitContextPicker
          repo={repo}
          entityType="note"
          onRepoChange={onRepoChange}
        />
      </View>

      <TextInput
        testID="note-editor-form.input.title"
        style={[styles.titleInput, { color: colors.text, borderBottomColor: colors.border, fontSize: type.xl, paddingHorizontal: spacing[4], paddingVertical: spacing[4] }]}
        placeholder="Note Title"
        placeholderTextColor={colors.textSecondary}
        value={title}
        onChangeText={onTitleChange}
        maxLength={100}
        autoCapitalize="sentences"
        returnKeyType="next"
        // Pressing Return on the keyboard hops into the body editor (#628)
        // — gives a deterministic way to leave the title field even when the
        // OS doesn't transfer focus from a tap on the body input.
        onSubmitEditing={() => bodyRef.current?.focus()}
      />

      <TouchableOpacity
        testID="note-editor-form.button.open-folder"
        accessibilityRole="button"
        style={[
          styles.folderSelector,
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, marginHorizontal: spacing[4], marginTop: spacing[3], marginBottom: spacing[1], paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
          !repo && styles.folderSelectorDisabled,
        ]}
        onPress={() => {
          if (!repo) return;
          HapticService.light();
          onOpenFolderDialog();
        }}
        activeOpacity={repo ? 0.7 : 1}
        disabled={!repo}
        accessibilityState={{ disabled: !repo }}
      >
        <Ionicons name="folder-outline" size={18} color={folderPath ? colors.primary : colors.textSecondary} />
        <Text style={[styles.folderSelectorLabel, { color: colors.textSecondary }]}>Folder</Text>
        <Text style={[styles.folderSelectorText, { color: folderPath ? colors.text : colors.textSecondary }]} numberOfLines={1}>
          {folderPath || 'None'}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      {!repo ? (
        <Text
          testID="note-editor-form.text.folder-no-repo-hint"
          style={[styles.folderHint, { color: colors.textSecondary }]}
        >
          Select a repository before choosing a folder.
        </Text>
      ) : null}

      <View style={[styles.formatRow, { borderBottomColor: colors.border, paddingHorizontal: spacing[4], paddingVertical: spacing[2] + 1 }]}>
        <Ionicons name="document-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.formatRowLabel, { color: colors.textSecondary }]}>Format</Text>
        <View style={styles.formatOptions}>
          {FORMAT_OPTIONS.map(({ label, value }) => (
            <TouchableOpacity
              key={value}
              testID="note-editor-form.picker.format"
              accessibilityRole="button"
              accessibilityState={{ selected: noteFormat === value }}
              style={[
                styles.formatChip,
                { borderColor: colors.border },
                noteFormat === value && { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
              ]}
              onPress={() => {
                onNoteFormatChange(value);
                HapticService.selection();
              }}
            >
              <Text style={[styles.formatChipText, { color: noteFormat === value ? colors.primary : colors.textSecondary }]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {canPersistNoteTags(noteFormat) ? <View testID="note-editor-form.input.tags"><TagInput tags={tags} onTagsChange={onTagsChange} /></View> : null}

      {canvasJsonRefs.length > 0 ? (
        <View style={[styles.canvasChipsRow, { paddingHorizontal: spacing[4], paddingTop: spacing[2] }]}>
          <Text style={[styles.canvasChipsLabel, { color: colors.textSecondary }]}>Canvases</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.canvasChipsScroll, { paddingRight: spacing[4] }]}>
            {canvasJsonRefs.map((uri, index) => (
              <TouchableOpacity
                key={uri}
                testID="note-editor-form.button.edit-canvas"
                style={[styles.canvasChip, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginRight: spacing[2] }]}
                onPress={() => onEditCanvasJson(uri)}
                activeOpacity={0.7}
              >
                <Ionicons name="brush-outline" size={14} color={colors.primary} />
                <Text style={[styles.canvasChipText, { color: colors.text }]} numberOfLines={1}>{`Canvas ${index + 1}`}</Text>
                <Ionicons name="pencil" size={12} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View onLayout={(e) => { editorTop.current = e.nativeEvent.layout.y; }}>
      <MarkdownEditor
        ref={bodyRef}
        content={content}
        onContentChange={onContentChange}
        placeholder={placeholder}
        inputTestID="note-editor-form.input.content"
        showToolbar={false}
        format={noteFormat}
        autoOpenSearch={autoOpenSearch}
        onCaretBottomChange={handleCaretBottomChange}
      />
      </View>
    </ScrollView>

    <View
      style={[styles.stickyToolbar, { backgroundColor: colors.surface, borderTopColor: colors.border }, Platform.OS === 'android' && styles.stickyToolbarAndroid]}
      testID="note-editor-form.toolbar.sticky"
    >
      <MarkdownToolbar
        onFormat={(action) => bodyRef.current?.applyFormat(action)}
        format={noteFormat}
      />
    </View>
    </View>
  );
}

// Extra space kept below the caret line when auto-scrolling.
const CARET_BOTTOM_MARGIN = 24;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  editorContent: {},
  stickyToolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Lift the toolbar off the Android gesture/navigation bar so taps don't
  // collide with the system pill.
  stickyToolbarAndroid: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  gitContextContainer: {},
  titleInput: {
    fontWeight: '600',
    borderBottomWidth: 1,
  },
  folderSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  folderSelectorLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  folderSelectorText: {
    flex: 1,
    fontSize: 15,
    textAlign: 'right',
  },
  folderSelectorDisabled: {
    opacity: 0.5,
  },
  folderHint: {
    fontSize: 12,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    gap: 8,
  },
  formatRowLabel: {
    fontSize: 14,
    marginRight: 4,
  },
  formatOptions: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
  },
  formatChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  formatChipText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  canvasChipsRow: {},
  canvasChipsLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  canvasChipsScroll: {
    gap: 8,
  },
  canvasChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  canvasChipText: {
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 120,
  },
});
