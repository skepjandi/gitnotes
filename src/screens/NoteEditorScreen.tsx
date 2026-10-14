import React from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';

import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useNotes } from '../contexts/NoteContext';
import { useCanvases } from '../contexts/CanvasContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { RootStackParamList } from '../navigation/types';
import VoiceInputModal from '../components/VoiceInputModal';
import FolderSelectionDialog from '../components/FolderSelectionDialog';
import { useFolders } from '../contexts/FolderContext';
import { useRepos } from '../contexts/RepoContext';
import { useResponsive } from '../hooks/useResponsive';
import { getMarkdownStyles } from '../utils/preview';
import { useRenderStyle } from '../stores/renderStyleStore';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { CanvasPickerModal } from '../components/editor/CanvasPickerModal';
import { EditorHeader } from '../components/editor/EditorHeader';
import { EditorToolbar } from '../components/editor/EditorToolbar';
import { NoteEditorForm } from '../components/editor/NoteEditorForm';
import { NotePreviewPane } from '../components/editor/NotePreviewPane';
import { NoteViewer } from '../components/editor/NoteViewer';
import { NoteHistoryModal } from '../components/editor/NoteHistoryModal';
import { useNoteEditorDocument } from '../components/editor/useNoteEditorDocument';
import { useNoteEditorPreview } from '../components/editor/useNoteEditorPreview';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useTranslation } from 'react-i18next';
import { useSafeBack } from '../hooks/useSafeBack';
import { subscribeGitContentRefresh } from '../hooks/useGitRefreshEvent';
import { useNoteHistory } from '../hooks/useNoteHistory';
import { isNoteEligibleForHistory } from '../services/note/NoteHistoryService';
import type { Note } from '../models/Note';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'NoteEditor'>;
type NoteEditorRouteProp = RouteProp<RootStackParamList, 'NoteEditor'>;

export default function NoteEditorScreen() {
  return (
    <ErrorBoundary>
      <NoteEditorScreenInner />
    </ErrorBoundary>
  );
}

