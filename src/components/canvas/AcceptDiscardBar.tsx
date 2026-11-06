/**
 * AcceptDiscardBar — list view of pending draft commands with per-command
 * accept/discard controls and batch operations.
 *
 * Complements the visual DraftLayerRenderer by providing a scrollable
 * list interface for fine-grained command inspection and individual
 * accept/discard decisions.
 *
 * Layout:
 * - Header: "N pending commands"
 * - Scrollable list of commands (kind icon, content preview, confidence)
 * - Per-command: checkbox, accept button (✓), discard button (✗)
 * - Footer: Batch Accept Checked, Batch Accept All, Discard All
 *
 * Pattern reference: CanvasEditorContent.tsx (React Native view composition).
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useDraftStore, type DraftCommand } from '../../stores/draftStore';
import { useTheme } from '../../contexts/ThemeContext';
import { Palette, readableInk } from '../../theme/tokens';

interface AcceptDiscardBarProps {
  applyCommand: (cmd: DraftCommand) => void;
  applyCommands: (cmds: DraftCommand[]) => void;
  pushUndo: (transactionId: string) => void;
}

export function AcceptDiscardBar({
  applyCommand,
  applyCommands,
  pushUndo,
}: AcceptDiscardBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const commands = useDraftStore((s: any) => s.commands);
  const toggleChecked = useDraftStore((s: any) => s.toggleChecked);
  const discardCommand = useDraftStore((s: any) => s.discardCommand);
  const acceptSingle = useDraftStore((s: any) => s.acceptCommand);
  const batchAcceptChecked = useDraftStore((s: any) => s.batchAcceptChecked);
  const batchAcceptAll = useDraftStore((s: any) => s.batchAcceptAll);
  const batchDiscardAll = useDraftStore((s: any) => s.batchDiscardAll);

  if (commands.length === 0) return null;

  const checkedCount = commands.filter((c: any) => c.checked).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {commands.length} pending command{commands.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Scrollable command list */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator>
        {commands.map((cmd: any) => (
          <View key={cmd.id} style={styles.commandRow}>
            {/* Checkbox */}
            <TouchableOpacity
              onPress={() => toggleChecked(cmd.id)}
              style={[styles.checkbox, cmd.checked && styles.checkboxChecked]}
            >
              {cmd.checked && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>

            {/* Command info */}
            <View style={styles.commandInfo}>
              <Text style={styles.commandKind}>{cmd.kind}</Text>
              <Text style={styles.commandContent} numberOfLines={2}>
                {String(cmd.content || '(empty)')}
              </Text>
              {cmd.confidence && (
                <Text style={styles.confidence}>
                  {Math.round(cmd.confidence * 100)}% confidence
                </Text>
              )}
            </View>

            {/* Per-command accept/discard */}
            <View style={styles.commandActions}>
              <TouchableOpacity
                onPress={() => acceptSingle(cmd.id, applyCommand, pushUndo)}
                style={styles.acceptBtn}
              >
                <Text style={styles.actionText}>✓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => discardCommand(cmd.id)}
                style={styles.discardBtn}
              >
                <Text style={styles.actionText}>✗</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Batch controls */}
      <View style={styles.batchControls}>
        <TouchableOpacity
          onPress={() => batchAcceptChecked(applyCommands, pushUndo)}
          style={[styles.batchBtn, styles.batchBtnSuccess, checkedCount === 0 && styles.batchBtnDisabled]}
          disabled={checkedCount === 0}
        >
          <Text style={styles.batchBtnText}>
            Accept Checked ({checkedCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => batchAcceptAll(applyCommands, pushUndo)}
          style={[styles.batchBtn, styles.batchBtnPrimary]}
        >
          <Text style={styles.batchBtnText}>Accept All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={batchDiscardAll}
          style={[styles.batchBtn, styles.batchBtnSecondary]}
        >
          <Text style={styles.batchBtnText}>Discard All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginTop: 20,
    overflow: 'hidden',
  },
  header: {
    padding: 16,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
  },
  list: {
    maxHeight: 400,
  },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkmark: {
    color: readableInk(colors.success),
    fontSize: 16,
    fontWeight: 'bold',
  },
  commandInfo: {
    flex: 1,
    marginRight: 12,
  },
  commandKind: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  commandContent: {
    fontSize: 14,
    color: colors.text,
    marginBottom: 2,
  },
  confidence: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  commandActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: readableInk(colors.error),
    fontSize: 18,
    fontWeight: 'bold',
  },
  batchControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  batchBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchBtnSuccess: {
    backgroundColor: colors.success,
  },
  batchBtnPrimary: {
    backgroundColor: colors.primary,
  },
  batchBtnSecondary: {
    backgroundColor: colors.textSecondary,
  },
  batchBtnDisabled: {
    opacity: 0.5,
  },
  batchBtnText: {
    color: readableInk(colors.primary),
    fontSize: 14,
    fontWeight: 'bold',
  },
});
