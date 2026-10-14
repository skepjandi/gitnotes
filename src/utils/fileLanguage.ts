/**
 * Shared filename-to-language classifier for Git file screens.
 *
 * Provides stable format/language metadata for:
 * - Markdown, Neorg, Org, JSON (note formats with dedicated renderers)
 * - Code files supported by the regex tokenizer
 * - Generic code (no recognized extension)
 * - Plain text (no recognized extension)
 *
 * Binary classification is owned by `isBinaryPath` in `exploreShared.tsx` —
 * this module does not duplicate that logic.
 *
 * The `language` field is a stable future LSP service key; no LSP
 * behavior is implemented here.
 */

export type FileLanguageMode = 'markdown' | 'neorg' | 'org' | 'json' | 'code' | 'plain';

export interface FileLanguage {
  /** Renderer/viewer mode consumed by both FileViewerScreen and ExploreFileScreen. */
  mode: FileLanguageMode;
  /**
   * Language alias accepted by `syntaxHighlight.ts` `tokenize()`.
   * `undefined` when `mode` is not `'code'` (markdown/neorg/org/json/plain
   * use dedicated renderers that bypass the tokenizer).
   */
  highlightLanguage: string | undefined;
  /**
   * Stable semantic key for a future language-service descriptor.
   * Matches the highlight language where applicable; otherwise a
   * descriptive string (e.g. `'plain'`, `'markdown'`).
   */
  language: string;
}

// Extensions that map to each note format (lowercase, checked case-insensitively)
const MARKDOWN_EXTS = new Set(['md', 'markdown']);
const NEORG_EXTS = new Set(['norg']);
const ORG_EXTS = new Set(['org']);

// Extensions recognized by syntaxHighlight.ts tokenizer.
// Values are the exact language strings accepted by buildConfig().
const TOKENIZER_EXT_MAP: Record<string, string> = {
  // JavaScript/TypeScript family
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // Scripting
  py: 'python',
  rb: 'ruby',
  // Systems
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  // C family
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  scala: 'scala',
  lua: 'lua',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  // Web
  css: 'css',
  scss: 'css',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  // Data/config
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'conf',
  env: 'env',
  // Query/serialization
  sql: 'sql',
  graphql: 'graphql',
  proto: 'proto',
  // Other code
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gitignore: 'gitignore',
};

/**
 * Classify a filename and return stable metadata for renderer selection.
 *
 * Does NOT check binary status — callers must guard with `isBinaryPath()`
 * from `exploreShared.tsx` before using the result.
 *
 * @param filename - The file basename (with or without directory prefix).
 *                    The last path segment is used for classification.
 */
export function classifyFile(filename: string): FileLanguage {
  // Use only the basename — strip any directory prefix
  const basename = filename.includes('/') ? filename.split('/').pop() ?? filename : filename;
  const lower = basename.toLowerCase();

  // --- Special named files (no extension or have prefix dots) ---
  // Makefile: case-sensitive check for the canonical name, plus lowercase
  // variant for broader compatibility (make is case-sensitive on Unix but
  // some tools accept lowercase).
  if (lower === 'makefile') {
    return { mode: 'code', highlightLanguage: 'makefile', language: 'makefile' };
  }
  // Dockerfile: exactly "Dockerfile" or "Dockerfile.<ext>"
  if (lower === 'dockerfile') {
    return { mode: 'code', highlightLanguage: 'dockerfile', language: 'dockerfile' };
  }
  // .dockerignore and .gitignore: dotfiles without a meaningful extension
  if (lower === '.dockerignore' || lower === '.gitignore') {
    return { mode: 'code', highlightLanguage: 'gitignore', language: 'gitignore' };
  }

  // --- Extension-based classification ---
  const parts = lower.split('.');
  // Single-dot files like ".bashrc" — no extension, treat as plain
  if (parts.length === 1) {
    return { mode: 'plain', highlightLanguage: undefined, language: 'plain' };
  }
  // Multi-dot: last segment is the extension (e.g. "component.tsx" → "tsx")
  const ext = parts[parts.length - 1] ?? '';

  if (MARKDOWN_EXTS.has(ext)) {
    return { mode: 'markdown', highlightLanguage: undefined, language: 'markdown' };
  }
  if (NEORG_EXTS.has(ext)) {
    return { mode: 'neorg', highlightLanguage: undefined, language: 'neorg' };
  }
  if (ORG_EXTS.has(ext)) {
    return { mode: 'org', highlightLanguage: undefined, language: 'org' };
  }
  if (ext === 'json') {
    return { mode: 'json', highlightLanguage: 'json', language: 'json' };
  }

  const highlightLang = TOKENIZER_EXT_MAP[ext];
  if (highlightLang !== undefined) {
    return { mode: 'code', highlightLanguage: highlightLang, language: highlightLang };
  }

  // Unknown extension — plain text
  return { mode: 'plain', highlightLanguage: undefined, language: 'plain' };
}
