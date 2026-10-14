import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getThemeColors, isOversized, tokenize } from '../utils/syntaxHighlight';

interface CodeBlockProps {
  code: string;
  language?: string;
  isDark: boolean;
}

const FEEDBACK_DURATION_MS = 2000;

function getLineCount(code: string): number {
  const lines = code.split(/\r?\n/);
  return lines.length;
}

export function CodeBlock({ code, language, isDark }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const themeColors = useMemo(() => getThemeColors(isDark), [isDark]);
  const tokens = useMemo(() => tokenize(code, language ?? ''), [code, language]);
  const lineCount = useMemo(() => getLineCount(code), [code]);
  const oversized = useMemo(() => isOversized(code), [code]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, FEEDBACK_DURATION_MS);
  };

  const plainTextColor = themeColors.plain;

  const renderCode = () => {
    if (oversized) {
      return (
        <Text selectable style={[styles.codeText, { color: plainTextColor }]}>
          {code}
        </Text>
      );
    }

    return (
      <Text selectable style={[styles.codeText, { color: plainTextColor }]}>
        {tokens.map((token, index) => (
          <Text key={`${token.type}-${index}-${token.text}`} style={{ color: themeColors[token.type] }} testID="code-block-token">
            {token.text}
          </Text>
        ))}
      </Text>
    );
  };

  const renderLineNumbers = () => {
    const lines = code.split(/\r?\n/);
    if (!lines.some(line => line.length > 0)) {
      return null;
    }

    const lineNumberWidth = String(lineCount).length * 10 + 16;
    const lineElements: React.ReactNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      lineElements.push(
        <Text
          key={i}
          style={[
            styles.lineNumberText,
            { color: plainTextColor, width: lineNumberWidth },
          ]}
          testID={i === 0 ? 'code-block-line-number-1' : undefined}
        >
          {i + 1}
        </Text>,
      );
      if (i < lines.length - 1) {
        lineElements.push(
          <Text key={`nl-${i}`} style={{ color: plainTextColor }}>
            {'\n'}
          </Text>,
        );
      }
    }

    return <View style={[styles.lineNumbers, { width: lineNumberWidth }]}>{lineElements}</View>;
  };

  return (
    <View style={[styles.container, isDark ? styles.containerDark : styles.containerLight]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {language ? (
            <Text style={[styles.languageLabel, { color: isDark ? '#cbd5e1' : '#475569' }]}>
              {oversized ? `${language.toUpperCase()} (LARGE FILE)` : language.toUpperCase()}
            </Text>
          ) : oversized ? (
            <Text style={[styles.languageLabel, { color: isDark ? '#cbd5e1' : '#475569' }]}>
              LARGE FILE
            </Text>
          ) : null}
        </View>

        <Pressable testID="code-block.button.copy" accessibilityRole="button" accessibilityLabel="Copy" onPress={handleCopy} style={styles.copyButton}>
          <Text style={[styles.copyText, { color: isDark ? '#93c5fd' : '#2563eb' }]}>{copied ? 'Copied!' : 'Copy'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="code-block-scroll-view">
        {renderLineNumbers()}
        <View style={styles.codeContainer}>{renderCode()}</View>
      </ScrollView>
    </View>
  );
}

export default CodeBlock;

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  containerLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4f0',
  },
  containerDark: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flex: 1,
  },
  languageLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  copyButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  copyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollView: {
    maxWidth: '100%',
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    flexDirection: 'row',
  },
  codeContainer: {
    flexDirection: 'row',
  },
  codeText: {
    fontFamily: 'Menlo',
    fontSize: 13,
    lineHeight: 20,
  },
  lineNumbers: {
    flexDirection: 'column',
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: 'rgba(128, 128, 128, 0.2)',
    marginRight: 12,
  },
  lineNumberText: {
    fontFamily: 'Menlo',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
  },
});
