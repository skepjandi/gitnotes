import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { TextSearchBar } from './TextSearchBar';
import { searchText, navigateToMatch, MatchPosition } from '../utils/textSearch';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { UndoRedoButtons } from './UndoRedoButtons';
import { MarkdownToolbar } from './MarkdownToolbar';
import type { FormatAction, Selection } from '../utils/markdownFormatting';
import { useHardWrap } from '../hooks/useHardWrap';
import type { NoteFormat } from '../models/Note';

const EDITOR_PADDING = 16;
const EDITOR_LINE_HEIGHT = 24;

function lineRange(text: string, pos: number): { lineStart: number; lineEnd: number } {
  let lineStart = pos;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
  let lineEnd = pos;
  while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++;
  return { lineStart, lineEnd };
}

/**
 * Apply a FormatAction emitted by the toolbar against the current selection.
 * Pre-#690 the editor branched on `action.before` string equality to pick a
 * format-specific helper (`toggleBold` for `**`, `toggleHeading` for `# `,
 * etc.) — fine while the toolbar only knew markdown, but it silently fell
 * through whenever the preset emitted Org / Neorg syntax (`* ` heading,
 * `/italic/`, `=code=`, …). Dispatch by `action.type` instead so any
 * future format preset works without an editor change.
 */
function applyFormatAction(text: string, sel: Selection, action: FormatAction): { text: string; selection: Selection } | undefined {
  if (action.type === 'wrap') {
    const after = action.after ?? action.before;
    const selected = text.slice(sel.start, sel.end);
    if (
      selected.startsWith(action.before) &&
      selected.endsWith(after) &&
      selected.length >= action.before.length + after.length
    ) {
      const inner = selected.slice(action.before.length, selected.length - after.length);
      return {
        text: text.slice(0, sel.start) + inner + text.slice(sel.end),
        selection: { start: sel.start, end: sel.start + inner.length },
      };
    }
    const wrapped = action.before + selected + after;
    return {
      text: text.slice(0, sel.start) + wrapped + text.slice(sel.end),
      selection: { start: sel.start, end: sel.start + wrapped.length },
    };
  }

  if (action.type === 'line') {
    const { lineStart, lineEnd } = lineRange(text, sel.start);
    const line = text.slice(lineStart, lineEnd);
    const prefix = action.before;
    const newLine = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
    return {
      text: text.slice(0, lineStart) + newLine + text.slice(lineEnd),
      selection: sel,
    };
  }

  // insert
  return {
    text: text.slice(0, sel.start) + action.before + text.slice(sel.end),
    selection: { start: sel.start + action.before.length, end: sel.start + action.before.length },
  };
}

interface MarkdownEditorProps {
  content: string;
  onContentChange: (text: string) => void;
  placeholder?: string;
  /**
   * testID applied directly to the inner TextInput so a Maestro/XCUITest tap
   * focuses the input rather than an outer wrapper view (#624).
   */
  inputTestID?: string;
  /**
   * Render the built-in MarkdownToolbar below the editor. Pass `false` when
   * the toolbar is being hosted externally (NoteEditorForm pins it to the
   * screen bottom so it doesn't scroll with the form).
   */
  showToolbar?: boolean;
  /**
   * Active note format. Determines which syntax preset the toolbar uses
   * (`.md` → markdown, `.org` → org-mode, `.norg` → neorg).
   */
  format?: NoteFormat;
  /** Open the in-file search bar on mount (used when entering from the viewer's search button). */
  autoOpenSearch?: boolean;
  /**
   * Reports the estimated bottom edge (px, relative to this editor's top) of the
   * caret line so a parent scroller can keep it above the keyboard / toolbar.
   */
  onCaretBottomChange?: (caretBottom: number) => void;
}

/**
 * Imperative handle exposed via `forwardRef` so a parent (e.g. NoteEditorForm)
 * can move keyboard focus into the body editor without reaching into private
 * state — used to hop from title → body on the title's `onSubmitEditing`
 * (#628), since iOS doesn't reliably transfer focus from a tap on a multiline
 * TextInput while another sibling input is autofocused.
 */
