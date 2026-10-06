import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, Text, View } from 'react-native';

import { useTheme, useTokens } from '../contexts/ThemeContext';
import type { FormatAction } from '../utils/markdownFormatting';
import { getToolbarButtons } from '../utils/formatToolbarPresets';
import type { NoteFormat } from '../models/Note';

export type { FormatAction };

type Props = {
  onFormat: (action: FormatAction) => void;
  /** Active note format — picks the matching syntax preset (md / org / norg). */
  format?: NoteFormat;
};

export function MarkdownToolbar({ onFormat, format }: Props) {
  const { colors } = useTheme();
  const { spacing, type, radii } = useTokens();
  const buttons = getToolbarButtons(format);

  return (
    <View testID="markdown-toolbar.toolbar-action.press">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.container}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={[styles.content, { paddingHorizontal: spacing[2], paddingVertical: spacing[1], gap: spacing[1] }]}
      >
        {buttons.map(({ label, action, testID: btnTestID }) => (
          <TouchableOpacity
            key={label}
            testID={btnTestID}
            onPress={() => onFormat(action)}
            style={[styles.button, { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing[2] + 2, paddingVertical: spacing[1] + 1, borderRadius: radii.sm }]}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ disabled: false }}
          >
            <Text style={[styles.buttonText, { color: colors.text, fontSize: type.sm, fontWeight: '600' }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {},
  buttonText: {
    fontWeight: '600',
  },
});
