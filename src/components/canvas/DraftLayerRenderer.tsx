/**
 * DraftLayerRenderer — renders AI-generated draft commands as an overlay
 * above the canvas.
 *
 * Uses pure React Native (View, Text, TouchableOpacity) for the command
 * cards and batch controls. The caller wraps this in an absolute-positioned
 * container above the canvas content.
 *
 * Visualization:
 * - text: light blue background
 * - highlight: light yellow background
 * - shape: light green background
 * - annotation: light pink background
 * - replace: light purple background
 *
 * Each command card: checkbox (left), content preview, accept (✓) and
 * discard (✗) buttons (right).
 *
 * Control bar at bottom: "Accept Checked", "Accept All", "Discard All".
 */

import React, { useMemo, useRef } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useDraftStore, type DraftCommand } from '../../stores/draftStore';
import { useTheme } from '../../contexts/ThemeContext';
import { Palette, readableInk } from '../../theme/tokens';

interface DraftLayerProps {
  /** Pixel width of the atlas region (for positioning). */
  atlasWidth: number;
  /** Pixel height of the atlas region. */
  atlasHeight: number;
  /** Offset from canvas top-left to atlas top-left (logical coords). */
  atlasOffsetX: number;
  atlasOffsetY: number;
  /** Callback: apply a single command to confirmed tiles. */
  applyCommand: (cmd: DraftCommand) => void;
  /** Callback: push one undo record with the transaction ID. */
  pushUndo: (transactionId: string) => void;
  /** Callback: apply multiple commands to confirmed tiles (atomic). */
  applyCommands: (cmds: DraftCommand[]) => void;
}

const COMMAND_COLORS: Record<DraftCommand['kind'], string> = {
  text: '#b3d7ff',
  highlight: '#fff3b0',
  shape: '#b0e5c9',
  annotation: '#ffccdd',
  replace: '#dcc3f0',
};

const COMMAND_LABELS: Record<DraftCommand['kind'], string> = {
  text: 'Add text',
  highlight: 'Highlight',
  shape: 'Add shape',
  annotation: 'Annotate',
  replace: 'Replace',
};

const CMD_WIDTH = 200;
const CMD_HEIGHT = 80;
const CHECKBOX_SIZE = 20;
const DISCARD_SIZE = 24;

interface Layout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cmd: DraftCommand;
}

export function DraftLayerRenderer({
  atlasHeight,
  atlasOffsetX,
  atlasOffsetY,
  pushUndo,
  applyCommands,
}: DraftLayerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const commands = useDraftStore((s: any) => s.commands);
  const toggleChecked = useDraftStore((s: any) => s.toggleChecked);
  const discardCommand = useDraftStore((s: any) => s.discardCommand);

  const batchAcceptChecked = useDraftStore((s: any) => s.batchAcceptChecked);
  const batchAcceptAll = useDraftStore((s: any) => s.batchAcceptAll);
  const batchDiscardAll = useDraftStore((s: any) => s.batchDiscardAll);

  const layoutsRef = useRef<Layout[]>([]);

  useMemo(() => {
    layoutsRef.current = commands.map((cmd: DraftCommand, idx: number) => ({
      id: cmd.id,
      x: (idx % 4) * (CMD_WIDTH + 20),
      y: Math.floor(idx / 4) * (CMD_HEIGHT + 20),
      width: CMD_WIDTH,
      height: CMD_HEIGHT,
      cmd,
    }));
  }, [commands]);

  const totalHeight = Math.max(0, ...layoutsRef.current.map((l) => l.y + l.height));
  const totalWidth = Math.max(0, ...layoutsRef.current.map((l) => l.x + l.width));

  if (commands.length === 0) return null;

  return (
    <View
      style={[
        styles.overlay,
        {
          left: atlasOffsetX,
          top: atlasOffsetY + atlasHeight + 20,
          width: totalWidth,
          minHeight: totalHeight + 120,
        },
      ]}
    >
      {layoutsRef.current.map(({ id, x, y, width, height, cmd }) => (
        <View
          key={id}
          style={[
            styles.card,
            {
              left: x,
              top: y,
              width,
              height,
              backgroundColor: COMMAND_COLORS[cmd.kind],
            },
          ]}
        >
          {/* Checkbox (top-left) */}
          <TouchableOpacity
            onPress={() => toggleChecked(cmd.id)}
            style={[
              styles.checkbox,
              { backgroundColor: cmd.checked ? colors.success : colors.surface },
            ]}
          >
            {cmd.checked && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>

          {/* Discard button (top-right, X) */}
          <TouchableOpacity
            onPress={() => discardCommand(cmd.id)}
            style={styles.discardButton}
          >
            <Text style={styles.discardText}>✕</Text>
          </TouchableOpacity>

          {/* Kind label */}
          <Text style={styles.kindLabel}>
            {COMMAND_LABELS[cmd.kind]}
          </Text>

          {/* Content preview */}
          <Text style={styles.contentPreview} numberOfLines={1}>
            {String((cmd as any).content || '').slice(0, 40)}
          </Text>
        </View>
      ))}

      {/* Control bar */}
      <View style={styles.controlBar}>
        <TouchableOpacity
          onPress={() => batchAcceptChecked(applyCommands, pushUndo)}
          style={styles.acceptCheckedButton}
        >
          <Text style={styles.buttonText}>Accept Checked</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => batchAcceptAll(applyCommands, pushUndo)}
          style={styles.acceptAllButton}
        >
          <Text style={styles.buttonText}>Accept All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={batchDiscardAll}
          style={styles.discardAllButton}
        >
          <Text style={styles.buttonText}>Discard All</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 1000,
  },
  card: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 4,
  },
  checkbox: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: readableInk(colors.success),
    fontSize: 14,
    fontWeight: 'bold',
  },
  discardButton: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: DISCARD_SIZE,
    height: DISCARD_SIZE,
    borderRadius: DISCARD_SIZE / 2,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discardText: {
    color: readableInk(colors.error),
    fontSize: 16,
    fontWeight: 'bold',
  },
  kindLabel: {
    position: 'absolute',
    left: 10,
    top: 28,
    fontSize: 14,
    color: colors.text,
    fontWeight: 'bold',
  },
  contentPreview: {
    position: 'absolute',
    left: 10,
    top: 50,
    fontSize: 12,
    color: colors.textSecondary,
    maxWidth: CMD_WIDTH - 20,
  },
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 80,
    marginTop: 20 + Math.max(0, ...([] as number[])),
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 8,
  },
  acceptCheckedButton: {
    padding: 12,
    backgroundColor: colors.success,
    borderRadius: 6,
  },
  acceptAllButton: {
    padding: 12,
    backgroundColor: colors.primary,
    borderRadius: 6,
  },
  discardAllButton: {
    padding: 12,
    backgroundColor: colors.textSecondary,
    borderRadius: 6,
  },
  buttonText: {
    color: readableInk(colors.primary),
    fontSize: 14,
    fontWeight: 'bold',
  },
});
