import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { GitFileChange } from '../../services/agent/bridgeTools';

const GLYPHS: Record<GitFileChange['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflicted: '!',
};

export interface FileChangeRowProps {
  file: GitFileChange;
  section: 'staged' | 'changes' | 'untracked';
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onStageToggle: () => void;
  children?: React.ReactNode;
}

export function FileChangeRow({ file, section, expanded, disabled, onToggle, onStageToggle, children }: FileChangeRowProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const glyphColor =
    file.status === 'deleted' || file.status === 'conflicted'
      ? colors.error
      : file.status === 'modified' || file.status === 'renamed'
        ? colors.warning
        : colors.success;
  const staged = section === 'staged';

  return (
    <View testID={`review.file.${section}.${file.path}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[2] }}>
        <Pressable
          testID={`review.file-toggle.${section}.${file.path}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        >
          <Text
            testID={`review.glyph.${file.path}`}
            style={{ width: 20, color: glyphColor, fontSize: type.sm, fontWeight: '700' }}
          >
            {GLYPHS[file.status]}
          </Text>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} ellipsizeMode="head" style={{ color: colors.text, fontSize: type.sm }}>
              {file.path}
            </Text>
            {file.from ? (
              <Text numberOfLines={1} ellipsizeMode="head" style={{ color: colors.textSecondary, fontSize: type.xs }}>
                {file.from}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          testID={`review.file-action.${section}.${file.path}`}
          accessibilityRole="button"
          accessibilityLabel={staged ? t('review.unstage') : t('review.stage')}
          disabled={disabled}
          hitSlop={8}
          onPress={onStageToggle}
          style={{ marginLeft: spacing[2], opacity: disabled ? 0.4 : 1 }}
        >
          <Text style={{ color: colors.accent, fontSize: type.sm, fontWeight: '600' }}>
            {staged ? t('review.unstage') : t('review.stage')}
          </Text>
        </Pressable>
      </View>
      {expanded ? (
        <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>{children}</View>
      ) : null}
    </View>
  );
}
