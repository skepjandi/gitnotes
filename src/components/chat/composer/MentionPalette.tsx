import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../../../contexts/ThemeContext';
import type { FileMatch } from '../../../services/agent/bridgeTools';

export interface MentionPaletteProps {
  results: FileMatch[];
  onSelect: (match: FileMatch) => void;
}

function splitPath(path: string): { name: string; parent: string } {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = trimmed.lastIndexOf('/');
  return { name: trimmed.slice(slash + 1), parent: slash === -1 ? '' : trimmed.slice(0, slash + 1) };
}

export function MentionPalette({ results, onSelect }: MentionPaletteProps) {
  const { colors, spacing, type } = useTokens();
  return (
    <View
      testID="chat-input.mention-palette"
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.elevated,
        marginBottom: spacing[2],
        overflow: 'hidden',
      }}
    >
      {results.map((match) => {
        const { name, parent } = splitPath(match.path);
        return (
          <Pressable
            key={match.path}
            testID={`chat-input.mention.${match.path}`}
            accessibilityRole="button"
            onPress={() => onSelect(match)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] }}
          >
            <Ionicons name={match.isDir ? 'folder-outline' : 'document-outline'} size={16} color={colors.accent} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: type.sm, color: colors.text }}>
              <Text style={{ color: colors.textSecondary }}>{parent}</Text>
              <Text style={{ fontWeight: '600' }}>{match.isDir ? `${name}/` : name}</Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
