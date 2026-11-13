import React, { useMemo } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { parseUnifiedDiff } from './parseUnifiedDiff';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const MARKERS = { add: '+', del: '-', ctx: ' ' } as const;

export interface PatchViewProps {
  patch: string;
  truncated?: boolean;
}

function PatchViewImpl({ patch, truncated = false }: PatchViewProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const parsed = useMemo(() => parseUnifiedDiff(patch), [patch]);

  if (parsed.binary) {
    return (
      <Text testID="review.patch.binary" style={{ color: colors.textSecondary, fontSize: type.sm, padding: spacing[3] }}>
        {t('review.binary')}
      </Text>
    );
  }
  if (parsed.hunks.length === 0) {
    return (
      <Text testID="review.patch.empty" style={{ color: colors.textSecondary, fontSize: type.sm, padding: spacing[3] }}>
        {parsed.renameTo ? t('review.renamed', { from: parsed.renameFrom, to: parsed.renameTo }) : t('review.noChanges')}
      </Text>
    );
  }

  const lineStyle = { fontSize: type.xs, lineHeight: 16, fontFamily: MONO } as const;
  return (
    <View testID="review.patch">
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ minWidth: '100%' }}>
          {parsed.hunks.map((hunk, hunkIndex) => (
            <View key={hunkIndex}>
              <Text
                testID="review.patch.hunk"
                style={{ ...lineStyle, color: colors.primary, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing[2] }}
              >
                {hunk.header}
              </Text>
              {hunk.lines.map((line, lineIndex) => (
                <View
                  key={lineIndex}
                  testID={`review.patch.line.${line.type}`}
                  style={{
                    flexDirection: 'row',
                    backgroundColor:
                      line.type === 'add' ? `${colors.success}1f` : line.type === 'del' ? `${colors.error}1f` : 'transparent',
                  }}
                >
                  <Text style={{ ...lineStyle, width: 40, textAlign: 'right', color: colors.textSecondary, paddingRight: spacing[1] }}>
                    {line.oldNo ?? ''}
                  </Text>
                  <Text style={{ ...lineStyle, width: 40, textAlign: 'right', color: colors.textSecondary, paddingRight: spacing[2] }}>
                    {line.newNo ?? ''}
                  </Text>
                  <Text
                    style={{
                      ...lineStyle,
                      paddingRight: spacing[2],
                      color: line.type === 'add' ? colors.success : line.type === 'del' ? colors.error : colors.text,
                    }}
                  >
                    {MARKERS[line.type]}
                    {line.text}
                    {line.noNewline ? `  ${t('review.noNewline')}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {truncated || parsed.hiddenLines > 0 ? (
        <Text testID="review.patch.truncated" style={{ color: colors.textSecondary, fontSize: type.xs, padding: spacing[2] }}>
          {parsed.hiddenLines > 0 ? t('review.moreLines', { count: parsed.hiddenLines }) : t('review.truncated')}
        </Text>
      ) : null}
    </View>
  );
}

export const PatchView = React.memo(PatchViewImpl);
