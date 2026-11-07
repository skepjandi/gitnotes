import { Note } from '../../models/Note';
import { resolveGitnotesImageUris } from '../../utils/gitnotesImageResolver';
import { buildSiteCss } from './siteCss';
import { escapeHtml, htmlToText, renderNoteBody, RenderContext, RenderedNote, slugify, TocEntry } from './siteHtml';
import { createDefaultSiteConfig } from './siteThemes';
import { normalizeSiteConfig, SiteArtifact, SiteConfig, SiteFile, SitePage, SiteWarning } from './siteTypes';

export interface BuildSiteOptions {
  /** Replaces app-internal image URIs with data: URIs. Injectable for tests. */
  resolveImages?: (content: string) => Promise<string>;
}

const EXCERPT_LENGTH = 180;
const WORDS_PER_MINUTE = 220;
const DEFAULT_TITLE = 'Untitled';

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function excerptOf(html: string): string {
  const text = htmlToText(html);
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text;
}

function noteTitle(note: Note): string {
  return note.title?.trim() || DEFAULT_TITLE;
}

function faviconHref(emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${escapeHtml(emoji)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface LayoutInput {
  pageTitle: string;
  description: string;
  /** Prefix from the page to the site root, e.g. '' or '../' (or an absolute base path for 404.html). */
  root: string;
  body: string;
  canonical?: string;
}

function renderLayout(config: SiteConfig, input: LayoutInput): string {
  const { root } = input;
  const nav = config.navLinks.length
    ? `<nav class="site-nav">${config.navLinks.map((l) => `<a href="${escapeHtml(l.url)}" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join('')}</nav>`
    : '';
  const tagline = config.tagline ? `<p class="site-tagline">${escapeHtml(config.tagline)}</p>` : '';
  const footer = config.footer ? `<footer class="site-footer wrap">${escapeHtml(config.footer)}</footer>` : '';
  const canonical = input.canonical ? `<link rel="canonical" href="${escapeHtml(input.canonical)}">` : '';
  const description = input.description ? `<meta name="description" content="${escapeHtml(input.description)}">` : '';
  const author = config.author ? `<meta name="author" content="${escapeHtml(config.author)}">` : '';

  return `<!doctype html>
<html lang="${escapeHtml(config.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.pageTitle)}</title>
${description}
${author}
${canonical}
<link rel="icon" href="${faviconHref(config.faviconEmoji || '📝')}">
<link rel="stylesheet" href="${escapeHtml(root)}assets/style.css">
</head>
<body>
<div class="site-header-wrap"><header class="site-header wrap"><a class="site-title" href="${escapeHtml(root)}index.html">${escapeHtml(config.title)}</a>${tagline}${nav}</header></div>
<main class="wrap">
${input.body}
</main>
${footer}
</body>
</html>
`;
}

interface NoteEntry {
  note: Note;
  title: string;
  slug: string;
}

function assignSlugs(notes: Note[]): Map<string, string> {
  const slugs = new Map<string, string>();
  const used = new Set<string>();
  const byAge = [...notes].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const note of byAge) {
    const base = slugify(noteTitle(note), 'note');
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    slugs.set(note.id, slug);
  }
  return slugs;
}

function metaHtml(config: SiteConfig, note: Note, words: number): string {
  const parts: string[] = [];
  if (config.showDates) parts.push(`<time datetime="${formatDay(note.createdAt)}">${formatDay(note.createdAt)}</time>`);
  if (config.showReadingTime) parts.push(`<span>${Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))} min read</span>`);
  if (config.showTags && note.tags.length) {
    parts.push(`<span>${note.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</span>`);
  }
  return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
}

function tocHtml(toc: TocEntry[]): string {
  if (toc.length < 3) return '';
  const items = toc.map((entry) => `<li class="l${entry.level}"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`).join('');
  return `<nav class="toc"><strong>Contents</strong><ol>${items}</ol></nav>`;
}

function basePathOf(baseUrl: string): string {
  if (!baseUrl) return '/';
  const { pathname } = new URL(baseUrl);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function sitemapXml(config: SiteConfig, pages: { slug: string; updatedAt: number }[]): string {
  const urls = [`<url><loc>${escapeHtml(config.baseUrl)}/</loc></url>`].concat(
    pages.map((p) => `<url><loc>${escapeHtml(config.baseUrl)}/notes/${p.slug}.html</loc><lastmod>${formatDay(p.updatedAt)}</lastmod></url>`),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export async function buildSite(notes: Note[], rawConfig: SiteConfig, options: BuildSiteOptions = {}): Promise<SiteArtifact> {
  const config = normalizeSiteConfig(rawConfig, createDefaultSiteConfig());
  const resolveImages = options.resolveImages ?? resolveGitnotesImageUris;
  const warnings: SiteWarning[] = [];
  const files: SiteFile[] = [];
  const assets = new Map<string, string>();

  const publishable = notes.filter((note) => {
    if ((note.format ?? 'markdown') !== 'pdf') return true;
    warnings.push({ noteId: note.id, noteTitle: noteTitle(note), code: 'unsupported-format', detail: 'pdf' });
    return false;
  });

  const slugs = assignSlugs(publishable);
  const ordered: NoteEntry[] = [...publishable]
    .sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .map((note) => ({ note, title: noteTitle(note), slug: slugs.get(note.id)! }));

  const slugByTitle = new Map<string, string>();
  for (const entry of ordered) {
    const key = entry.title.toLowerCase();
    if (!slugByTitle.has(key)) slugByTitle.set(key, entry.slug);
  }

  const rendered: { entry: NoteEntry; body: RenderedNote; words: number }[] = [];
  for (const entry of ordered) {
    const { note } = entry;
    if (!note.content.trim()) warnings.push({ noteId: note.id, noteTitle: entry.title, code: 'empty-note' });

    const ctx: RenderContext = {
      noteHref: (target) => {
        const slug = slugByTitle.get(target.trim().toLowerCase());
        return slug ? `${slug}.html` : null;
      },
      addDataAsset: (mime, base64) => {
        const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
        const path = `assets/img-${fnv1a(base64)}.${ext}`;
        assets.set(path, base64);
        return `../${path}`;
      },
      warn: (code, detail) => warnings.push({ noteId: note.id, noteTitle: entry.title, code, detail }),
    };

    const resolved = { ...note, content: await resolveImages(note.content) };
    const body = renderNoteBody(resolved, ctx);
    if (!body) {
      warnings.push({ noteId: note.id, noteTitle: entry.title, code: 'unsupported-format', detail: note.format });
      continue;
    }
    rendered.push({ entry, body, words: htmlToText(body.html).split(' ').filter(Boolean).length });
  }

  const pages: SitePage[] = rendered.map(({ entry }) => ({
    noteId: entry.note.id,
    slug: entry.slug,
    path: `notes/${entry.slug}.html`,
    title: entry.title,
  }));

  const canonicalFor = (path: string) => (config.baseUrl ? `${config.baseUrl}/${path}` : undefined);

  rendered.forEach(({ entry, body, words }, i) => {
    const newer = rendered[i - 1]?.entry;
    const older = rendered[i + 1]?.entry;
    const pager =
      config.showPrevNext && (newer || older)
        ? `<nav class="pager"><div>${newer ? `<span>Newer</span><a href="${newer.slug}.html">${escapeHtml(newer.title)}</a>` : ''}</div><div>${older ? `<span>Older</span><a href="${older.slug}.html">${escapeHtml(older.title)}</a>` : ''}</div></nav>`
        : '';
    const article = `<article>
<header><h1>${escapeHtml(entry.title)}</h1>${metaHtml(config, entry.note, words)}</header>
${config.showToc ? tocHtml(body.toc) : ''}
${body.html}
</article>
${pager}`;
    files.push({
      path: `notes/${entry.slug}.html`,
      content: {
        kind: 'text',
        text: renderLayout(config, {
          pageTitle: `${entry.title} · ${config.title}`,
          description: excerptOf(body.html),
          root: '../',
          body: article,
          canonical: canonicalFor(`notes/${entry.slug}.html`),
        }),
      },
    });
  });

  const items = rendered
    .map(({ entry, body, words }) => {
      return `<article class="note-item"><h2><a href="notes/${entry.slug}.html">${escapeHtml(entry.title)}</a></h2>${metaHtml(config, entry.note, words)}<p class="note-excerpt">${escapeHtml(excerptOf(body.html))}</p></article>`;
    })
    .join('\n');
  const indexBody = rendered.length ? `<div class="note-list">\n${items}\n</div>` : '<p>Nothing published yet.</p>';
  const basePath = basePathOf(config.baseUrl);

  files.push(
    {
      path: 'index.html',
      content: {
        kind: 'text',
        text: renderLayout(config, {
          pageTitle: config.title,
          description: config.tagline,
          root: '',
          body: indexBody,
          canonical: config.baseUrl ? `${config.baseUrl}/` : undefined,
        }),
      },
    },
    {
      path: '404.html',
      content: {
        kind: 'text',
        text: renderLayout(config, {
          pageTitle: `Not found · ${config.title}`,
          description: '',
          root: basePath,
          body: `<h1>Page not found</h1><p><a href="${escapeHtml(basePath)}index.html">Back to ${escapeHtml(config.title)}</a></p>`,
        }),
      },
    },
    { path: 'assets/style.css', content: { kind: 'text', text: buildSiteCss(config) } },
    { path: '.nojekyll', content: { kind: 'text', text: '' } },
  );

  for (const [path, base64] of assets) files.push({ path, content: { kind: 'base64', base64 } });

  if (config.baseUrl) {
    files.push(
      {
        path: 'sitemap.xml',
        content: { kind: 'text', text: sitemapXml(config, rendered.map(({ entry }) => ({ slug: entry.slug, updatedAt: entry.note.updatedAt }))) },
      },
      { path: 'robots.txt', content: { kind: 'text', text: `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n` } },
    );
  }

  return { files, pages, warnings };
}

/** Resolves a relative href found on `fromPath` to a site-root-relative path (no query/hash). Returns null for external URLs. */
export function resolveSitePath(fromPath: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const target = href.split(/[?#]/)[0];
  if (!target) return fromPath;
  const segments = target.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') segments.pop();
    else if (part && part !== '.') segments.push(part);
  }
  const path = segments.join('/');
  return path.endsWith('/') || path === '' ? `${path}index.html` : path;
}

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/**
 * Produces a self-contained version of one page (CSS inlined, local images as data: URIs) for the in-app
 * WebView preview. Returns null when the page does not exist in the artifact.
 */
export function renderPreviewPage(artifact: SiteArtifact, path: string): string | null {
  const page = artifact.files.find((f) => f.path === path);
  if (!page || page.content.kind !== 'text') return null;
  const css = artifact.files.find((f) => f.path === 'assets/style.css');
  const cssText = css?.content.kind === 'text' ? css.content.text : '';

  return page.content.text
    .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${cssText}</style>`)
    .replace(/(src)="((?:\.\.\/)?assets\/[^"]+)"/g, (match, attr: string, src: string) => {
      const file = artifact.files.find((f) => f.path === src.replace(/^\.\.\//, ''));
      if (file?.content.kind !== 'base64') return match;
      const ext = file.path.split('.').pop() ?? '';
      return `${attr}="data:${MIME_BY_EXT[ext] ?? 'application/octet-stream'};base64,${file.content.base64}"`;
    });
}
