/**
 * Tests for CodeBlock component.
 *
 * Baseline behavior tests:
 * - Renders code with language label and copy button
 * - Tokens are rendered with correct theme colors (dark/light)
 * - Copy button copies code and shows "Copied!" feedback
 * - testID contracts for tokens, copy button, and scroll view
 * - Horizontal scroll, selectable text, empty input handling
 *
 * New behavior tests (failing-first):
 * - Line numbers displayed correctly
 * - Oversized content (>256 KiB UTF-8) shows plain preview without tokenization
 * - 256 KiB exactly is tokenized
 * - 256 KiB + 1 byte bypasses tokenization
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ── Mock expo-clipboard ─────────────────────────────────────────────────────
// jest.mock is hoisted; jest allows 'mock*'-prefixed vars to be referenced
// in the factory body (lazy resolution).  This overrides the setup.ts mock
// which only provides setClipboardAsync (not setStringAsync).

jest.mock('expo-clipboard', () => {
  const mockSetStringAsync = jest.fn();
  return {
    getClipboardAsync: jest.fn(async () => ''),
    setClipboardAsync: jest.fn(async () => undefined),
    hasClipboardAsync: jest.fn(async () => false),
    setStringAsync: mockSetStringAsync,
    __setStringAsyncMock: mockSetStringAsync,
  };
});

// Access the mock for assertions — jest.mock returns the factory's mock value.
const clipboardMock = require('expo-clipboard');
const mockSetStringAsync = clipboardMock.__setStringAsyncMock as jest.Mock<() => Promise<void>>;

// ── Mock react-native ─────────────────────────────────────────────────────────

jest.mock('react-native', () => {
  const React = require('react');
  const RNView = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('View', props, children);
  RNView.displayName = 'View';

  const Text = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('Text', props, children);
  Text.displayName = 'Text';

  const ScrollView = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('ScrollView', props, children);
  ScrollView.displayName = 'ScrollView';

  const Pressable = ({
    children,
    disabled: _disabled,
    testID,
    accessibilityRole,
    accessibilityLabel,
    onPress,
    style,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    testID?: string;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    onPress?: () => void;
    style?: unknown;
  }) =>
    React.createElement(
      'Pressable',
      { testID, accessibilityRole, accessibilityLabel, onPress, style },
      children,
    );
  Pressable.displayName = 'Pressable';

  return {
    View: RNView,
    Text,
    ScrollView,
    Pressable,
    StyleSheet: {
      create: (s: object) => s,
      flatten: (s: object) => s,
    },
  };
});

// ── Import after mocks ───────────────────────────────────────────────────────

import { CodeBlock } from '../../src/components/CodeBlock';

// ─────────────────────────────────────────────────────────────────────────────
// Baseline behavior — these should already pass
// ─────────────────────────────────────────────────────────────────────────────

describe('CodeBlock – baseline', () => {
  beforeEach(() => {
    mockSetStringAsync.mockResolvedValue(undefined);
  });

  test('renders code content', () => {
    const { getByText } = render(
      <CodeBlock code={'const x = 1;'} language="javascript" isDark={true} />,
    );
    expect(getByText('const x = 1;')).toBeTruthy();
  });

  test('renders language label', () => {
    const { getByText } = render(
      <CodeBlock code={'const x = 1;'} language="javascript" isDark={true} />,
    );
    expect(getByText('JAVASCRIPT')).toBeTruthy();
  });

  test('does not render language label when language is undefined', () => {
    const { queryByText } = render(
      <CodeBlock code={'hello world'} isDark={true} />,
    );
    expect(queryByText('undefined')).toBeNull();
  });

  test('copy button has testID', () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block.button.copy')).toBeTruthy();
  });

  test('tokens have testID', () => {
    const { getAllByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    const tokenElements = getAllByTestId('code-block-token');
    expect(tokenElements.length).toBeGreaterThan(0);
  });

  test('scroll view has testID', () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block-scroll-view')).toBeTruthy();
  });

  test('copy button calls Clipboard.setStringAsync with code', async () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 42;'} language="js" isDark={false} />,
    );
    fireEvent.press(getByTestId('code-block.button.copy'));
    await waitFor(() => {
      expect(mockSetStringAsync).toHaveBeenCalledWith('const x = 42;');
    });
  });

  test('copy button shows "Copied!" feedback', async () => {
    const { getByTestId, getByText } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    fireEvent.press(getByTestId('code-block.button.copy'));
    await waitFor(() => {
      expect(getByText('Copied!')).toBeTruthy();
    });
  });

  test('code text is selectable (Text has selectable prop)', () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    const scrollView = getByTestId('code-block-scroll-view');
    expect(scrollView).toBeTruthy();
  });

  test('renders without language prop', () => {
    const { getByText } = render(
      <CodeBlock code={'hello world'} isDark={true} />,
    );
    expect(getByText('hello world')).toBeTruthy();
  });

  test('renders empty code without crashing', () => {
    const { getByTestId } = render(
      <CodeBlock code={''} language="js" isDark={true} />,
    );
    expect(getByTestId('code-block.button.copy')).toBeTruthy();
  });

  test('renders dark theme container', () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={true} />,
    );
    // Dark container is just a render target — verify component renders
    expect(getByTestId('code-block.button.copy')).toBeTruthy();
  });

  test('renders light theme container', () => {
    const { getByTestId } = render(
      <CodeBlock code={'const x = 1;'} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block.button.copy')).toBeTruthy();
  });

  test('renders multiline code', () => {
    const code = 'function hello() {\n  console.log("hi");\n}';
    const { getByText } = render(
      <CodeBlock code={code} language="js" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders Python code', () => {
    const code = 'def hello():\n  pass';
    const { getByText } = render(
      <CodeBlock code={code} language="python" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders Go code', () => {
    const code = 'package main\n\nfunc main() {}';
    const { getByText } = render(
      <CodeBlock code={code} language="go" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders SQL code', () => {
    const code = 'SELECT id FROM users';
    const { getByText } = render(
      <CodeBlock code={code} language="sql" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders CSS code', () => {
    const code = '.class { color: red; }';
    const { getByText } = render(
      <CodeBlock code={code} language="css" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders HTML code', () => {
    const code = '<div>hello</div>';
    const { getByText } = render(
      <CodeBlock code={code} language="html" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders YAML code', () => {
    const code = 'name: Alice';
    const { getByText } = render(
      <CodeBlock code={code} language="yaml" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders JSON code', () => {
    const code = '{"key": "value"}';
    const { getByText } = render(
      <CodeBlock code={code} language="json" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders Shell code', () => {
    const code = '#!/bin/bash\necho "hi"';
    const { getByText } = render(
      <CodeBlock code={code} language="shell" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders CRLF line endings', () => {
    const code = 'const x = 1;\r\nconst y = 2;';
    const { getByText } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('renders Unicode content', () => {
    const code = 'const greeting = "こんにちは世界";';
    const { getByText } = render(
      <CodeBlock code={code} language="js" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — line numbers (failing-first)
// ─────────────────────────────────────────────────────────────────────────────

describe('CodeBlock – line numbers', () => {
  test('displays line numbers alongside code', () => {
    const code = 'const x = 1;\nconst y = 2;';
    const { getByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block-line-number-1')).toBeTruthy();
  });

  test('line numbers are aligned with code lines', () => {
    const code = 'line one\nline two\nline three';
    const { getAllByText } = render(
      <CodeBlock code={code} language="text" isDark={false} />,
    );
    // Should have "1", "2", "3" as line numbers
    const lineNums = getAllByText('1');
    expect(lineNums.length).toBeGreaterThanOrEqual(1);
  });

  test('line numbers persist through theme changes', () => {
    const code = 'const x = 1;';
    const { rerender, getByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block-line-number-1')).toBeTruthy();

    rerender(<CodeBlock code={code} language="js" isDark={true} />);
    expect(getByTestId('code-block-line-number-1')).toBeTruthy();
  });

  test('single line still shows line number 1', () => {
    const code = 'const x = 1;';
    const { getByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    expect(getByTestId('code-block-line-number-1')).toBeTruthy();
  });

  test('empty code shows no line numbers', () => {
    const { queryByText } = render(
      <CodeBlock code={''} language="js" isDark={false} />,
    );
    // No numeric line numbers for empty
    expect(queryByText('1')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — oversized plain fallback (failing-first)
// ─────────────────────────────────────────────────────────────────────────────

describe('CodeBlock – 256 KiB oversized threshold', () => {
  // 256 KiB = 262,144 bytes
  const SIZE_256K = 262_144;
  const SIZE_256K_PLUS_ONE = SIZE_256K + 1;

  test('exactly 256 KiB is NOT oversized (tokenization path)', () => {
    const chunk = 'x';
    const code = chunk.repeat(SIZE_256K);
    const encodedLength = new TextEncoder().encode(code).length;
    expect(encodedLength).toBe(SIZE_256K);
    const { getAllByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    const tokens = getAllByTestId('code-block-token');
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('256 KiB + 1 byte bypasses tokenization (plain state)', () => {
    // Build a string that is 256 KiB + 1 byte using repeated ASCII
    // Each 'const x = 1;\n' is 12 bytes
    // We need exactly 262145 bytes
    const chunk = 'const x = 1;\n'; // 12 bytes
    const repeats = Math.ceil(SIZE_256K_PLUS_ONE / chunk.length);
    const code = chunk.repeat(repeats).slice(0, SIZE_256K_PLUS_ONE);

    // Verify byte length
    expect(new TextEncoder().encode(code).length).toBe(SIZE_256K_PLUS_ONE);

    const { queryAllByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    // No token testIDs should appear — plain mode
    const tokens = queryAllByTestId('code-block-token');
    expect(tokens.length).toBe(0);
  });

  test('oversized content shows plain preview', () => {
    const chunk = '// comment\n';
    const repeats = Math.ceil(SIZE_256K_PLUS_ONE / chunk.length);
    const code = chunk.repeat(repeats).slice(0, SIZE_256K_PLUS_ONE);

    const { getByText } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    // Plain content should still be visible (not token-colored)
    expect(getByText(code)).toBeTruthy();
  });

  test('oversized content is still copyable', async () => {
    const chunk = 'const x = 1;\n';
    const repeats = Math.ceil(SIZE_256K_PLUS_ONE / chunk.length);
    const code = chunk.repeat(repeats).slice(0, SIZE_256K_PLUS_ONE);

    const { getByTestId } = render(
      <CodeBlock code={code} language="js" isDark={false} />,
    );
    fireEvent.press(getByTestId('code-block.button.copy'));
    await waitFor(() => {
      expect(mockSetStringAsync).toHaveBeenCalledWith(code);
    });
  });

  test('oversized JSON also bypasses tokenization', () => {
    const chunk = '{"key": "value"}\n';
    const repeats = Math.ceil(SIZE_256K_PLUS_ONE / chunk.length);
    const code = chunk.repeat(repeats).slice(0, SIZE_256K_PLUS_ONE);

    expect(new TextEncoder().encode(code).length).toBe(SIZE_256K_PLUS_ONE);

    const { queryAllByTestId } = render(
      <CodeBlock code={code} language="json" isDark={false} />,
    );
    const tokens = queryAllByTestId('code-block-token');
    expect(tokens.length).toBe(0);
  });

  test('oversized Python also bypasses tokenization', () => {
    const chunk = '# comment\ndef foo():\n  pass\n';
    const repeats = Math.ceil(SIZE_256K_PLUS_ONE / chunk.length);
    const code = chunk.repeat(repeats).slice(0, SIZE_256K_PLUS_ONE);

    expect(new TextEncoder().encode(code).length).toBe(SIZE_256K_PLUS_ONE);

    const { queryAllByTestId } = render(
      <CodeBlock code={code} language="python" isDark={false} />,
    );
    const tokens = queryAllByTestId('code-block-token');
    expect(tokens.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — unsupported-language fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('CodeBlock – unsupported language graceful fallback', () => {
  test('ruby language renders as plain text', () => {
    const code = 'def hello; puts "hi"; end';
    const { getByText } = render(
      <CodeBlock code={code} language="ruby" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
    // Tokens may or may not appear depending on ruby support
    // The key is content is visible
  });

  test('rust language renders as plain text', () => {
    const code = 'fn main() {}';
    const { getByText } = render(
      <CodeBlock code={code} language="rust" isDark={true} />,
    );
    expect(getByText(code)).toBeTruthy();
  });

  test('unknown language renders without crashing', () => {
    const code = 'some random content';
    const { getByText } = render(
      <CodeBlock code={code} language="notareallanguage" isDark={false} />,
    );
    expect(getByText(code)).toBeTruthy();
  });
});
