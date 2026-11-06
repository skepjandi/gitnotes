import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../contexts/ThemeContext';
import { readableInk } from '../../theme/tokens';

interface BulkActionBarProps {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
  bottomOffset: number;
  itemNoun: string;
  itemNounPlural?: string;
}

export function BulkActionBar({
  count,
  onCancel,
  onDelete,
  bottomOffset,
  itemNoun,
  itemNounPlural,
}: BulkActionBarProps) {
  const { colors } = useTheme();
  if (count === 0) return null;

  const noun = count === 1 ? itemNoun : itemNounPlural ?? `${itemNoun}s`;

  return (
    <View
      testID="bulk-action-bar.container"
      className="absolute left-3 right-3 flex-row items-center gap-3 py-2.5 px-3 rounded-sm"
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          bottom: bottomOffset,
          borderWidth: StyleSheet.hairlineWidth,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
      ]}
    >
      <TouchableOpacity
        testID="bulk-action-bar.button.cancel"
        className="w-8 h-8 rounded-full items-center justify-center"
        onPress={onCancel}
        accessibilityLabel="Cancel selection"
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      <Text className="flex-1 text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
        {count} {noun} selected
      </Text>
      <TouchableOpacity
        testID="bulk-action-bar.button.delete"
        className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-sm"
        style={{ backgroundColor: colors.error }}
        onPress={onDelete}
        accessibilityLabel={`Delete ${count} ${noun}`}
      >
        <Ionicons name="trash" size={16} color={readableInk(colors.error)} />
        <Text className="text-sm font-semibold" style={{ color: readableInk(colors.error) }}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
}

export default BulkActionBar;
