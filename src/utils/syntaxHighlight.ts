export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'operator' | 'punctuation' | 'plain';

export type Token = {
  text: string;
  type: TokenType;
};

export const MAX_TOKENIZE_BYTES = 256 * 1024;

export function isOversized(content: string): boolean {
  const encoded = new TextEncoder().encode(content);
  return encoded.length > MAX_TOKENIZE_BYTES;
}

type LanguageConfig = {
  keywords: Set<string>;
  functionMatchers: RegExp[];
  commentMatchers: RegExp[];
  stringMatchers: RegExp[];
  numberMatcher: RegExp;
  operatorMatcher: RegExp;
  punctuationMatcher: RegExp;
  identifierMatcher: RegExp;
};

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from',
  'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined',
  'typeof', 'instanceof',
]);

const PYTHON_KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'with', 'as',
  'True', 'False', 'None', 'lambda', 'yield', 'pass', 'break', 'continue',
]);

const BASH_KEYWORDS = new Set(['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function']);

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

const YAML_KEYWORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']);

const CSS_KEYWORDS = new Set([
  'class', 'color', 'background', 'background-color', 'display', 'position', 'relative', 'absolute', 'fixed', 'flex',
  'grid', 'inline', 'block', 'none',
]);

const HTML_KEYWORDS = new Set(['div', 'span', 'p', 'a', 'img', 'section', 'article', 'class', 'id', 'href', 'src']);

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'join', 'left',
  'right', 'inner', 'outer', 'on', 'and', 'or', 'not', 'as', 'group', 'by', 'order', 'limit', 'distinct', 'count',
]);

