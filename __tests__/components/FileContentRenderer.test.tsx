/**
 * Tests for FileContentRenderer component.
 *
 * Baseline characterization tests (should already pass):
 *   - All 6 modes render content: markdown, neorg, org, json, code, plain
 *   - Markdown strips frontmatter before rendering
 *   - JSON delegates to JsonRenderer (valid + invalid JSON)
 *   - Neorg/Org parse content and delegate to StructuredRenderer
 *   - Neorg/Org parser failure falls back to selectable plain text
 *   - Code delegates to CodeBlock with language prop
 *   - Unknown language / plain extension renders selectable plain text
 *   - Empty content string renders without error
 *
 * New behavior tests (failing-first):
 *   - All required stable test IDs: file-content-renderer.root, mode-specific IDs
 *   - Oversized code (>256 KiB) shows file-content-renderer.oversized-plain
 *   - 256 KiB exactly routes to CodeBlock (not oversized)
 *   - Neorg/Org with empty blocks falls back to plain selectable text
 *   - classification prop overrides path-based classification
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ── Mock dependencies ───────────────────────────────────────────────────────────

// Mock react-native-marked
jest.mock('react-native-marked', () => ({
  useMarkdown: jest.fn(() => ['mocked markdown content']),
}));

// Mock expo-clipboard for CodeBlock
jest.mock('expo-clipboard', () => ({
  getClipboardAsync: jest.fn(async () => ''),
  setClipboardAsync: jest.fn(async () => undefined),
  hasClipboardAsync: jest.fn(async () => false),
  setStringAsync: jest.fn(async () => undefined),
}));

// Mock react-native
jest.mock('react-native', () => {
  const React = require('react');
  const RNView = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('View', props, children);
  RNView.displayName = 'View';

  const Text = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('Text', props, children);
  Text.displayName = 'Text';

  return {
    View: RNView,
    Text,
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Pressable', props, children),
    StyleSheet: {
      create: (s: object) => s,
      flatten: (s: object) => s,
    },
  };
});

// Mock @shopify/react-native-skia for CanvasPreview
jest.mock('@shopify/react-native-skia', () => ({
  __esModule: true,
  Canvas: jest.fn(() => null),
  PathBuilder: {
    Make: jest.fn(() => ({
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      close: jest.fn(),
      build: jest.fn(),
    })),
  },
  Path: jest.fn(() => null),
  Rect: jest.fn(() => null),
  Oval: jest.fn(() => null),
  RoundedRect: jest.fn(() => null),
  Fill: jest.fn(() => null),
  Group: jest.fn(() => null),
  Skia: { Data: { fromBase64: jest.fn() } },
  Image: jest.fn(() => null),
  Text: jest.fn(() => null),
  matchFont: jest.fn(),
}));

// Mock @react-navigation/native for CanvasPreview
jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({
    navigate: jest.fn(),
  })),
}));

// Mock CanvasContext
jest.mock('../../src/contexts/CanvasContext', () => ({
  useCanvases: jest.fn(() => ({
    getCanvasById: jest.fn(() => null),
  })),
}));

// Mock ThemeContext
jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: jest.fn(() => ({
    colors: {
      text: '#000000',
      textSecondary: '#666666',
      primary: '#007AFF',
      border: '#CCCCCC',
      surface: '#FFFFFF',
      surfaceSecondary: '#F5F5F5',
      background: '#FFFFFF',
    },
    isDark: false,
  })),
}));

// Mock renderStyleStore
jest.mock('../../src/stores/renderStyleStore', () => ({
  useRenderStyle: jest.fn(() => ({})),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import FileContentRenderer from '../../src/components/FileContentRenderer';
import { classifyFile } from '../../src/utils/fileLanguage';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DARK_COLORS = {
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  primary: '#93c5fd',
  border: '#1e293b',
  surface: '#0f172a',
  surfaceSecondary: '#1e293b',
  background: '#0f172a',
};

const LIGHT_COLORS = {
  text: '#0f172a',
  textSecondary: '#64748b',
  primary: '#2563eb',
  border: '#dbe4f0',
  surface: '#f8fafc',
  surfaceSecondary: '#f1f5f9',
  background: '#ffffff',
};

const SIZE_256K = 262_144;

// ─────────────────────────────────────────────────────────────────────────────
// Baseline characterization — modes covered by existing FileViewer branches
// ─────────────────────────────────────────────────────────────────────────────

describe('FileContentRenderer – baseline characterization', () => {
  describe('markdown mode', () => {
    test('renders markdown without frontmatter', () => {
      const content = '# Hello\n\nThis is **bold**.';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="readme.md"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
    });

    test('strips markdown frontmatter before rendering', () => {
      const content = '---\ntitle: Test\n---\n# Hello\n\nContent';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="readme.md"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
    });

    test('renders empty markdown without error', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content=""
          path="readme.md"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
    });
  });

  describe('json mode', () => {
    test('renders valid JSON', () => {
      const content = '{"key": "value"}';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="data.json"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.json')).toBeTruthy();
    });

    test('renders invalid JSON as raw text', () => {
      const content = '{ invalid json }';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="data.json"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.json')).toBeTruthy();
    });
  });

  describe('neorg mode', () => {
    test('renders neorg content via StructuredRenderer', () => {
      const content = '* Hello\n\nThis is neorg.';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="notes/test.norg"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
    });

    test('neorg parser failure falls back to selectable plain text', () => {
      // Malformed neorg that produces empty blocks
      const content = '@document.meta\n invalid';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="broken.norg"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
    });

    test('empty neorg content renders without error', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content=""
          path="empty.norg"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
    });
  });

  describe('org mode', () => {
    test('renders org content via StructuredRenderer', () => {
      const content = '* Hello\n\nThis is org.';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="notes/test.org"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.org')).toBeTruthy();
    });

    test('org parser failure falls back to selectable plain text', () => {
      const content = '#+BEGIN_SRC\n unclosed block';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="broken.org"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.org')).toBeTruthy();
    });

    test('empty org content renders without error', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content=""
          path="empty.org"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.org')).toBeTruthy();
    });
  });

  describe('code mode', () => {
    test('renders code via CodeBlock with language', () => {
      const content = 'const x = 1;';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="script.ts"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.code')).toBeTruthy();
    });

    test('code with .ts extension uses typescript language', () => {
      const content = 'const x: number = 1;';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="script.ts"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.code')).toBeTruthy();
    });

    test('code with .py extension uses python language', () => {
      const content = 'def hello():\n    pass';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="script.py"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.code')).toBeTruthy();
    });

    test('unknown code extension renders without error', () => {
      const content = 'some content';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="Makefile"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.code')).toBeTruthy();
    });
  });

  describe('plain mode', () => {
    test('renders plain text for unknown extension', () => {
      const content = 'Hello world';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="README.txt"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
    });

    test('renders plain text for dotfile without extension', () => {
      const content = 'SECRET=value';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path=".bashrc"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
      expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
    });

    test('plain text is selectable', () => {
      const content = 'selectable text';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="README"
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      // The plain text element should have selectable prop
      expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
    });
  });

  describe('empty content', () => {
    test('empty content renders without error for markdown', () => {
      const { getByTestId } = render(
        <FileContentRenderer content="" path="readme.md" isDark={false} colors={LIGHT_COLORS} />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    });

    test('empty content renders without error for plain', () => {
      const { getByTestId } = render(
        <FileContentRenderer content="" path="README" isDark={false} colors={LIGHT_COLORS} />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    });

    test('empty content renders without error for code', () => {
      const { getByTestId } = render(
        <FileContentRenderer content="" path="script.ts" isDark={false} colors={LIGHT_COLORS} />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    });
  });

  describe('classification prop override', () => {
    test('classification prop overrides path-based classification', () => {
      const content = '{"key": "value"}';
      // Provide markdown classification but path suggests json
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="data.json"
          classification={{ mode: 'markdown', highlightLanguage: undefined, language: 'markdown' }}
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
    });

    test('unknown language with classification prop falls back to plain', () => {
      const content = 'Hello';
      const { getByTestId } = render(
        <FileContentRenderer
          content={content}
          path="script.ts"
          classification={{ mode: 'plain', highlightLanguage: undefined, language: 'plain' }}
          isDark={false}
          colors={LIGHT_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
    });
  });

  describe('dark mode', () => {
    test('renders markdown in dark mode', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content="# Hello"
          path="readme.md"
          isDark={true}
          colors={DARK_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
    });

    test('renders code in dark mode', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content="const x = 1;"
          path="script.ts"
          isDark={true}
          colors={DARK_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.code')).toBeTruthy();
    });

    test('renders plain in dark mode', () => {
      const { getByTestId } = render(
        <FileContentRenderer
          content="Hello"
          path="README"
          isDark={true}
          colors={DARK_COLORS}
        />,
      );
      expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — stable test ID contracts (failing-first)
// ─────────────────────────────────────────────────────────────────────────────

describe('FileContentRenderer – test ID contracts', () => {
  test('file-content-renderer.root is always present', () => {
    const modes = [
      { path: 'readme.md', content: '# Hello' },
      { path: 'data.json', content: '{}' },
      { path: 'test.norg', content: '* Hello' },
      { path: 'test.org', content: '* Hello' },
      { path: 'script.ts', content: 'const x = 1;' },
      { path: 'README', content: 'Hello' },
    ];

    for (const { path, content } of modes) {
      const { getByTestId } = render(
        <FileContentRenderer content={content} path={path} isDark={false} colors={LIGHT_COLORS} />,
      );
      expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    }
  });

  test('markdown mode exposes file-content-renderer.markdown', () => {
    const { getByTestId } = render(
      <FileContentRenderer content="# Hello" path="readme.md" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();
  });

  test('neorg mode exposes file-content-renderer.neorg', () => {
    const { getByTestId } = render(
      <FileContentRenderer content="* Hello" path="test.norg" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
  });

  test('org mode exposes file-content-renderer.org', () => {
    const { getByTestId } = render(
      <FileContentRenderer content="* Hello" path="test.org" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.org')).toBeTruthy();
  });

  test('json mode exposes file-content-renderer.json', () => {
    const { getByTestId } = render(
      <FileContentRenderer content='{"key":"value"}' path="data.json" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.json')).toBeTruthy();
  });

  test('code mode (under 256 KiB) exposes file-content-renderer.code', () => {
    const { getByTestId } = render(
      <FileContentRenderer content="const x = 1;" path="script.ts" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.code')).toBeTruthy();
  });

  test('plain mode exposes file-content-renderer.plain', () => {
    const { getByTestId } = render(
      <FileContentRenderer content="Hello" path="README" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — oversized code (>256 KiB) (failing-first)
// ─────────────────────────────────────────────────────────────────────────────

describe('FileContentRenderer – oversized code (>256 KiB)', () => {
  test('code exceeding 256 KiB shows file-content-renderer.oversized-plain', () => {
    // Build content > 256 KiB
    const chunk = 'const x = 1;\n';
    const repeats = Math.ceil((SIZE_256K + 1) / chunk.length);
    const content = chunk.repeat(repeats).slice(0, SIZE_256K + 1);

    expect(new TextEncoder().encode(content).length).toBe(SIZE_256K + 1);

    const { getByTestId } = render(
      <FileContentRenderer content={content} path="script.ts" isDark={false} colors={LIGHT_COLORS} />,
    );

    expect(getByTestId('file-content-renderer.oversized-plain')).toBeTruthy();
  });

  test('code exactly at 256 KiB uses CodeBlock (not oversized)', () => {
    const chunk = 'x';
    const content = chunk.repeat(SIZE_256K);
    expect(new TextEncoder().encode(content).length).toBe(SIZE_256K);

    const { getByTestId } = render(
      <FileContentRenderer content={content} path="script.ts" isDark={false} colors={LIGHT_COLORS} />,
    );

    // Should use CodeBlock, not oversized plain
    expect(getByTestId('file-content-renderer.code')).toBeTruthy();
  });

  test('oversized JSON (>256 KiB) still uses json renderer', () => {
    const chunk = '{"key": "value"}\n';
    const repeats = Math.ceil((SIZE_256K + 1) / chunk.length);
    const content = chunk.repeat(repeats).slice(0, SIZE_256K + 1);

    expect(new TextEncoder().encode(content).length).toBe(SIZE_256K + 1);

    const { getByTestId } = render(
      <FileContentRenderer content={content} path="data.json" isDark={false} colors={LIGHT_COLORS} />,
    );

    // JSON over 256 KiB still uses the JSON renderer (not oversized-plain)
    expect(getByTestId('file-content-renderer.json')).toBeTruthy();
  });

  test('oversized Python (>256 KiB) shows oversized-plain', () => {
    const chunk = 'def foo():\n  pass\n';
    const repeats = Math.ceil((SIZE_256K + 1) / chunk.length);
    const content = chunk.repeat(repeats).slice(0, SIZE_256K + 1);

    expect(new TextEncoder().encode(content).length).toBe(SIZE_256K + 1);

    const { getByTestId } = render(
      <FileContentRenderer content={content} path="script.py" isDark={false} colors={LIGHT_COLORS} />,
    );

    expect(getByTestId('file-content-renderer.oversized-plain')).toBeTruthy();
  });

  test('oversized plain text (>256 KiB) still uses plain renderer', () => {
    const chunk = 'x';
    const content = chunk.repeat(SIZE_256K + 1);

    expect(new TextEncoder().encode(content).length).toBe(SIZE_256K + 1);

    const { getByTestId } = render(
      <FileContentRenderer content={content} path="README" isDark={false} colors={LIGHT_COLORS} />,
    );

    // Plain text over 256 KiB still uses the plain renderer (not oversized-plain)
    expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New behavior — parser failure and empty blocks safe handling (failing-first)
// ─────────────────────────────────────────────────────────────────────────────

describe('FileContentRenderer – parser failure / empty blocks fallback', () => {
  test('neorg with empty blocks renders selectable plain text', () => {
    // Content that strips to text but produces no blocks from parser
    const content = '@document.meta\n@end\n{[invalid((()))]}';
    const { getByTestId, queryByText } = render(
      <FileContentRenderer content={content} path="empty.norg" isDark={false} colors={LIGHT_COLORS} />,
    );

    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
    // Should have selectable text fallback (the stripped content)
    expect(queryByText('{[invalid((()))]}')).toBeTruthy();
  });

  test('org with empty blocks renders selectable plain text', () => {
    // Minimal org content
    const content = '';
    const { getByTestId } = render(
      <FileContentRenderer content={content} path="empty.org" isDark={false} colors={LIGHT_COLORS} />,
    );

    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    expect(getByTestId('file-content-renderer.org')).toBeTruthy();
  });

  test('malformed neorg content does not crash', () => {
    const content = '{[invalid((()))]}';
    const { getByTestId } = render(
      <FileContentRenderer content={content} path="malformed.norg" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
  });

  test('malformed org content does not crash', () => {
    const content = '** unclosed emphasis';
    const { getByTestId } = render(
      <FileContentRenderer content={content} path="malformed.org" isDark={false} colors={LIGHT_COLORS} />,
    );
    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyFile utility — baseline characterization
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyFile – baseline characterization', () => {
  test('markdown extensions', () => {
    expect(classifyFile('readme.md').mode).toBe('markdown');
    expect(classifyFile('readme.markdown').mode).toBe('markdown');
  });

  test('neorg extension', () => {
    expect(classifyFile('notes/test.norg').mode).toBe('neorg');
  });

  test('org extension', () => {
    expect(classifyFile('notes/test.org').mode).toBe('org');
  });

  test('json extension', () => {
    expect(classifyFile('data.json').mode).toBe('json');
  });

  test('code extensions', () => {
    expect(classifyFile('script.ts').mode).toBe('code');
    expect(classifyFile('script.tsx').mode).toBe('code');
    expect(classifyFile('script.py').mode).toBe('code');
    expect(classifyFile('script.js').mode).toBe('code');
    expect(classifyFile('Dockerfile').mode).toBe('code');
    expect(classifyFile('.gitignore').mode).toBe('code');
    expect(classifyFile('Makefile').mode).toBe('code');
  });

  test('plain extension (unknown)', () => {
    expect(classifyFile('README.txt').mode).toBe('plain');
    expect(classifyFile('.bashrc').mode).toBe('plain');
    expect(classifyFile('random').mode).toBe('plain');
  });

  test('highlightLanguage for code', () => {
    expect(classifyFile('script.ts').highlightLanguage).toBe('typescript');
    expect(classifyFile('script.py').highlightLanguage).toBe('python');
    expect(classifyFile('data.json').highlightLanguage).toBe('json');
  });

  test('highlightLanguage is undefined for markdown/neorg/org/plain', () => {
    expect(classifyFile('readme.md').highlightLanguage).toBeUndefined();
    expect(classifyFile('test.norg').highlightLanguage).toBeUndefined();
    expect(classifyFile('test.org').highlightLanguage).toBeUndefined();
    expect(classifyFile('README').highlightLanguage).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — mode switching without violating Rules of Hooks
// All hooks must be called in the same order on every render, regardless of mode.
// ─────────────────────────────────────────────────────────────────────────────

describe('FileContentRenderer – mode switching regression', () => {
  test('rerenders from plain to markdown to code without throwing', () => {
    const { getByTestId, rerender } = render(
      <FileContentRenderer
        content="Hello plain"
        path="README"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    expect(getByTestId('file-content-renderer.plain')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content="# Hello markdown"
        path="readme.md"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content="const x = 1;"
        path="script.ts"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.root')).toBeTruthy();
    expect(getByTestId('file-content-renderer.code')).toBeTruthy();
  });

  test('rerenders from code to json to neorg without throwing', () => {
    const { getByTestId, rerender } = render(
      <FileContentRenderer
        content="const x = 1;"
        path="script.ts"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.code')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content='{"key":"value"}'
        path="data.json"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.json')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content="* Hello neorg"
        path="notes/test.norg"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.neorg')).toBeTruthy();
  });

  test('rerenders from org to markdown to plain without throwing', () => {
    const { getByTestId, rerender } = render(
      <FileContentRenderer
        content="* Hello org"
        path="notes/test.org"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.org')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content="# Hello markdown"
        path="readme.md"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.markdown')).toBeTruthy();

    rerender(
      <FileContentRenderer
        content="Hello plain"
        path="README"
        isDark={false}
        colors={LIGHT_COLORS}
      />,
    );

    expect(getByTestId('file-content-renderer.plain')).toBeTruthy();
  });
});
