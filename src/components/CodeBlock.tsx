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
  const lineNumberColor = isDark ? '#475569' : '#94a3b8';
  const lineNumberGutterColor = isDark ? '#1e293b' : '#e2e8f0';

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

    const digitWidth = 10;
    const lineNumberWidth = String(lineCount).length * digitWidth + 12;
    const lineElements: React.ReactNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      lineElements.push(
        <Text
          key={i}
          style={[
            styles.lineNumberText,
            { color: lineNumberColor, width: lineNumberWidth },
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

    return (
      <View
        style={[
          styles.lineNumbers,
          {
            width: lineNumberWidth,
            backgroundColor: lineNumberGutterColor,
            borderRightColor: isDark ? '#334155' : '#cbd5e1',
          },
        ]}
      >
        {lineElements}
      </View>
    );
  };

  return (
    <View style={[styles.container, isDark ? styles.containerDark : styles.containerLight]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {language ? (
            <Text
              style={[
                styles.languageLabel,
                { color: isDark ? '#94a3b8' : '#64748b' },
              ]}
              numberOfLines={1}
            >
              {oversized ? `${language.toUpperCase()} \u00B7 LARGE FILE` : language.toUpperCase()}
            </Text>
          ) : oversized ? (
            <Text style={[styles.languageLabel, { color: isDark ? '#94a3b8' : '#64748b' }]}>
              LARGE FILE
            </Text>
          ) : null}
        </View>

        <Pressable
          testID="code-block.button.copy"
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
          onPress={handleCopy}
          style={({ pressed }) => [
            styles.copyButton,
            {
              backgroundColor: copied
                ? isDark ? '#166534' : '#dcfce7'
                : pressed
                  ? isDark ? '#1e293b' : '#f1f5f9'
                  : 'transparent',
              opacity: pressed && !copied ? 0.72 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.copyText,
              { color: copied ? (isDark ? '#4ade80' : '#16a34a') : (isDark ? '#60a5fa' : '#2563eb') },
            ]}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Text>
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
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  containerLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  containerDark: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  languageLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  copyText: {
    fontSize: 11,
    fontWeight: '600',
  },
  scrollView: {
    maxWidth: '100%',
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    paddingRight: 10,
    borderRightWidth: 1,
    marginRight: 10,
  },
  lineNumberText: {
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'right',
  },
});
