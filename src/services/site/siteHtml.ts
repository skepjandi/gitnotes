import { Marked, Tokens, TokenizerAndRendererExtension } from 'marked';

import { NeorgContentBlock, NeorgListItem } from '../../models/NeorgContent';
import { Note } from '../../models/Note';
import { parseFrontmatter } from '../../utils/frontmatterParser';
import { NeorgContentParser } from '../NeorgContentParser';
import { OrgContentParser } from '../OrgContentParser';
import { SiteWarning } from './siteTypes';

export interface RenderContext {
  /** Resolves a wiki-style target (note title) to an href relative to the current page, or null if not published. */
  noteHref(target: string): string | null;
  /** Stores image bytes as a site asset and returns its href relative to the current page. */
  addDataAsset(mime: string, base64: string): string;
  warn(code: SiteWarning['code'], detail?: string): void;
}

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

export interface RenderedNote {
  html: string;
  toc: TocEntry[];
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|h[1-6]|li|ul|ol|tr|td|th|div|blockquote|pre|table|dt|dd|dl|figure|figcaption|details|summary|br|hr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Browsers ignore control characters and spaces inside a URL scheme (`java\tscript:`), so the scheme check must too. */
function stripControlAndSpace(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join('');
}

/** Allows http(s), mailto, fragments and scheme-less relative URLs; rejects everything else (javascript:, data:, gitnotes:, ...). */
export function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  const probe = stripControlAndSpace(href).toLowerCase();
  if (probe.startsWith('//')) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe);
  if (scheme) return scheme[1] === 'http' || scheme[1] === 'https' || scheme[1] === 'mailto' ? href : null;
  return href;
}

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i;

function resolveImageSrc(src: string, ctx: RenderContext): string | null {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const data = DATA_IMAGE.exec(trimmed);
  if (data) return ctx.addDataAsset(`image/${data[1].toLowerCase() === 'jpg' ? 'jpeg' : data[1].toLowerCase()}`, data[2].replace(/\s/g, ''));
  ctx.warn('image-unresolved', trimmed.startsWith('gitnotes://') ? 'private repository image could not be fetched' : trimmed.slice(0, 80));
  return null;
}

function imageHtml(src: string, alt: string, ctx: RenderContext, title?: string | null): string {
  const resolved = resolveImageSrc(src, ctx);
  if (!resolved) return alt ? `<span class="unresolved">${escapeHtml(alt)}</span>` : '';
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`;
}

export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

function linkHtml(href: string, labelHtml: string): string {
  const external = /^https?:\/\//i.test(href);
  const rel = external ? ' rel="noopener noreferrer"' : '';
  return `<a href="${escapeHtml(href)}"${rel}>${labelHtml}</a>`;
}

function wikiLinkHtml(target: string, label: string, ctx: RenderContext): string {
  const href = ctx.noteHref(target);
  if (!href) {
    ctx.warn('link-unselected', target);
    return `<span class="unresolved">${escapeHtml(label)}</span>`;
  }
  return linkHtml(href, escapeHtml(label));
}

function createHeadingIds() {
  const used = new Map<string, number>();
  return (text: string): string => {
    const base = slugify(text, 'section');
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

const WIKI_LINK_EXTENSION = (ctx: RenderContext): TokenizerAndRendererExtension => ({
  name: 'wikilink',
  level: 'inline',
  start: (src: string) => src.indexOf('[['),
  tokenizer(src: string) {
    const match = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (!match) return undefined;
    return { type: 'wikilink', raw: match[0], target: match[1].trim(), label: (match[2] ?? match[1]).trim() };
  },
  renderer(token) {
    return wikiLinkHtml(token.target as string, token.label as string, ctx);
  },
});

function renderMarkdown(source: string, title: string, ctx: RenderContext): RenderedNote {
  const toc: TocEntry[] = [];
  const headingId = createHeadingIds();

  const marked = new Marked({
    gfm: true,
    extensions: [WIKI_LINK_EXTENSION(ctx)],
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title: linkTitle, tokens }) {
        const safe = sanitizeHref(href);
        const label = this.parser.parseInline(tokens);
        if (!safe) return label;
        const titleAttr = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : '';
        const external = /^https?:\/\//i.test(safe) ? ' rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(safe)}"${titleAttr}${external}>${label}</a>`;
      },
      image({ href, title: imageTitle, text }) {
        return imageHtml(href, text, ctx, imageTitle);
      },
      heading({ tokens, depth, text }) {
        const id = headingId(text);
        if (depth === 2 || depth === 3) toc.push({ level: depth, text: text.trim(), id });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });

  const tokens = marked.lexer(parseFrontmatter(source).body);
  const first = tokens.find((t) => t.type !== 'space');
  if (first?.type === 'heading' && (first as Tokens.Heading).depth === 1 && (first as Tokens.Heading).text.trim().toLowerCase() === title.trim().toLowerCase()) {
    tokens.splice(tokens.indexOf(first), 1);
  }
  return { html: marked.parser(tokens), toc };
}

