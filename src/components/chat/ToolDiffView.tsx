import React, { useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type { ToolDiff } from '../../models/Chat';
import { buildDiffView, type DiffLineType } from './toolPresentation';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const LINE_MARKERS: Record<DiffLineType, string> = { add: '+', del: '-', ctx: ' ' };

export interface ToolDiffViewProps {
  diffs: ToolDiff[];
}

function ToolDiffViewImpl({ diffs }: ToolDiffViewProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const views = useMemo(() => diffs.map((diff) => buildDiffView(diff)), [diffs]);

  return (
    <View testID="chat-tool.diffs" style={{ gap: spacing[2] }}>
      {views.map((view, index) => (
        <View
          key={`${view.path}-${index}`}
          style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing[2],
              paddingVertical: spacing[1],
              backgroundColor: colors.surfaceSecondary,
            }}
          >
            <Text
              style={{ flex: 1, color: colors.text, fontSize: type.xs, fontFamily: MONO, fontWeight: '600' }}
              numberOfLines={1}
              ellipsizeMode="head"
            >
              {view.path}
            </Text>
            <Text style={{ color: colors.success, fontSize: type.xs, fontFamily: MONO, marginLeft: spacing[2] }}>
              +{view.added}
            </Text>
            <Text style={{ color: colors.error, fontSize: type.xs, fontFamily: MONO, marginLeft: spacing[1] }}>
              -{view.removed}
            </Text>
          </View>
          {view.lines.map((line, lineIndex) => (
            <Text
              key={lineIndex}
              testID={`chat-tool.diff-line.${line.type}`}
              style={{
                paddingHorizontal: spacing[2],
                fontSize: type.xs,
                lineHeight: 16,
                fontFamily: MONO,
                color: line.type === 'add' ? colors.success : line.type === 'del' ? colors.error : colors.textSecondary,
                backgroundColor:
                  line.type === 'add' ? `${colors.success}1f` : line.type === 'del' ? `${colors.error}1f` : 'transparent',
              }}
            >
              {LINE_MARKERS[line.type]} {line.text}
            </Text>
          ))}
          {view.hiddenLines > 0 ? (
            <Text
              testID="chat-tool.diff-hidden"
              style={{ padding: spacing[2], color: colors.textSecondary, fontSize: type.xs }}
            >
              {t('chat.toolDetails.moreLines', { count: view.hiddenLines })}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export const ToolDiffView = React.memo(ToolDiffViewImpl);