export interface MarkdownEditorHandle {
  focus: () => void;
  /**
   * Apply a markdown formatting action against the current selection. The
   * imperative handle exists so a parent can host a sticky toolbar outside
   * the editor's own layout.
   */
  applyFormat: (action: FormatAction) => void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ content, onContentChange, placeholder = 'Start writing...', inputTestID, showToolbar = true, format, autoOpenSearch = false, onCaretBottomChange }, ref) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const handleFormatRef = useRef<(action: FormatAction) => void>(null!);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    applyFormat: (action: FormatAction) => {
      if (handleFormatRef.current) {
        handleFormatRef.current(action);
      }
    },
  }), []);
  const { text, setText, undo, redo, canUndo, canRedo, reset } = useUndoRedo(content);
  const previousTextRef = useRef(text);
  const prevPropContentRef = useRef(content);
  const { hardWrapEnabled, toggleHardWrap } = useHardWrap();
  const [cursor, setCursor] = useState<Selection>({ start: 0, end: 0 });

  const [isSearching, setIsSearching] = useState(autoOpenSearch);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<MatchPosition[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);

  useEffect(() => {
    if (previousTextRef.current === text) {
      return;
    }

    previousTextRef.current = text;
    onContentChange(text);
  }, [onContentChange, text]);

  useEffect(() => {
    if (content !== prevPropContentRef.current && content !== previousTextRef.current) {
      previousTextRef.current = content;
      prevPropContentRef.current = content;
      reset(content);
    }
    prevPropContentRef.current = content;
  }, [content, reset]);

  const [inputTop, setInputTop] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (!onCaretBottomChange || contentHeight === 0) return;
    const length = text.length;
    const caret = Math.min(cursor.end, length);
    // At the end of the text the caret line is the last line: exact. Elsewhere
    // interpolate by character offset (wrapped-line heights are not exposed).
    const ratio = length === 0 ? 0 : caret / length;
    const textArea = Math.max(contentHeight - EDITOR_PADDING * 2, 0);
    const caretBottom = caret >= length
      ? contentHeight - EDITOR_PADDING
      : EDITOR_PADDING + Math.max(textArea * ratio, EDITOR_LINE_HEIGHT);
    onCaretBottomChange(inputTop + caretBottom);
  }, [cursor.end, text, contentHeight, inputTop, onCaretBottomChange]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    const found = searchText(text, query);
    setMatches(found);
    setCurrentMatchIndex(0);
    if (found.length > 0) {
      setSelection({ start: found[0].start, end: found[0].end });
    } else {
      setSelection(undefined);
    }
  }, [text]);

  const handleNavigate = useCallback((index: number) => {
    if (matches.length === 0) return;
    const match = navigateToMatch(matches, index);
    const normalizedIndex = ((index % matches.length) + matches.length) % matches.length;
    setCurrentMatchIndex(normalizedIndex);
    setSelection({ start: match.start, end: match.end });
    inputRef.current?.focus();
  }, [matches]);

  const handleClose = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
    setMatches([]);
    setCurrentMatchIndex(0);
    setSelection(undefined);
  }, []);

  const handleToggleSearch = useCallback(() => {
    if (isSearching) {
      handleClose();
    } else {
      setIsSearching(true);
    }
  }, [isSearching, handleClose]);

  const handleContentChange = useCallback((text: string) => {
    setText(text);
  }, [setText]);

  useEffect(() => {
    if (!isSearching || !searchQuery) {
      return;
    }

    const found = searchText(text, searchQuery);
    setMatches(found);

    if (found.length === 0) {
      setCurrentMatchIndex(0);
      setSelection(undefined);
      return;
    }

    const safeIndex = Math.min(currentMatchIndex, found.length - 1);
    setCurrentMatchIndex(safeIndex);
    setSelection({ start: found[safeIndex].start, end: found[safeIndex].end });
  }, [currentMatchIndex, isSearching, searchQuery, text]);

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const handleFormat = useCallback((action: FormatAction) => {
    const sel = { start: cursor.start, end: cursor.end };
    const result = applyFormatAction(text, sel, action);
    if (result) setText(result.text);
  }, [cursor, text, setText]);

  handleFormatRef.current = handleFormat;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity testID="search-toggle" onPress={handleToggleSearch} hitSlop={8}>
          <Ionicons name={isSearching ? 'search' : 'search-outline'} size={20} color={isSearching ? colors.primary ?? colors.text : colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="hardwrap-toggle"
            onPress={toggleHardWrap}
            hitSlop={8}
            accessibilityLabel="Toggle hard wrap"
            style={[styles.hardWrapToggle, hardWrapEnabled && { backgroundColor: (colors.primary ?? colors.text) + '1F' }]}
          >
            <Ionicons
              name="return-down-back"
              size={16}
              color={hardWrapEnabled ? (colors.primary ?? colors.text) : colors.textSecondary}
            />
            <Text style={[styles.hardWrapLabel, { color: hardWrapEnabled ? (colors.primary ?? colors.text) : colors.textSecondary }]}>
              Wrap
            </Text>
          </TouchableOpacity>
          <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={handleUndo} onRedo={handleRedo} />
        </View>
      </View>

      {isSearching && (
        <TextSearchBar
          totalMatches={matches.length}
          currentIndex={currentMatchIndex}
          onSearch={handleSearch}
          onNavigate={handleNavigate}
          onClose={handleClose}
        />
      )}

      <TextInput
        ref={inputRef}
        testID={inputTestID}
        style={[styles.editor, { color: colors.text }]}
        value={text}
        onChangeText={handleContentChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline
        textAlignVertical="top"
        blurOnSubmit={false}
        selection={selection}
        onLayout={(e) => setInputTop(e.nativeEvent.layout.y)}
        onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
        onSelectionChange={(e) => {
          const { start, end } = e.nativeEvent.selection;
          setCursor({ start, end });
          if (selection !== undefined) {
            setSelection(undefined);
          }
        }}
      />

      {showToolbar && (
        <View testID="markdown-editor.toolbar-action.press">
          <MarkdownToolbar onFormat={handleFormat} format={format} />
        </View>
      )}
    </View>
  );
});

export default MarkdownEditor;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hardWrapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  hardWrapLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  editor: {
    fontSize: 16,
    padding: 16,
    lineHeight: 24,
    minHeight: 300,
    flex: 1,
  },
});
