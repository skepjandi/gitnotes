import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../contexts/ThemeContext';
import { TocEntry } from './editorShared';
import { HapticService } from '../../utils/haptics';
import { IconButton, Modal } from '../ui';
import { NotePreviewPane } from './NotePreviewPane';
import { NoteFormat } from '../../models/Note';

interface NoteViewerProps {
  noteId: string;
  title: string;
  noteFormat: NoteFormat;
  canEdit: boolean;
  canSpeak: boolean;
  isSpeaking: boolean;
  tocEntries: TocEntry[];
  showToc: boolean;
  onBack: () => void;
  onToggleToc: () => void;
  onToggleSpeak: () => void;
  onEdit: () => void;
  onCloseToc: () => void;
  onTocPress: (entry: TocEntry) => void;
  onNavigateToNote: (id: string) => void;
  previewContent: string;
  parsedStructuredContent: unknown[] | null;
  markdownStyles: any;
  notePreviewRenderer: any;
  pdfViewerUri: string;
  authToken?: string | null;
  pdfLoadError: { uri: string; message: string } | null;
  onPdfError: (message: string) => void;
  onOpenNote?: (path: string, fragment?: string) => boolean;
  currentNotePath?: string;
  headingPositions?: { current: Map<string, number> };
  previewScrollRef: React.RefObject<ScrollView | null>;
  onPreviewScroll: (event: any) => void;
  onPreviewContentSizeChange: () => void;
  isQuestionerNote?: boolean;
  isGrading?: boolean;
  onGradeAnswers?: () => void;
  /** Called to open the history modal for an eligible note */
  onOpenHistory?: () => void;
  /** Whether the note is eligible for history (has repo, branch, filePath, and is not PDF) */
  canViewHistory?: boolean;
}

export function NoteViewer({
  noteId: _noteId,
  title,
  noteFormat,
  canEdit,
  canSpeak,
  isSpeaking,
  tocEntries,
  showToc,
  onBack,
  onToggleToc,
  onToggleSpeak,
  onEdit,
  onCloseToc,
  onTocPress,
  onNavigateToNote: _onNavigateToNote,
  previewContent,
  parsedStructuredContent,
  markdownStyles,
  notePreviewRenderer,
  pdfViewerUri,
  authToken,
  pdfLoadError,
  onPdfError,
  onOpenNote,
  currentNotePath,
  headingPositions,
  previewScrollRef,
  onPreviewScroll,
  onPreviewContentSizeChange,
  isQuestionerNote,
  isGrading,
  onGradeAnswers,
  onOpenHistory,
  canViewHistory,
}: NoteViewerProps) {
  const { colors } = useTheme();
  const isPdfNote = noteFormat === 'pdf';

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface, gap: 8 }]}>
        <IconButton size="sm" testID="note-viewer.button.back" onPress={onBack} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color={colors.accent} />
        </IconButton>
        <Text
          testID="note-viewer.text.title"
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title?.trim() || 'Untitled'}
        </Text>

        {!isPdfNote && tocEntries.length > 0 ? (
          <IconButton
            size="sm"
            testID="note-viewer.button.toggle-toc"
            onPress={() => {
              HapticService.light();
              onToggleToc();
            }}
            accessibilityLabel="Table of contents"
          >
            <Ionicons name="list" size={18} color={colors.accent} />
          </IconButton>
        ) : null}

        {!isPdfNote && canSpeak ? (
          <IconButton size="sm" testID="note-viewer.button.toggle-speak" onPress={onToggleSpeak} accessibilityLabel="Read aloud">
            <Ionicons name={isSpeaking ? 'stop-circle' : 'volume-high'} size={18} color={colors.accent} />
          </IconButton>
        ) : null}

        {canEdit ? (
          <IconButton
            size="sm"
            testID="note-viewer.button.edit"
            onPress={() => {
              HapticService.light();
              onEdit();
            }}
            accessibilityLabel="Edit"
          >
            <Ionicons name="pencil" size={18} color={colors.accent} />
          </IconButton>
        ) : null}

        {canViewHistory && onOpenHistory ? (
          <IconButton
            size="sm"
            testID="note-viewer.button.history"
            onPress={() => {
              HapticService.light();
              onOpenHistory();
            }}
            accessibilityLabel="History"
          >
            <Ionicons name="git-commit-outline" size={18} color={colors.accent} />
          </IconButton>
        ) : null}
      </View>

      {isQuestionerNote && onGradeAnswers ? (
        <View style={[styles.gradingBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            testID="note-viewer.button.grade-answers"
            onPress={onGradeAnswers}
            disabled={isGrading}
            style={[styles.gradeButton, { backgroundColor: colors.primary, opacity: isGrading ? 0.7 : 1 }]}
          >
            {isGrading ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={[styles.gradeButtonText, { color: '#fff' }]}>Grade My Answers</Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-done" size={16} color="#fff" />
                <Text style={[styles.gradeButtonText, { color: '#fff' }]}>Grade My Answers</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <NotePreviewPane
        noteFormat={noteFormat}
        previewContent={previewContent}
        parsedStructuredContent={parsedStructuredContent}
        markdownStyles={markdownStyles}
        notePreviewRenderer={notePreviewRenderer}
        pdfViewerUri={pdfViewerUri}
        authToken={authToken}
        pdfLoadError={pdfLoadError}
        onPdfError={onPdfError}
        onOpenNote={onOpenNote}
        currentNotePath={currentNotePath}
        headingPositions={headingPositions}
        previewScrollRef={previewScrollRef}
        onScroll={onPreviewScroll}
        onContentSizeChange={onPreviewContentSizeChange}
      />

      <Modal
        visible={showToc}
        onRequestClose={onCloseToc}
        bottomSheet
        contentStyle={{ padding: 16, paddingBottom: 34 }}
      >
        <View style={styles.tocHeader}>
          <Text style={[styles.tocTitle, { color: colors.text }]}>Table of Contents</Text>
          <TouchableOpacity onPress={onCloseToc} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {tocEntries.length === 0 ? (
          <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 }}>
            No headings in this note.
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
            {tocEntries.map((entry, index) => {
              const levelColors = [colors.primary, colors.primary + '99', colors.textSecondary + '66'];
              const barColor = levelColors[Math.min(entry.level - 1, 2)];
              const indent = (entry.level - 1) * 16;
              return (
                <TouchableOpacity
                  key={`${entry.lineIndex}-${index}`}
                  testID="note-viewer.button.toc-entry"
                  onPress={() => {
                    HapticService.light();
                    onTocPress(entry);
                  }}
                  style={[styles.tocRow, { paddingLeft: 12 + indent }]}
                >
                  <View style={[styles.tocLevelBar, { backgroundColor: barColor }]} />
                  <Text
                    style={[
                      styles.tocText,
                      {
                        color: colors.text,
                        fontWeight: entry.level <= 2 ? '600' : '400',
                        fontSize: entry.level === 1 ? 16 : entry.level === 2 ? 15 : 14,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {entry.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 4,
  },
  tocHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tocTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  tocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  tocText: {
    fontSize: 14,
    flex: 1,
  },
  tocLevelBar: {
    width: 3,
    height: 20,
    borderRadius: 1.5,
    marginRight: 10,
  },
  gradingBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  gradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  gradeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