function NoteEditorScreenInner() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const safeBack = useSafeBack();
  const route = useRoute<NoteEditorRouteProp>();
  const { colors, isDark } = useTheme();
  const { authState, activeAccountId } = useAuth();
  const { sideBySide } = useResponsive();
  const { noteId, format: initialFormat, initialTitle, initialContent, initialTags, repo: initialRepo, branch: initialBranch, folderPath: initialFolderPath, anchor: initialAnchor } = route.params || {};

  React.useEffect(() => {
    return subscribeGitContentRefresh((event) => {
      if (event.kind !== 'checkout') return;
      navigation.navigate('MainTabs', { screen: 'NotesTab' });
    });
  }, [navigation]);

  const { notes, getNoteById, createNote, updateNote } = useNotes();
  const { canvases } = useCanvases();
  const { folders } = useFolders();
  const { repositories } = useRepos();
  const [showVoiceModal, setShowVoiceModal] = React.useState(false);
  const [showCanvasPicker, setShowCanvasPicker] = React.useState(false);
  const [showFolderDialog, setShowFolderDialog] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

  const document = useNoteEditorDocument({
    noteId,
    initialFormat,
    initialTitle,
    initialContent,
    initialTags,
    initialRepo,
    initialBranch,
    initialFolderPath,
    activeAccountId,
    repositories,
    folders,
    notes,
    getNoteById,
    createNote,
    updateNote,
    navigation,
  });

  const markdownOverrides = useRenderStyle('markdown');
  const markdownStyles = React.useMemo(
    () => getMarkdownStyles(colors, isDark, markdownOverrides),
    [colors, isDark, markdownOverrides],
  );
  const preview = useNoteEditorPreview({
    noteId,
    title: document.title,
    content: document.content,
    folderPath: document.folderPath,
    noteFormat: document.noteFormat,
    notes,
    colors,
    isDark,
    navigation,
    markdownStyles,
    initialAnchor,
  });
  const isPdfNote = document.noteFormat === 'pdf';

  // Build the stored note for history eligibility check and hook
  const storedNote: Note | null = noteId ? getNoteById(noteId) ?? null : null;
  const canViewHistory = storedNote ? isNoteEligibleForHistory(storedNote) : false;

  // History hook - only active when modal is open
  const historyNote: Note | null = storedNote && canViewHistory ? storedNote : null;
  const history = useNoteHistory({
    note: showHistory ? historyNote : null,
    isDirty: document.hasChanges,
  });

  // ── NOT FOUND (deep link to a noteId that isn't on this device) ──
  if (document.notFound) {
    return (
      <SafeAreaView
        testID="note-editor.view.not-found"
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: colors.background }}
        edges={['top', 'bottom']}
      >
        <Text className="text-xl font-semibold mb-3" style={{ color: colors.text }}>{t('notes.notFoundTitle')}</Text>
        <Text className="text-base text-center mb-6" style={{ color: colors.textSecondary }}>
          {noteId
            ? t('notes.notFoundWithId', { id: noteId })
            : t('notes.notFoundOffline')}
        </Text>
        <Pressable
          testID="note-editor.button.back-to-notes"
          className="px-5 py-3 rounded-full"
          style={{ backgroundColor: colors.primary }}
          onPress={() => navigation.navigate('MainTabs', { screen: 'NotesTab' })}
        >
          <Text className="text-white text-base font-semibold">{t('notes.backToNotes')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── PREVIEW MODE ──────────────────────────────────────────────
  if (!document.isEditing) {
    return (
      <>
        <NoteViewer
          noteId={noteId!}
          title={document.title}
          noteFormat={document.noteFormat}
          canEdit={!isPdfNote}
          canSpeak={!isPdfNote && !!preview.speakableContent}
          isSpeaking={preview.isSpeaking}
          tocEntries={preview.tocEntries}
          showToc={preview.showToc}
          onBack={safeBack}
          onToggleToc={() => preview.setShowToc(true)}
          onToggleSpeak={preview.handleToggleSpeak}
          onEdit={() => document.setIsEditing(true)}
          onCloseToc={() => preview.setShowToc(false)}
          onTocPress={preview.handleTocPress}
          onNavigateToNote={(id) => navigation.navigate('NoteEditor', { noteId: id })}
          previewContent={preview.previewContent}
          parsedStructuredContent={preview.parsedStructuredContent}
          markdownStyles={preview.markdownStyles}
          notePreviewRenderer={preview.notePreviewRenderer}
          pdfViewerUri={preview.pdfViewerUri}
          authToken={authState.token}
          pdfLoadError={preview.pdfLoadError}
          onPdfError={(message) => preview.setPdfLoadError({ uri: preview.pdfViewerUri, message })}
          onOpenNote={preview.onOpenNote}
          currentNotePath={preview.currentNotePath}
          headingPositions={preview.headingPositions}
          previewScrollRef={preview.previewScrollRef}
          onPreviewScroll={preview.handlePreviewScroll}
          onPreviewContentSizeChange={preview.handlePreviewContentSizeChange}
          canViewHistory={canViewHistory}
          onOpenHistory={() => setShowHistory(true)}
        />

        <NoteHistoryModal
          visible={showHistory}
          history={history}
          onClose={() => setShowHistory(false)}
        />
      </>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1" style={{ backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <EditorHeader
          noteId={noteId}
          isSaving={document.isSaving}
          onCancel={document.handleCancelEdit}
          onSave={document.handleSave}
        />

        <EditorToolbar
          canUndo={document.canUndo}
          canRedo={document.canRedo}
          onUndo={document.handleUndo}
          onRedo={document.handleRedo}
          onVoiceInput={() => setShowVoiceModal(true)}
          onInsertCanvas={() => navigation.navigate('CanvasEditor', {})}
          onInsertImage={document.handlePickImage}
          onLinkCanvas={() => setShowCanvasPicker(true)}
          canViewHistory={canViewHistory}
          onOpenHistory={() => setShowHistory(true)}
        />

        {sideBySide ? (
          <View className="flex-1 flex-row">
            <View className="flex-1">
              <NoteEditorForm
                repo={document.repo}
                title={document.title}
                folderPath={document.folderPath}
                noteFormat={document.noteFormat}
                tags={document.tags}
                canvasJsonRefs={document.canvasJsonRefs}
                content={document.content}
                placeholder={document.editorPlaceholder}
                onRepoChange={document.handleRepoChange}
                onTitleChange={document.handleTitleChange}
                onOpenFolderDialog={() => setShowFolderDialog(true)}
                onNoteFormatChange={document.handleNoteFormatChange}
                onTagsChange={document.handleTagsChange}
                onEditCanvasJson={(uri) => {
                  void uri;
                  navigation.navigate('CanvasEditor', {});
                }}
                onContentChange={document.handleContentChange}
              />
            </View>
            <View className="flex-1">
              <NotePreviewPane
                noteFormat={document.noteFormat}
                previewContent={preview.previewContent}
                parsedStructuredContent={preview.parsedStructuredContent}
                markdownStyles={preview.markdownStyles}
              notePreviewRenderer={preview.notePreviewRenderer}
              pdfViewerUri={preview.pdfViewerUri}
              authToken={authState.token}
              pdfLoadError={preview.pdfLoadError}
              onPdfError={(message) => preview.setPdfLoadError({ uri: preview.pdfViewerUri, message })}
              onOpenNote={preview.onOpenNote}
              currentNotePath={preview.currentNotePath}
              headingPositions={preview.headingPositions}
              showLivePreviewLabel
              bordered
            />
            </View>
          </View>
        ) : (
          <NoteEditorForm
            repo={document.repo}
            title={document.title}
            folderPath={document.folderPath}
            noteFormat={document.noteFormat}
            tags={document.tags}
            canvasJsonRefs={document.canvasJsonRefs}
            content={document.content}
            placeholder={document.editorPlaceholder}
            onRepoChange={document.handleRepoChange}
            onTitleChange={document.handleTitleChange}
            onOpenFolderDialog={() => setShowFolderDialog(true)}
            onNoteFormatChange={document.handleNoteFormatChange}
            onTagsChange={document.handleTagsChange}
            onEditCanvasJson={(uri) => {
              void uri;
              navigation.navigate('CanvasEditor', {});
            }}
            onContentChange={document.handleContentChange}
          />
        )}
      </KeyboardAvoidingView>

      <VoiceInputModal
        visible={showVoiceModal}
        onDone={(text) => {
          document.handleVoiceDone(text);
          setShowVoiceModal(false);
        }}
        onClose={() => setShowVoiceModal(false)}
      />

      <CanvasPickerModal
        visible={showCanvasPicker}
        canvases={canvases}
        onSelect={(canvasId, canvasTitle) => {
          document.handleLinkCanvas(canvasId, canvasTitle);
          setShowCanvasPicker(false);
        }}
        onClose={() => setShowCanvasPicker(false)}
      />

      <FolderSelectionDialog
        visible={showFolderDialog}
        selectedFolderId={document.selectedFolderId}
        onSelect={document.handleFolderSelect}
        onClose={() => setShowFolderDialog(false)}
        additionalFolders={document.repoFolders}
      />

      <NoteHistoryModal
        visible={showHistory}
        history={history}
        onClose={() => setShowHistory(false)}
      />
    </SafeAreaView>
  );
}
