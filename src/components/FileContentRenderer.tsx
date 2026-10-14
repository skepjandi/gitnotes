/**
 * Reusable Git file content renderer.
 *
 * Selects exactly one existing renderer for Markdown, Neorg, Org, JSON, code, or plain.
 * Owns no loading/error state — callers handle those outside this component.
 *
 * Test IDs:
 *   - `file-content-renderer.root`          — root element (always present)
 *   - `file-content-renderer.markdown`     — Markdown mode
 *   - `file-content-renderer.neorg`        — Neorg mode
 *   - `file-content-renderer.org`           — Org mode
 *   - `file-content-renderer.json`         — JSON mode
 *   - `file-content-renderer.code`         — code mode (tokenized, under 256 KiB)
 *   - `file-content-renderer.plain`        — plain text mode (including unknown language)
 *   - `file-content-renderer.oversized-plain` — code content that exceeds 256 KiB
 *
 * Safe behaviors:
 *   - Parser failure / empty blocks → falls back to selectable plain text
 *   - Unknown / unsupported language → selectable plain text
 *   - Empty content string → renders nothing (no error)
 *   - Oversized code (>256 KiB) → selectable plain text with `file-content-renderer.oversized-plain`
 */

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useMarkdown } from 'react-native-marked';

import { FileLanguage, classifyFile } from '../utils/fileLanguage';
import { NeorgContentParser } from '../services/NeorgContentParser';
import { OrgContentParser } from '../services/OrgContentParser';
import StructuredRenderer from './StructuredRenderer';
import CanvasPreview from './CanvasPreview';
import { JsonRenderer } from './JsonRenderer';
import { CodeBlock } from './CodeBlock';
import { stripTopMetadata, getMarkdownStyles } from '../utils/preview';
import { useRenderStyle } from '../stores/renderStyleStore';
import { isOversized } from '../utils/syntaxHighlight';
import type { RenderFormat } from '../types/RenderStyle';

interface FileContentRendererProps {
  /** Raw file content string. */
  content: string;
  /** File path (used for classification when classification is not provided). */
  path: string;
  /**
   * Pre-classified file language descriptor.
   * When omitted, derived from `path` using `classifyFile()`.
   */
  classification?: FileLanguage;
  isDark: boolean;
  colors: {
    text: string;
    textSecondary: string;
    primary: string;
    border: string;
    surface: string;
    surfaceSecondary?: string;
    background: string;
  };
  /**
   * Optional wiki-link navigation callback.
   * Receives (targetPath, fragment?) and returns whether navigation succeeded.
   * Only used for Neorg/Org structured content with wiki-links.
   */
  onOpenNote?: (targetPath: string, fragment?: string) => boolean;
}

function MarkdownBody({
  value,
  styles,
}: {
  value: string;
  styles: ReturnType<typeof getMarkdownStyles>;
}) {
  const nodes = useMarkdown(value, { styles });
  return <>{React.Children.toArray(nodes)}</>;
}

export default function FileContentRenderer({
  content,
  path,
  classification: classificationProp,
  isDark,
  colors,
  onOpenNote,
}: FileContentRendererProps) {
  // Derive classification when not provided
  const classification = useMemo(
    () => classificationProp ?? classifyFile(path),
    [classificationProp, path],
  );

  const mode = classification.mode;

  // Hooks called unconditionally at top level — values used only in the matching branch.
  // This satisfies React's Rules of Hooks: hooks are called in the same order on every render.
  const markdownOverrides = useRenderStyle('markdown');
  const markdownStyles = useMemo(
    () => getMarkdownStyles(colors, isDark, markdownOverrides),
    [colors, isDark, markdownOverrides],
  );

  // ── Markdown: strip frontmatter then render via react-native-marked ───────────
  if (mode === 'markdown') {
    const stripped = stripTopMetadata(content, 'markdown');

    if (!stripped) {
      return (
        <View testID="file-content-renderer.root">
          <View testID="file-content-renderer.markdown" />
        </View>
      );
    }

    return (
      <View testID="file-content-renderer.root">
        <View testID="file-content-renderer.markdown">
          <MarkdownBody value={stripped} styles={markdownStyles} />
        </View>
      </View>
    );
  }

  // ── JSON: delegate to JsonRenderer ──────────────────────────────────────────
  if (mode === 'json') {
    return (
      <View testID="file-content-renderer.root">
        <View testID="file-content-renderer.json">
          <JsonRenderer content={content} />
        </View>
      </View>
    );
  }

  // ── Neorg / Org: parse then delegate to StructuredRenderer ──────────────────
  if (mode === 'neorg' || mode === 'org') {
    const stripped = stripTopMetadata(content, mode);

    if (!stripped) {
      return (
        <View testID="file-content-renderer.root">
          <View testID={`file-content-renderer.${mode}`} />
        </View>
      );
    }

    const parser = mode === 'org' ? OrgContentParser : NeorgContentParser;
    const parsed = parser.parseContent(stripped);
    const blocks = parsed.success && parsed.blocks ? parsed.blocks : null;

    // Parser failure or empty blocks → selectable plain text fallback
    if (!blocks || blocks.length === 0) {
      return (
        <View testID="file-content-renderer.root">
          <View testID={`file-content-renderer.${mode}`} />
          <Text selectable className="text-sm leading-5" style={{ color: colors.text }}>
            {stripped}
          </Text>
        </View>
      );
    }

    return (
      <View testID="file-content-renderer.root">
        <View testID={`file-content-renderer.${mode}`}>
          <StructuredRenderer
            blocks={blocks}
            format={mode as RenderFormat}
            currentNotePath={path}
            CanvasPreview={CanvasPreview}
            onOpenNote={onOpenNote}
          />
        </View>
      </View>
    );
  }

  // ── Code: delegate to CodeBlock with language input ─────────────────────────
  // When content exceeds 256 KiB, render selectable plain text with oversized testID.
  if (mode === 'code') {
    if (isOversized(content)) {
      return (
        <View testID="file-content-renderer.root">
          <View testID="file-content-renderer.oversized-plain">
            <Text selectable className="text-[13px] leading-[18px] font-mono" style={{ color: colors.text }}>
              {content}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View testID="file-content-renderer.root">
        <View testID="file-content-renderer.code">
          <CodeBlock
            code={content}
            language={classification.highlightLanguage}
            isDark={isDark}
          />
        </View>
      </View>
    );
  }

  // ── Plain text: selectable Text, including unknown language ──────────────────
  // `mode === 'plain'` covers: unknown extension, single-dot files, and any
  // classification where mode is 'plain'.
  return (
    <View testID="file-content-renderer.root">
      <View testID="file-content-renderer.plain">
        <Text selectable className="text-sm leading-5" style={{ color: colors.text }}>
          {content}
        </Text>
      </View>
    </View>
  );
}