const GO_KEYWORDS = new Set(['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'struct', 'type', 'var', 'const']);

const COMMON_NUMBER = /\b\d+(?:\.\d+)?\b/y;
const COMMON_OPERATOR = /===|!==|==|!=|<=|>=|->|=>|\+\+|--|&&|\|\||[:=+\-*/%<>]/y;
const COMMON_PUNCTUATION = /[(){},.;<>]/y;
const COMMON_IDENTIFIER = /[A-Za-z_$][\w$-]*/y;
const COMMON_WHITESPACE = /\s+/y;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatcher(keywords: Set<string>, flags = 'iy'): RegExp {
  if (keywords.size === 0) {
    return /$^/y;
  }

  const pattern = Array.from(keywords)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');

  return new RegExp(`\\b(?:${pattern})\\b`, flags);
}

function buildConfig(language: string): LanguageConfig | null {
  const normalized = language.trim().toLowerCase();

  switch (normalized) {
    case 'js':
    case 'javascript':
    case 'jsx':
    case 'ts':
    case 'typescript':
    case 'tsx':
      return {
        keywords: JS_KEYWORDS,
        functionMatchers: [/\bfunction\s+([A-Za-z_$][\w$]*)/y],
        commentMatchers: [/\/\/[^\n]*/y, /\/\*[\s\S]*?\*\//y],
        stringMatchers: [/`(?:\\.|[^`])*`/y, /'(?:\\.|[^'\\])*'/y, /"(?:\\.|[^"\\])*"/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: COMMON_PUNCTUATION,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'python':
      return {
        keywords: PYTHON_KEYWORDS,
        functionMatchers: [/\bdef\s+([A-Za-z_][\w]*)/y],
        commentMatchers: [/#.*$/my],
        stringMatchers: [/'''[\s\S]*?'''/y, /"""[\s\S]*?"""/y, /'(?:\\.|[^'\\])*'/y, /"(?:\\.|[^"\\])*"/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: /[(){},.:]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'bash':
    case 'sh':
    case 'shell': {
      // (?:#!.*\n)? eats the shebang first so the negative-lookahead
      // below checks the correct position (after any shebang + whitespace).
      // Keywords are excluded so they fall through to the keyword step.
      const shellFnRe = new RegExp(
        String.raw`^(?:#!.*\n)?\s*(?!(?:if|then|else|fi|for|while|do|done|case|esac|function\b))([A-Za-z_][\w-]*)`,
        'my',
      );
      return {
        keywords: BASH_KEYWORDS,
        functionMatchers: [shellFnRe],
        commentMatchers: [/#.*$/my],
        stringMatchers: [/'(?:\\.|[^'\\])*'/y, /"(?:\\.|[^"\\])*"/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: COMMON_PUNCTUATION,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    }
    case 'json':
      return {
        keywords: JSON_KEYWORDS,
        functionMatchers: [],
        commentMatchers: [],
        stringMatchers: [/"(?:\\.|[^"\\])*"/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: /[{},:]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'yaml':
    case 'yml':
      return {
        keywords: YAML_KEYWORDS,
        functionMatchers: [],
        commentMatchers: [/#.*$/my],
        stringMatchers: [/"(?:\\.|[^"\\])*"/y, /'(?:\\.|[^'\\])*'/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: /:/y,
        punctuationMatcher: /[:-{}.,-]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'css':
      return {
        keywords: CSS_KEYWORDS,
        functionMatchers: [],
        commentMatchers: [/\/\*[\s\S]*?\*\//y],
        stringMatchers: [/"(?:\\.|[^"\\])*"/y, /'(?:\\.|[^'\\])*'/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: /[=]/y,
        punctuationMatcher: /[{}();.,#>:]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'html':
      return {
        keywords: HTML_KEYWORDS,
        functionMatchers: [],
        commentMatchers: [/<!--[\s\S]*?-->/y],
        stringMatchers: [/"(?:\\.|[^"\\])*"/y, /'(?:\\.|[^'\\])*'/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: /[:=]/y,
        punctuationMatcher: /[<>]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'sql':
      return {
        keywords: SQL_KEYWORDS,
        functionMatchers: [],
        commentMatchers: [/--.*$/my, /\/\*[\s\S]*?\*\//y],
        stringMatchers: [/"(?:\\.|[^"\\])*"/y, /'(?:\\.|[^'\\])*'/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: /\*|=|<>|<=|>=|<|>/y,
        punctuationMatcher: /[(),.;]/y,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    case 'go':
      return {
        keywords: GO_KEYWORDS,
        functionMatchers: [/\bfunc\s+([A-Za-z_][\w]*)/y],
        commentMatchers: [/\/\/[^\n]*/y, /\/\*[\s\S]*?\*\//y],
        stringMatchers: [/`(?:[\s\S]*?)`/y, /"(?:\\.|[^"\\])*"/y],
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: COMMON_PUNCTUATION,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    // Graceful degradation — languages listed in fileLanguage.ts TOKENIZER_EXT_MAP
    // but without dedicated configs fall through to plain-text rendering.
    case 'ruby':
    case 'rust': {
      const noOpMatchers: RegExp[] = [];
      return {
        keywords: new Set<string>(),
        functionMatchers: noOpMatchers,
        commentMatchers: noOpMatchers,
        stringMatchers: noOpMatchers,
        numberMatcher: COMMON_NUMBER,
        operatorMatcher: COMMON_OPERATOR,
        punctuationMatcher: COMMON_PUNCTUATION,
        identifierMatcher: COMMON_IDENTIFIER,
      };
    }
    default:
      return null;
  }
}

function matchAt(regex: RegExp, input: string, index: number): RegExpExecArray | null {
  regex.lastIndex = index;
  const match = regex.exec(input);

  if (!match || match.index !== index) {
    return null;
  }

  return match;
}

function pushPlain(tokens: Token[], text: string): void {
  if (text.length > 0) {
    tokens.push({ text, type: 'plain' });
  }
}

function tokenizeYAML(code: string, config: LanguageConfig): Token[] {
  const lines = code.split(/(\r?\n)/);
  const tokens: Token[] = [];

  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] ?? '';
    const newline = lines[i + 1] ?? '';
    const commentMatch = matchAt(config.commentMatchers[0] ?? /$^/y, line, 0);

    if (commentMatch) {
      tokens.push({ text: commentMatch[0], type: 'comment' });
    } else {
      const keyValueMatch = /^(\s*)([^\s:#][^:]*)?(\s*):(\s*)(.*)$/.exec(line);
      if (keyValueMatch && keyValueMatch[2]) {
        const [, leading, key, colonSpacing, afterColonSpacing, value] = keyValueMatch;
        pushPlain(tokens, leading);
        tokens.push({ text: key, type: 'string' });
        pushPlain(tokens, colonSpacing);
        tokens.push({ text: ':', type: 'punctuation' });
        pushPlain(tokens, afterColonSpacing);
        const valueText = value.trimStart();
        if (valueText) {
          const leadingValueSpaces = value.slice(0, value.length - valueText.length);
          pushPlain(tokens, leadingValueSpaces);
          if (config.keywords.has(valueText.toLowerCase()) || config.keywords.has(valueText)) {
            tokens.push({ text: valueText, type: 'keyword' });
          } else if (config.numberMatcher.test(valueText)) {
            config.numberMatcher.lastIndex = 0;
            tokens.push({ text: valueText, type: 'number' });
          } else {
            tokens.push({ text: valueText, type: 'string' });
          }
        }
      } else {
        pushPlain(tokens, line);
      }
    }

    if (newline) {
      tokens.push({ text: newline, type: 'plain' });
    }
  }

  return tokens;
}

function tokenizeByRegex(code: string, config: LanguageConfig): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < code.length) {
    const rest = code.slice(index);

    const matchedComment = config.commentMatchers.map((regex) => matchAt(regex, code, index)).find(Boolean);
    if (matchedComment) {
      tokens.push({ text: matchedComment[0], type: 'comment' });
      index += matchedComment[0].length;
      continue;
    }

    const matchedString = config.stringMatchers.map((regex) => matchAt(regex, code, index)).find(Boolean);
    if (matchedString) {
      tokens.push({ text: matchedString[0], type: 'string' });
      index += matchedString[0].length;
      continue;
    }

    const matchedFunction = config.functionMatchers.map((regex) => matchAt(regex, code, index)).find(Boolean);
    if (matchedFunction) {
      const name = matchedFunction[1];
      if (name) {
        const full = matchedFunction[0];
        const prefix = full.slice(0, full.length - name.length);
        const trimmedPrefix = prefix.trim();

        if (trimmedPrefix) {
          const leadingSpaces = prefix.match(/^\s*/)?.[0] ?? '';
          const trailingSpaces = prefix.slice(leadingSpaces.length + trimmedPrefix.length);
          pushPlain(tokens, leadingSpaces);
          tokens.push({ text: trimmedPrefix, type: 'keyword' });
          pushPlain(tokens, trailingSpaces);
        } else {
          pushPlain(tokens, prefix);
        }

        tokens.push({ text: name, type: 'function' });
        index += full.length;
        continue;
      }
    }

    const matchedNumber = matchAt(config.numberMatcher, code, index);
    if (matchedNumber) {
      tokens.push({ text: matchedNumber[0], type: 'number' });
      index += matchedNumber[0].length;
      continue;
    }

    const matchedKeyword = matchAt(keywordMatcher(config.keywords), code, index);
    if (matchedKeyword) {
      tokens.push({ text: matchedKeyword[0], type: 'keyword' });
      index += matchedKeyword[0].length;
      continue;
    }

    const matchedPunctuation = matchAt(config.punctuationMatcher, code, index);
    if (matchedPunctuation) {
      tokens.push({ text: matchedPunctuation[0], type: 'punctuation' });
      index += matchedPunctuation[0].length;
      continue;
    }

    const matchedOperator = matchAt(config.operatorMatcher, code, index);
    if (matchedOperator) {
      tokens.push({ text: matchedOperator[0], type: 'operator' });
      index += matchedOperator[0].length;
      continue;
    }

    const matchedWhitespace = matchAt(COMMON_WHITESPACE, code, index);
    if (matchedWhitespace) {
      tokens.push({ text: matchedWhitespace[0], type: 'plain' });
      index += matchedWhitespace[0].length;
      continue;
    }

    const matchedIdentifier = matchAt(config.identifierMatcher, code, index);
    if (matchedIdentifier) {
      tokens.push({ text: matchedIdentifier[0], type: 'plain' });
      index += matchedIdentifier[0].length;
      continue;
    }

    tokens.push({ text: rest[0], type: 'plain' });
    index += 1;
  }

  return tokens;
}

export function tokenize(code: string, language: string): Token[] {
  if (isOversized(code)) {
    return code.length > 0 ? [{ text: code, type: 'plain' }] : [];
  }

  const config = buildConfig(language);

  if (!config) {
    return code.length > 0 ? [{ text: code, type: 'plain' }] : [];
  }

  const normalizedLang = language.trim().toLowerCase();
  if (normalizedLang === 'yaml' || normalizedLang === 'yml') {
    return tokenizeYAML(code, config);
  }

  return tokenizeByRegex(code, config);
}

export function getThemeColors(isDark: boolean): Record<TokenType, string> {
  return isDark
    ? {
        keyword: '#93c5fd',
        string: '#fda4af',
        comment: '#cbd5e1',
        number: '#fde68a',
        function: '#a7f3d0',
        operator: '#f9a8d4',
        punctuation: '#e2e8f0',
        plain: '#f8fafc',
      }
    : {
        keyword: '#1d4ed8',
        string: '#be123c',
        comment: '#64748b',
        number: '#b45309',
        function: '#047857',
        operator: '#a21caf',
        punctuation: '#334155',
        plain: '#0f172a',
      };
}
