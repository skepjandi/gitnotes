/**
 * Tests for the shared filename classifier (`fileLanguage.ts`).
 *
 * Coverage:
 * - Baseline: markdown, neorg, org, json, code, plain modes mirror current
 *   FileViewerScreen.detectMode() behavior.
 * - Case-insensitive extension matching (e.g. .TSX, .MD).
 * - Special named files: Makefile, Dockerfile, .dockerignore, .gitignore.
 * - Multi-dot names: component.tsx, file.min.js.
 * - Dotfiles with no extension: .bashrc, .profile.
 * - Unknown extensions fall back to plain.
 * - Binary extension (.png) still classifies as plain here — binary
 *   detection is owned by isBinaryPath() and is tested separately.
 */
import { classifyFile } from '../../src/utils/fileLanguage';

describe('fileLanguage classifier', () => {
  describe('markdown', () => {
    test.each(['readme.md', 'README.MD', 'notes.markdown', 'doc.md'])(
      '"%s" → markdown',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('markdown');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('markdown');
      },
    );
  });

  describe('neorg', () => {
    test.each(['notes.norg', 'NOTES.NORG', 'index.norg'])(
      '"%s" → neorg',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('neorg');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('neorg');
      },
    );
  });

  describe('org', () => {
    test.each(['tasks.org', 'TASKS.ORG', 'journal.org'])(
      '"%s" → org',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('org');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('org');
      },
    );
  });

  describe('json', () => {
    test.each(['package.json', 'PACKAGE.JSON', 'tsconfig.json', '.prettierrc.json'])(
      '"%s" → json',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('json');
        expect(result.highlightLanguage).toBe('json');
        expect(result.language).toBe('json');
      },
    );
  });

  describe('code — TypeScript / JavaScript family', () => {
    test.each([
      ['component.ts', 'typescript'],
      ['component.TSX', 'typescript'],
      ['component.tsx', 'typescript'],
      ['app.js', 'javascript'],
      ['App.JS', 'javascript'],
      ['app.jsx', 'javascript'],
      ['lib.mjs', 'javascript'],
      ['config.cjs', 'javascript'],
    ])('"%s" → code (%s)', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('code — Python', () => {
    test.each(['main.py', 'MAIN.PY', 'setup.py'])('"%s" → code (python)', (filename) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('python');
      expect(result.language).toBe('python');
    });
  });

  describe('code — Shell', () => {
    test.each([
      ['script.sh', 'shell'],
      ['script.bash', 'shell'],
      ['script.zsh', 'shell'],
      ['build.sh', 'shell'],
    ])('"%s" → code (shell)', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('code — Web (CSS, HTML, XML, SVG)', () => {
    test.each([
      ['style.css', 'css'],
      ['style.scss', 'css'],
      ['style.less', 'less'],
      ['index.html', 'html'],
      ['page.htm', 'html'],
      ['config.xml', 'xml'],
      ['icon.svg', 'xml'],
    ])('"%s" → code', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('code — YAML / TOML / INI / ENV', () => {
    test.each([
      ['config.yaml', 'yaml'],
      ['config.yml', 'yaml'],
      ['Cargo.toml', 'toml'],
      ['nginx.ini', 'ini'],
      ['.env', 'env'],
      ['app.conf', 'conf'],
    ])('"%s" → code', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('code — SQL / GraphQL / Proto', () => {
    test.each([
      ['schema.sql', 'sql'],
      ['query.graphql', 'graphql'],
      ['types.proto', 'proto'],
    ])('"%s" → code', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('code — Go / Rust / Java / Kotlin / Swift / C# / PHP / Scala / Lua', () => {
    test.each([
      ['main.go', 'go'],
      ['lib.rs', 'rust'],
      ['App.java', 'java'],
      ['Utils.kt', 'kotlin'],
      ['main.swift', 'swift'],
      ['Math.cs', 'csharp'],
      ['upload.php', 'php'],
      ['main.scala', 'scala'],
      ['utils.lua', 'lua'],
      ['math.c', 'c'],
      ['math.cpp', 'cpp'],
      ['math.cc', 'cpp'],
      ['math.hpp', 'cpp'],
      ['math.h', 'c'],
    ])('"%s" → code', (filename, expectedLang) => {
      const result = classifyFile(filename);
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe(expectedLang);
      expect(result.language).toBe(expectedLang);
    });
  });

  describe('special named files — Makefile', () => {
    test.each(['Makefile', 'makefile', 'MAKEFILE'])(
      '"%s" → code (makefile)',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('code');
        expect(result.highlightLanguage).toBe('makefile');
        expect(result.language).toBe('makefile');
      },
    );
  });

  describe('special named files — Dockerfile', () => {
    test.each(['Dockerfile', 'DOCKERFILE', 'dockerfile'])(
      '"%s" → code (dockerfile)',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('code');
        expect(result.highlightLanguage).toBe('dockerfile');
        expect(result.language).toBe('dockerfile');
      },
    );

    test('"Dockerfile.dev" → plain (ext "dev" not in CODE_EXTS)', () => {
      const result = classifyFile('Dockerfile.dev');
      expect(result.mode).toBe('plain');
    });

    test('"service.Dockerfile" → code (dockerfile)', () => {
      const result = classifyFile('service.Dockerfile');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('dockerfile');
      expect(result.language).toBe('dockerfile');
    });
  });

  describe('dotfiles — .dockerignore and .gitignore', () => {
    test.each(['.dockerignore', '.gitignore', '.DOCKERIGNORE', '.GITIGNORE'])(
      '"%s" → code (gitignore)',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('code');
        expect(result.highlightLanguage).toBe('gitignore');
        expect(result.language).toBe('gitignore');
      },
    );
  });

  describe('dotfiles with no extension', () => {
    test.each(['.bashrc', '.profile', '.zshrc', '.gitconfig'])(
      '"%s" → plain',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('plain');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('plain');
      },
    );
  });

  describe('multi-dot names', () => {
    test('"component.tsx" → code (typescript)', () => {
      const result = classifyFile('component.tsx');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('typescript');
    });

    test('"file.min.js" → code (javascript)', () => {
      const result = classifyFile('file.min.js');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('javascript');
    });

    test('"index.d.ts" → code (typescript)', () => {
      const result = classifyFile('index.d.ts');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('typescript');
    });

    test('"style.module.css" → code (css)', () => {
      const result = classifyFile('style.module.css');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('css');
    });
  });

  describe('plain — unknown extension', () => {
    test.each(['readme.txt', 'notes.rtf', 'data.csv', 'file.xyz', 'doc.ox'])(
      '"%s" → plain',
      (filename) => {
        const result = classifyFile(filename);
        expect(result.mode).toBe('plain');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('plain');
      },
    );
  });

  describe('plain — no extension at all', () => {
    test.each(['Makefile', 'Dockerfile', 'README', 'CHANGELOG', 'license'])(
      '"%s" → plain',
      (filename) => {
        const result = classifyFile(filename);
        // Only Makefile/Dockerfile get special handling;
        // everything else with no dot falls through to plain.
        if (filename === 'Makefile' || filename === 'Dockerfile') {
          expect(result.mode).toBe('code');
        } else {
          expect(result.mode).toBe('plain');
        }
      },
    );
  });

  describe('binary extension — classification remains independent of isBinaryPath', () => {
    // Binary detection is owned by isBinaryPath(); classifyFile() only
    // classifies text/code formats and returns plain for unknown types.
    // These cases verify the classifier does NOT throw and returns plain.
    test.each(['image.png', 'photo.jpg', 'archive.zip', 'data.pdf', 'font.woff2'])(
      '"%s" → plain (isBinaryPath guards separately)',
      (filename) => {
        const result = classifyFile(filename);
        // These are unknown to the tokenizer — fall back to plain.
        // Binary guard is handled by the caller's isBinaryPath() check.
        expect(result.mode).toBe('plain');
        expect(result.highlightLanguage).toBeUndefined();
        expect(result.language).toBe('plain');
      },
    );
  });

  describe('paths with directory prefix', () => {
    test('"src/components/Button.tsx" → code (typescript)', () => {
      const result = classifyFile('src/components/Button.tsx');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('typescript');
    });

    test('"docs/README.md" → markdown', () => {
      const result = classifyFile('docs/README.md');
      expect(result.mode).toBe('markdown');
    });

    test('".github/workflows/build.yml" → code (yaml)', () => {
      const result = classifyFile('.github/workflows/build.yml');
      expect(result.mode).toBe('code');
      expect(result.highlightLanguage).toBe('yaml');
    });
  });

  describe('shared descriptor stability (language field)', () => {
    // The `language` field must be a stable future LSP service key.
    // These assertions guard against accidental renaming.
    test('markdown uses "markdown" as language key', () => {
      expect(classifyFile('doc.md').language).toBe('markdown');
    });
    test('neorg uses "neorg" as language key', () => {
      expect(classifyFile('doc.norg').language).toBe('neorg');
    });
    test('org uses "org" as language key', () => {
      expect(classifyFile('doc.org').language).toBe('org');
    });
    test('json uses "json" as language key', () => {
      expect(classifyFile('data.json').language).toBe('json');
    });
    test('plain uses "plain" as language key', () => {
      expect(classifyFile('file.xyz').language).toBe('plain');
    });
    test('code uses highlightLanguage as language key', () => {
      expect(classifyFile('main.ts').language).toBe('typescript');
      expect(classifyFile('main.py').language).toBe('python');
      expect(classifyFile('Makefile').language).toBe('makefile');
    });
  });
});
