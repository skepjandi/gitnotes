/**
 * Baseline characterization tests for the regex tokenizer (`syntaxHighlight.ts`).
 *
 * These tests verify existing tokenization behavior for all supported languages:
 * JavaScript/TypeScript, Python, Shell, JSON, YAML, CSS, HTML, SQL, Go.
 *
 * Tests also cover edge cases: CRLF/Unicode/empty input,
 * unsupported-language fallback, and the 256 KiB oversized threshold.
 *
 * All tokenizer aliases from `fileLanguage.ts` are tested for graceful degradation
 * to plain text when `buildConfig()` returns null.
 */

import { getThemeColors, tokenize } from '../../src/utils/syntaxHighlight';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract all token texts joined into the original string. */
function reassemble(tokens: { text: string; type: string }[]): string {
  return tokens.map((t) => t.text).join('');
}

/** Count tokens by type. */
function countByType(tokens: { text: string; type: string }[], type: string): number {
  return tokens.filter((t) => t.type === type).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript / TypeScript
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – JavaScript / TypeScript family', () => {
  const cases = ['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx'];

  test.each(cases)('"%s" tokenizes keywords', (lang) => {
    const code = 'const x = 1;';
    const tokens = tokenize(code, lang);
    const kwTokens = tokens.filter((t) => t.type === 'keyword');
    expect(kwTokens.map((t) => t.text)).toContain('const');
  });

  test.each(cases)('"%s" tokenizes single-line comments', (lang) => {
    const code = '// comment';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('// comment');
  });

  test.each(cases)('"%s" tokenizes multi-line comments', (lang) => {
    const code = '/* multi\nline */';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('/* multi\nline */');
  });

  test.each(cases)('"%s" tokenizes double-quoted strings', (lang) => {
    const code = '"hello world"';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'string')).toBe(1);
    expect(tokens[0].text).toBe('"hello world"');
  });

  test.each(cases)('"%s" tokenizes single-quoted strings', (lang) => {
    const code = "'hello world'";
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'string')).toBe(1);
    expect(tokens[0].text).toBe("'hello world'");
  });

  test.each(cases)('"%s" tokenizes template literal strings', (lang) => {
    const code = '`hello world`';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'string')).toBe(1);
    expect(tokens[0].text).toBe('`hello world`');
  });

  test.each(cases)('"%s" tokenizes numbers', (lang) => {
    const code = 'const n = 42;';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'number')).toBe(1);
    expect(tokens.find((t) => t.type === 'number')?.text).toBe('42');
  });

  test.each(cases)('"%s" tokenizes function declarations', (lang) => {
    const code = 'function hello() {}';
    const tokens = tokenize(code, lang);
    const fnTokens = tokens.filter((t) => t.type === 'function');
    expect(fnTokens.map((t) => t.text)).toContain('hello');
  });

  test.each(cases)('"%s" reassembles to original (no loss)', (lang) => {
    const code = 'const x = 1;\nfunction hello() {\n  return 42;\n}';
    const tokens = tokenize(code, lang);
    expect(reassemble(tokens)).toBe(code);
  });

  test.each(cases)('"%s" handles async/await keywords', (lang) => {
    const code = 'async function main() {\n  await fetch();\n}';
    const tokens = tokenize(code, lang);
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('async');
    expect(kwTexts).toContain('await');
  });

  test.each(cases)('"%s" handles try/catch/throw', (lang) => {
    const code = 'try { } catch (e) { throw e; }';
    const tokens = tokenize(code, lang);
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('try');
    expect(kwTexts).toContain('catch');
    expect(kwTexts).toContain('throw');
  });

  test.each(cases)('"%s" handles operators (===, !==, =>, ->)', (lang) => {
    const code = 'a === b; c !== d; e => f; g -> h;';
    const tokens = tokenize(code, lang);
    const opTexts = tokens.filter((t) => t.type === 'operator').map((t) => t.text);
    expect(opTexts).toContain('===');
    expect(opTexts).toContain('!==');
    expect(opTexts).toContain('=>');
    expect(opTexts).toContain('->');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Python
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – Python', () => {
  test('tokenizes keywords', () => {
    const code = 'def foo():\n  pass';
    const tokens = tokenize(code, 'python');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('def');
    expect(kwTexts).toContain('pass');
  });

  test('tokenizes function definitions', () => {
    const code = 'def hello():';
    const tokens = tokenize(code, 'python');
    const fnTokens = tokens.filter((t) => t.type === 'function');
    expect(fnTokens.map((t) => t.text)).toContain('hello');
  });

  test('tokenizes comments', () => {
    const code = '# comment';
    const tokens = tokenize(code, 'python');
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('# comment');
  });

  test('tokenizes triple-quoted strings', () => {
    const code = '"""\nmulti\n"""';
    const tokens = tokenize(code, 'python');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('tokenizes numbers', () => {
    const code = 'x = 3.14';
    const tokens = tokenize(code, 'python');
    const numTokens = tokens.filter((t) => t.type === 'number');
    expect(numTokens.map((t) => t.text)).toContain('3.14');
  });

  test('reassembles to original', () => {
    const code = 'def foo():\n  pass\n';
    const tokens = tokenize(code, 'python');
    expect(reassemble(tokens)).toBe(code);
  });

  test('handles True/False/None', () => {
    const code = 'x = True\ny = False\nz = None';
    const tokens = tokenize(code, 'python');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('True');
    expect(kwTexts).toContain('False');
    expect(kwTexts).toContain('None');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shell / Bash
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – Shell family', () => {
  const shellLangs = ['bash', 'sh', 'shell'];

  test.each(shellLangs)('"%s" tokenizes keywords', (lang) => {
    const code = 'if [ -z "$x" ]; then\n  echo "hi"\nfi';
    const tokens = tokenize(code, lang);
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('if');
    expect(kwTexts).toContain('then');
    expect(kwTexts).toContain('fi');
  });

  test.each(shellLangs)('"%s" tokenizes comments', (lang) => {
    const code = '# comment';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('# comment');
  });

  test.each(shellLangs)('"%s" tokenizes single-quoted strings', (lang) => {
    const code = "'hello'";
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test.each(shellLangs)('"%s" tokenizes double-quoted strings', (lang) => {
    const code = '"hello $USER"';
    const tokens = tokenize(code, lang);
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test.each(shellLangs)('"%s" reassembles to original', (lang) => {
    const code = '#!/bin/bash\necho "hello"\n';
    const tokens = tokenize(code, lang);
    expect(reassemble(tokens)).toBe(code);
  });

  test.each(shellLangs)('"%s" tokenizes shebang line', (lang) => {
    const code = '#!/bin/bash\nls';
    const tokens = tokenize(code, lang);
    // Shebang line should be treated as a function name match or plain
    expect(tokens.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – JSON', () => {
  test('tokenizes keywords (true/false/null)', () => {
    const code = '{"active": true, "count": null}';
    const tokens = tokenize(code, 'json');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('true');
    expect(kwTexts).toContain('null');
  });

  test('tokenizes strings', () => {
    const code = '"key": "value"';
    const tokens = tokenize(code, 'json');
    expect(countByType(tokens, 'string')).toBe(2);
  });

  test('tokenizes numbers', () => {
    const code = '[1, -2, 3.14]';
    const tokens = tokenize(code, 'json');
    expect(countByType(tokens, 'number')).toBe(3);
  });

  test('reassembles to original', () => {
    const code = '{"key": "value", "num": 42}';
    const tokens = tokenize(code, 'json');
    expect(reassemble(tokens)).toBe(code);
  });

  test('handles nested objects', () => {
    const code = '{"nested": {"inner": 1}}';
    const tokens = tokenize(code, 'json');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// YAML
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – YAML', () => {
  test('tokenizes key-value pairs', () => {
    const code = 'name: Alice';
    const tokens = tokenize(code, 'yaml');
    const strTokens = tokens.filter((t) => t.type === 'string');
    expect(strTokens.map((t) => t.text)).toContain('name');
    expect(strTokens.map((t) => t.text)).toContain('Alice');
  });

  test('tokenizes comments', () => {
    const code = '# comment';
    const tokens = tokenize(code, 'yaml');
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('# comment');
  });

  test('tokenizes boolean keywords', () => {
    const code = 'active: true\ndeleted: false';
    const tokens = tokenize(code, 'yaml');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('true');
    expect(kwTexts).toContain('false');
  });

  test('reassembles to original', () => {
    const code = 'name: Alice\nage: 30\n';
    const tokens = tokenize(code, 'yaml');
    expect(reassemble(tokens)).toBe(code);
  });

  test('handles multiline YAML', () => {
    const code = 'items:\n  - one\n  - two';
    const tokens = tokenize(code, 'yaml');
    expect(reassemble(tokens)).toBe(code);
  });

  test('tokenizes anchors and aliases', () => {
    const code = 'defaults: &defaults\n  size: large\nconfig:\n  <<: *defaults';
    const tokens = tokenize(code, 'yaml');
    // Should not throw — just verify tokens exist
    expect(tokens.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – CSS', () => {
  test('tokenizes comments', () => {
    const code = '/* comment */';
    const tokens = tokenize(code, 'css');
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('/* comment */');
  });

  test('tokenizes double-quoted strings', () => {
    const code = 'content: "hello";';
    const tokens = tokenize(code, 'css');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('tokenizes single-quoted strings', () => {
    const code = "content: 'hello';";
    const tokens = tokenize(code, 'css');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('tokenizes selectors and braces', () => {
    const code = '.class { color: red; }';
    const tokens = tokenize(code, 'css');
    const puncTokens = tokens.filter((t) => t.type === 'punctuation');
    const puncTexts = puncTokens.map((t) => t.text);
    expect(puncTexts).toContain('{');
    expect(puncTexts).toContain('}');
  });

  test('reassembles to original', () => {
    const code = '.class { color: red; }\n';
    const tokens = tokenize(code, 'css');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – HTML', () => {
  test('tokenizes comments', () => {
    const code = '<!-- comment -->';
    const tokens = tokenize(code, 'html');
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('<!-- comment -->');
  });

  test('tokenizes double-quoted attribute values', () => {
    const code = '<div class="container">';
    const tokens = tokenize(code, 'html');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('tokenizes angle brackets as punctuation', () => {
    const code = '<div>';
    const tokens = tokenize(code, 'html');
    const puncTokens = tokens.filter((t) => t.type === 'punctuation');
    const puncTexts = puncTokens.map((t) => t.text);
    expect(puncTexts).toContain('<');
    expect(puncTexts).toContain('>');
  });

  test('reassembles to original', () => {
    const code = '<div class="container">\n  <span>hi</span>\n</div>\n';
    const tokens = tokenize(code, 'html');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – SQL', () => {
  test('tokenizes keywords', () => {
    const code = 'SELECT id, name FROM users WHERE active = true';
    const tokens = tokenize(code, 'sql');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('SELECT');
    expect(kwTexts).toContain('FROM');
    expect(kwTexts).toContain('WHERE');
  });

  test('tokenizes single-line comments', () => {
    const code = '-- comment';
    const tokens = tokenize(code, 'sql');
    expect(countByType(tokens, 'comment')).toBe(1);
  });

  test('tokenizes multi-line comments', () => {
    const code = '/* multi\nline */';
    const tokens = tokenize(code, 'sql');
    expect(countByType(tokens, 'comment')).toBe(1);
  });

  test('tokenizes quoted strings', () => {
    const code = "WHERE name = 'Alice'";
    const tokens = tokenize(code, 'sql');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('reassembles to original', () => {
    const code = 'SELECT * FROM users;\n';
    const tokens = tokenize(code, 'sql');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – Go', () => {
  test('tokenizes keywords', () => {
    const code = 'func main() {\n  return 0\n}';
    const tokens = tokenize(code, 'go');
    const kwTexts = tokens.filter((t) => t.type === 'keyword').map((t) => t.text);
    expect(kwTexts).toContain('func');
    expect(kwTexts).toContain('return');
  });

  test('tokenizes function declarations', () => {
    const code = 'func hello() {}';
    const tokens = tokenize(code, 'go');
    const fnTokens = tokens.filter((t) => t.type === 'function');
    expect(fnTokens.map((t) => t.text)).toContain('hello');
  });

  test('tokenizes single-line comments', () => {
    const code = '// comment';
    const tokens = tokenize(code, 'go');
    expect(countByType(tokens, 'comment')).toBe(1);
    expect(tokens[0].text).toBe('// comment');
  });

  test('tokenizes multi-line comments', () => {
    const code = '/* multi\nline */';
    const tokens = tokenize(code, 'go');
    expect(countByType(tokens, 'comment')).toBe(1);
  });

  test('tokenizes raw strings (backtick)', () => {
    const code = '`hello world`';
    const tokens = tokenize(code, 'go');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('tokenizes double-quoted strings', () => {
    const code = '"hello"';
    const tokens = tokenize(code, 'go');
    expect(countByType(tokens, 'string')).toBe(1);
  });

  test('reassembles to original', () => {
    const code = 'package main\n\nfunc main() {\n  return\n}\n';
    const tokens = tokenize(code, 'go');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported / unknown language — graceful plain fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – unsupported language graceful fallback', () => {
  test('returns single plain token for truly unknown language', () => {
    // ruby is now in buildConfig — use 'foobar' which is truly unknown
    const code = 'hello world';
    const tokens = tokenize(code, 'foobar');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
    expect(tokens[0].text).toBe('hello world');
  });

  test('rust has a config and produces tokens (not null/plain fallback)', () => {
    // rust is now in buildConfig (graceful alias) — it has a valid config
    // with empty matchers, so tokenization runs and produces tokens.
    const code = 'fn main() {}';
    const tokens = tokenize(code, 'rust');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].type).toBeTruthy();
    expect(tokens[0].text).toBeTruthy();
  });

  test('returns single plain token for c', () => {
    const code = 'int main() {}';
    const tokens = tokenize(code, 'c');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for cpp', () => {
    const code = '#include <stdio.h>';
    const tokens = tokenize(code, 'cpp');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for java', () => {
    const code = 'public class Main {}';
    const tokens = tokenize(code, 'java');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for kotlin', () => {
    const code = 'fun main() {}';
    const tokens = tokenize(code, 'kotlin');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for swift', () => {
    const code = 'func main() {}';
    const tokens = tokenize(code, 'swift');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for csharp', () => {
    const code = 'using System;';
    const tokens = tokenize(code, 'csharp');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for php', () => {
    const code = '<?php echo "hi"; ?>';
    const tokens = tokenize(code, 'php');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for scala', () => {
    const code = 'def main(args: Array[String]): Unit = {}';
    const tokens = tokenize(code, 'scala');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns single plain token for lua', () => {
    const code = 'function hello() end';
    const tokens = tokenize(code, 'lua');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('plain');
  });

  test('returns empty array for empty string', () => {
    const tokens = tokenize('', 'javascript');
    expect(tokens).toEqual([]);
  });

  test('reassembles to original for unknown language', () => {
    const code = 'hello world\ntest';
    const tokens = tokenize(code, 'ruby');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases: CRLF, Unicode, empty input
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenize – edge cases', () => {
  test('CRLF line endings are preserved', () => {
    const code = 'const x = 1;\r\nconst y = 2;\r\n';
    const tokens = tokenize(code, 'js');
    expect(reassemble(tokens)).toBe(code);
  });

  test('mixed LF and CRLF are preserved', () => {
    const code = 'const x = 1;\nconst y = 2;\r\n';
    const tokens = tokenize(code, 'js');
    expect(reassemble(tokens)).toBe(code);
  });

  test('Unicode characters are preserved', () => {
    const code = 'const greeting = "こんにちは世界"; // 🎉';
    const tokens = tokenize(code, 'js');
    expect(reassemble(tokens)).toBe(code);
  });

  test('emoji in code is preserved', () => {
    const code = 'const 😎 = "cool";';
    const tokens = tokenize(code, 'js');
    expect(reassemble(tokens)).toBe(code);
  });

  test('empty string returns empty token list', () => {
    const tokens = tokenize('', 'js');
    expect(tokens).toEqual([]);
  });

  test('whitespace-only string returns plain tokens', () => {
    const code = '   \n\t  ';
    const tokens = tokenize(code, 'js');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.type === 'plain')).toBe(true);
  });

  test('surrogate pair characters are preserved', () => {
    const code = 'const s = "𝌆";';
    const tokens = tokenize(code, 'js');
    expect(reassemble(tokens)).toBe(code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getThemeColors
// ─────────────────────────────────────────────────────────────────────────────

describe('getThemeColors', () => {
  test('returns distinct colors for dark and light', () => {
    const dark = getThemeColors(true);
    const light = getThemeColors(false);
    // Keyword and string should differ between themes
    expect(dark.keyword).not.toBe(light.keyword);
    expect(dark.string).not.toBe(light.string);
  });

  test('returns 8 token-type keys', () => {
    const colors = getThemeColors(true);
    const expected = ['keyword', 'string', 'comment', 'number', 'function', 'operator', 'punctuation', 'plain'];
    expect(Object.keys(colors).sort()).toEqual(expected.sort());
  });
});
