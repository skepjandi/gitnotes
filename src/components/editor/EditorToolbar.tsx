import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, useTokens } from '../../contexts/ThemeContext';
import { IconButton } from '../ui';

interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onVoiceInput: () => void;
  onInsertCanvas: () => void;
  onInsertImage: () => void;
  onLinkCanvas: () => void;
  onOpenHistory?: () => void;
  canViewHistory?: boolean;
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onVoiceInput,
  onInsertCanvas,
  onInsertImage,
  onLinkCanvas,
  onOpenHistory,
  canViewHistory,
}: EditorToolbarProps) {
  const { colors } = useTheme();
  const { spacing } = useTokens();

  return (
    <View style={[styles.toolbar, { borderBottomColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing[3], paddingVertical: spacing[2], gap: spacing[2] }]}>
      {(canUndo || canRedo) && (
        <>
          <IconButton size="md" testID="note-editor.toolbar.undo" onPress={onUndo} disabled={!canUndo} accessibilityLabel="Undo">
            <Ionicons name="arrow-undo" size={20} color={canUndo ? colors.primary : colors.textSecondary} />
          </IconButton>
          <IconButton size="md" testID="note-editor.toolbar.redo" onPress={onRedo} disabled={!canRedo} accessibilityLabel="Redo">
            <Ionicons name="arrow-redo" size={20} color={canRedo ? colors.primary : colors.textSecondary} />
          </IconButton>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        </>
      )}

      <IconButton size="md" testID="note-editor.toolbar.voice-input" onPress={onVoiceInput} accessibilityLabel="Voice input">
        <Ionicons name="mic-outline" size={20} color={colors.primary} />
      </IconButton>
      <IconButton size="md" testID="note-editor.toolbar.canvas-modal" onPress={onInsertCanvas} accessibilityLabel="Insert canvas">
        <Ionicons name="brush-outline" size={20} color={colors.primary} />
      </IconButton>
      <IconButton size="md" testID="note-editor.toolbar.insert-image" onPress={onInsertImage} accessibilityLabel="Insert image">
        <Ionicons name="image-outline" size={20} color={colors.primary} />
      </IconButton>
      <IconButton size="md" testID="note-editor.toolbar.canvas-picker" onPress={onLinkCanvas} accessibilityLabel="Link existing canvas">
        <Ionicons name="easel-outline" size={20} color={colors.primary} />
      </IconButton>
      {canViewHistory && onOpenHistory ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <IconButton size="md" testID="note-editor.toolbar.history" onPress={onOpenHistory} accessibilityLabel="History">
            <Ionicons name="git-commit-outline" size={20} color={colors.primary} />
          </IconButton>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: 4,
  },
});