type Emphasis = { delimiter: string; tag: string };

const ORG_EMPHASIS: Emphasis[] = [
  { delimiter: '*', tag: 'strong' },
  { delimiter: '/', tag: 'em' },
  { delimiter: '_', tag: 'u' },
  { delimiter: '+', tag: 'del' },
];

const NEORG_EMPHASIS: Emphasis[] = [
  { delimiter: '*', tag: 'strong' },
  { delimiter: '/', tag: 'em' },
  { delimiter: '_', tag: 'u' },
  { delimiter: '-', tag: 'del' },
  { delimiter: '^', tag: 'sup' },
  { delimiter: ',', tag: 'sub' },
];

const PLACEHOLDER = '\u0000';

function emphasisRegex(delimiter: string): RegExp {
  const d = `\\${delimiter}`;
  return new RegExp(
    `(^|[\\s(\\[{${PLACEHOLDER}]|&quot;|&#39;)${d}([^\\s${d}](?:[^${d}\\n]*[^\\s${d}])?)${d}(?=$|[\\s.,;:!?)\\]}${PLACEHOLDER}]|&quot;|&#39;)`,
    'g',
  );
}

type LightFlavor = 'org' | 'neorg';

function linkTargetHtml(target: string, label: string | undefined, ctx: RenderContext): string {
  const text = label?.trim() || target;
  const href = /^(https?:\/\/|mailto:)/i.test(target) ? sanitizeHref(target) : null;
  if (href) return linkHtml(href, escapeHtml(text));
  const title = target.replace(/^[*#:/\s]+|[:/\s]+$/g, '');
  return title && ctx.noteHref(title) ? wikiLinkHtml(title, text, ctx) : escapeHtml(text);
}

/** Inline renderer for Org and Neorg: links, code, then emphasis, with output stashed so later passes can't re-match emitted tags. */
function renderLightInline(raw: string, flavor: LightFlavor, ctx: RenderContext): string {
  const stash: string[] = [];
  const hold = (html: string) => `${PLACEHOLDER}${stash.push(html) - 1}${PLACEHOLDER}`;

  const linkPattern = flavor === 'org' ? /\[\[([^\]]+)\](?:\[([^\]]*)\])?\]/g : /\{([^}]+)\}(?:\[([^\]]*)\])?/g;
  let text = raw.replace(linkPattern, (_m, target: string, label?: string) => hold(linkTargetHtml(target.trim(), label, ctx)));

  const codePattern = flavor === 'org' ? /(^|[\s(])[=~]([^\s=~](?:[^=~\n]*[^\s=~])?)[=~](?=$|[\s.,;:!?)])/g : /(^|[\s(])`([^`\n]+)`/g;
  text = text.replace(codePattern, (_m, pre: string, code: string) => pre + hold(`<code>${escapeHtml(code)}</code>`));

  const emphasize = (value: string): string => {
    let out = value;
    for (const { delimiter, tag } of flavor === 'org' ? ORG_EMPHASIS : NEORG_EMPHASIS) {
      out = out.replace(emphasisRegex(delimiter), (_m, pre: string, inner: string) => `${pre}${hold(`<${tag}>${emphasize(inner)}</${tag}>`)}`);
    }
    return out;
  };

  let html = emphasize(escapeHtml(text));
  const restore = new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g');
  while (restore.test(html)) {
    restore.lastIndex = 0;
    html = html.replace(restore, (_m, index: string) => stash[Number(index)]);
    restore.lastIndex = 0;
  }
  return html;
}

function flattenList(items: NeorgListItem[], out: NeorgListItem[] = []): NeorgListItem[] {
  for (const item of items) {
    out.push(item);
    if (item.children) flattenList(item.children, out);
  }
  return out;
}

function renderList(items: NeorgListItem[], inline: (text: string) => string): string {
  const stack: { level: number; tag: 'ul' | 'ol' }[] = [];
  let html = '';
  for (const item of flattenList(items)) {
    while (stack.length && stack[stack.length - 1].level > item.indentLevel) html += `</li></${stack.pop()!.tag}>`;
    const top = stack[stack.length - 1];
    if (!top || top.level < item.indentLevel) {
      const tag = item.type === 'ordered' ? 'ol' : 'ul';
      html += `<${tag}>`;
      stack.push({ level: item.indentLevel, tag });
    } else {
      html += '</li>';
    }
    const checkbox = item.type === 'task' ? `<input type="checkbox" disabled${item.status === 'done' ? ' checked' : ''}> ` : '';
    html += `<li>${checkbox}${inline(item.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`;
  return html;
}

function renderBlocks(blocks: NeorgContentBlock[], flavor: LightFlavor, title: string, ctx: RenderContext): RenderedNote {
  const inline = (text: string) => renderLightInline(text, flavor, ctx);
  const toc: TocEntry[] = [];
  const headingId = createHeadingIds();
  const out: string[] = [];

  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'heading': {
        const heading = block.heading;
        if (!heading) return;
        if (index === 0 && heading.level === 1 && heading.text.trim().toLowerCase() === title.trim().toLowerCase()) return;
        const level = Math.min(6, Math.max(1, heading.level));
        const id = headingId(heading.text);
        if (level === 2 || level === 3) toc.push({ level, text: heading.text, id });
        const state = heading.todoState ? `<span class="todo-state">${escapeHtml(heading.todoState)}</span>` : '';
        const tags = heading.tags?.length ? ` <span class="meta">${heading.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</span>` : '';
        out.push(`<h${level} id="${id}">${state}${inline(heading.text)}${tags}</h${level}>`);
        return;
      }
      case 'paragraph':
        if (block.text) out.push(`<p>${inline(block.text)}</p>`);
        return;
      case 'list':
        if (block.listItems) out.push(renderList(block.listItems, inline));
        return;
      case 'checklist':
        out.push(
          `<ul class="checklist">${(block.checklistItems ?? [])
            .map((item) => `<li><input type="checkbox" disabled${item.checked ? ' checked' : ''}> ${inline(item.text)}</li>`)
            .join('')}</ul>`,
        );
        return;
      case 'code': {
        const language = block.code?.language ? ` class="language-${escapeHtml(block.code.language.replace(/[^\w-]/g, ''))}"` : '';
        out.push(`<pre><code${language}>${escapeHtml(block.code?.content ?? '')}</code></pre>`);
        return;
      }
      case 'fixed-width':
      case 'math':
        out.push(`<pre><code>${escapeHtml(block.text ?? block.math?.content ?? '')}</code></pre>`);
        return;
      case 'table': {
        const rows = (block.tableRows ?? []).map((row, i) => {
          const cellTag = block.isHeaderRow?.[i] ? 'th' : 'td';
          return `<tr>${row.cells.map((cell) => `<${cellTag}>${inline(cell)}</${cellTag}>`).join('')}</tr>`;
        });
        out.push(`<table>${rows.join('')}</table>`);
        return;
      }
      case 'quote':
        if (block.text) out.push(`<blockquote><p>${inline(block.text)}</p></blockquote>`);
        return;
      case 'divider':
        out.push('<hr>');
        return;
      case 'definition':
        out.push(`<dl>${(block.definitionItems ?? []).map((d) => `<dt>${inline(d.term)}</dt><dd>${inline(d.definition)}</dd>`).join('')}</dl>`);
        return;
      case 'footnote':
        if (block.footnote) out.push(`<p class="meta"><sup>${escapeHtml(block.footnote.label)}</sup> ${inline(block.footnote.content)}</p>`);
        return;
      case 'timestamp':
        if (block.timestamp) out.push(`<p class="meta">${escapeHtml([block.timestamp.date, block.timestamp.time].filter(Boolean).join(' '))}</p>`);
        return;
      case 'image': {
        if (!block.image) return;
        const caption = block.image.caption ? `<figcaption>${escapeHtml(block.image.caption)}</figcaption>` : '';
        out.push(`<figure>${imageHtml(block.image.path, block.image.caption ?? '', ctx)}${caption}</figure>`);
        return;
      }
      case 'details':
        out.push(`<details><summary>${inline(block.details?.summary ?? '')}</summary><p>${inline(block.details?.content ?? '')}</p></details>`);
        return;
      default:
        return; // drawer, comment: private metadata never published
    }
  });
  return { html: out.join('\n'), toc };
}

function renderJson(source: string): RenderedNote {
  let pretty = source;
  try {
    pretty = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    // not valid JSON: publish the raw text, escaped
  }
  return { html: `<pre class="json"><code>${escapeHtml(pretty)}</code></pre>`, toc: [] };
}

/** Renders a note body to HTML. Returns null for formats that cannot be published (pdf). */
export function renderNoteBody(note: Note, ctx: RenderContext): RenderedNote | null {
  const title = note.title ?? '';
  switch (note.format ?? 'markdown') {
    case 'markdown':
      return renderMarkdown(note.content, title, ctx);
    case 'json':
      return renderJson(note.content);
    case 'org': {
      const parsed = OrgContentParser.parseContent(note.content);
      return parsed.success ? renderBlocks(parsed.blocks ?? [], 'org', title, ctx) : renderMarkdown(note.content, title, ctx);
    }
    case 'neorg': {
      const parsed = NeorgContentParser.parseContent(note.content);
      return parsed.success ? renderBlocks(parsed.blocks ?? [], 'neorg', title, ctx) : renderMarkdown(note.content, title, ctx);
    }
    default:
      return null;
  }
}
