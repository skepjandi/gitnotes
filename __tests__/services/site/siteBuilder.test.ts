import type { Note } from '../../../src/models/Note';
import { buildSite, renderPreviewPage, resolveSitePath } from '../../../src/services/site/siteBuilder';
import { buildSiteCss } from '../../../src/services/site/siteCss';
import { applySitePreset, applySiteAccent, createDefaultSiteConfig } from '../../../src/services/site/siteThemes';
import { normalizeSiteConfig } from '../../../src/services/site/siteTypes';
import { sanitizeHref } from '../../../src/services/site/siteHtml';
import type { SiteArtifact } from '../../../src/services/site/siteTypes';

jest.mock('../../../src/utils/gitnotesImageResolver', () => ({
  resolveGitnotesImageUris: jest.fn(async (content: string) => content),
}));

let counter = 0;
function note(overrides: Partial<Note>): Note {
  counter += 1;
  return {
    id: `n${counter}`,
    title: `Note ${counter}`,
    content: 'hello',
    createdAt: 1_700_000_000_000 + counter * 1000,
    updatedAt: 1_700_000_000_000 + counter * 1000,
    tags: [],
    ...overrides,
  };
}

function text(artifact: SiteArtifact, path: string): string {
  const file = artifact.files.find((f) => f.path === path);
  if (!file || file.content.kind !== 'text') throw new Error(`missing text file ${path}`);
  return file.content.text;
}

const config = createDefaultSiteConfig();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('buildSite', () => {
  it('escapes raw HTML and drops unsafe link schemes in markdown', async () => {
    const artifact = await buildSite(
      [note({ title: 'Safe', content: '<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](https://example.com)\n\n![i](gitnotes://repo-image/a/b/main/x.png)' })],
      config,
    );
    const html = text(artifact, `notes/safe.html`);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('gitnotes://');
    expect(artifact.warnings.some((w) => w.code === 'image-unresolved')).toBe(true);
  });

  it('gives duplicate titles unique slugs and keeps them stable across note order', async () => {
    const a = note({ title: 'Same', createdAt: 1 });
    const b = note({ title: 'Same', createdAt: 2 });
    const first = await buildSite([a, b], config);
    const second = await buildSite([b, a], config);
    const slugsOf = (art: SiteArtifact) => Object.fromEntries(art.pages.map((p) => [p.noteId, p.slug]));
    expect(slugsOf(first)).toEqual({ [a.id]: 'same', [b.id]: 'same-2' });
    expect(slugsOf(second)).toEqual(slugsOf(first));
  });

  it('resolves wiki links only to published notes', async () => {
    const target = note({ title: 'Target' });
    const source = note({ title: 'Source', content: 'See [[Target]] and [[Secret|hidden]].' });
    const html = text(await buildSite([target, source], config), 'notes/source.html');
    expect(html).toContain('<a href="target.html">Target</a>');
    expect(html).toContain('<span class="unresolved">hidden</span>');
    expect(html).not.toContain('Secret');
  });

  it('removes a leading H1 that duplicates the note title', async () => {
    const html = text(await buildSite([note({ title: 'Dup', content: '# Dup\n\nbody' })], config), 'notes/dup.html');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('extracts embedded images into assets and rewrites src to relative paths', async () => {
    const artifact = await buildSite([note({ title: 'Pic', content: `![alt](data:image/png;base64,${PNG})` })], config);
    const asset = artifact.files.find((f) => f.path.startsWith('assets/img-'));
    expect(asset?.content).toEqual({ kind: 'base64', base64: PNG });
    expect(text(artifact, 'notes/pic.html')).toContain(`src="../${asset!.path}"`);
    expect(renderPreviewPage(artifact, 'notes/pic.html')).toContain(`data:image/png;base64,${PNG}`);
  });

  it('renders org and neorg notes without leaking markup injection', async () => {
    const org = note({ title: 'Org', format: 'org', content: '* Heading\nSome *bold* and /italic/ with [[https://example.com][a link]] <b>x</b>\n- one\n- two' });
    const neorg = note({ title: 'Neo', format: 'neorg', content: '* Heading\nSome *bold* and {https://example.com}[site] and {javascript:alert(1)}[bad]' });
    const artifact = await buildSite([org, neorg], config);
    const orgHtml = text(artifact, 'notes/org.html');
    expect(orgHtml).toContain('<strong>bold</strong>');
    expect(orgHtml).toContain('<em>italic</em>');
    expect(orgHtml).toContain('<a href="https://example.com" rel="noopener noreferrer">a link</a>');
    expect(orgHtml).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(orgHtml).toContain('<li>one');
    const neoHtml = text(artifact, 'notes/neo.html');
    expect(neoHtml).toContain('<a href="https://example.com" rel="noopener noreferrer">site</a>');
    expect(neoHtml).not.toContain('javascript:');
  });

  it('escapes json notes and skips pdf notes with a warning', async () => {
    const json = note({ title: 'Data', format: 'json', content: '{"a":"<img onerror=x>"}' });
    const pdf = note({ title: 'Doc', format: 'pdf', content: '' });
    const artifact = await buildSite([json, pdf], config);
    expect(text(artifact, 'notes/data.html')).toContain('&lt;img onerror=x&gt;');
    expect(artifact.pages.map((p) => p.title)).toEqual(['Data']);
    expect(artifact.warnings).toContainEqual(expect.objectContaining({ code: 'unsupported-format', noteId: pdf.id }));
  });

  it('is host-ready: root index, 404, css, .nojekyll, and sitemap only when a base URL is set', async () => {
    const n = note({ title: 'One' });
    const plain = await buildSite([n], config);
    expect(plain.files.map((f) => f.path)).toEqual(expect.arrayContaining(['index.html', '404.html', 'assets/style.css', '.nojekyll', 'notes/one.html']));
    expect(plain.files.map((f) => f.path)).not.toContain('sitemap.xml');

    const withBase = await buildSite([n], { ...config, baseUrl: 'https://me.github.io/notes/' });
    expect(text(withBase, 'sitemap.xml')).toContain('<loc>https://me.github.io/notes/notes/one.html</loc>');
    expect(text(withBase, 'index.html')).toContain('rel="canonical" href="https://me.github.io/notes/"');
    expect(text(withBase, '404.html')).toContain('href="/notes/assets/style.css"');
  });

  it('orders pinned notes first and links newer/older neighbours', async () => {
    const old = note({ title: 'Old', updatedAt: 1 });
    const fresh = note({ title: 'Fresh', updatedAt: 3 });
    const pinned = note({ title: 'Pinned', updatedAt: 2, isPinned: true });
    const artifact = await buildSite([old, fresh, pinned], config);
    expect(artifact.pages.map((p) => p.title)).toEqual(['Pinned', 'Fresh', 'Old']);
    expect(text(artifact, 'notes/fresh.html')).toContain('<span>Newer</span><a href="pinned.html">');
  });
});

describe('theme and config', () => {
  it('emits light and dark variables for auto mode and a single set for forced modes', () => {
    const auto = buildSiteCss({ ...config, colorMode: 'auto' });
    expect(auto).toContain('prefers-color-scheme:dark');
    const dark = buildSiteCss({ ...config, colorMode: 'dark' });
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain(`--background:${config.colors.dark.background}`);
  });

  it('applies accent to both modes and keeps text readable on it', () => {
    const next = applySiteAccent(config, '#ffff00');
    expect(next.colors.light.accent).toBe('#ffff00');
    expect(next.colors.dark.link).toBe('#ffff00');
    expect(buildSiteCss(next)).toContain('--on-accent:#000000');
  });

  it('switching preset replaces design but keeps site identity', () => {
    const next = applySitePreset({ ...config, title: 'Mine', navLinks: [{ label: 'a', url: 'https://a.dev' }] }, 'terminal');
    expect(next.bodyFont).toBe('mono');
    expect(next.title).toBe('Mine');
    expect(next.navLinks).toHaveLength(1);
  });

  it('rejects values that could break out of generated CSS/HTML', () => {
    const next = normalizeSiteConfig(
      {
        colors: { light: { accent: 'red;}</style><script>' } },
        fontScale: 99,
        navLinks: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'ok', url: 'https://ok.dev' }],
        baseUrl: 'http://insecure.dev',
        language: '"><x',
      },
      config,
    );
    expect(next.colors.light.accent).toBe(config.colors.light.accent);
    expect(next.fontScale).toBe(1.4);
    expect(next.navLinks).toEqual([{ label: 'ok', url: 'https://ok.dev' }]);
    expect(next.baseUrl).toBe('');
    expect(next.language).toBe('en');
  });

  it('neutralises a closing style tag in custom CSS', () => {
    expect(buildSiteCss({ ...config, customCss: 'a{}</style><script>x</script>' })).not.toMatch(/<\/style/i);
  });
});

describe('resolveSitePath', () => {
  it.each([
    ['index.html', 'notes/a.html', 'notes/a.html'],
    ['notes/a.html', 'b.html#top', 'notes/b.html'],
    ['notes/a.html', '../index.html', 'index.html'],
    ['notes/a.html', '/', 'index.html'],
    ['notes/a.html', 'https://x.dev', null],
  ])('%s + %s', (from, href, expected) => {
    expect(resolveSitePath(from, href)).toBe(expected);
  });
});

describe('sanitizeHref', () => {
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' \u0001javascript:alert(1)', 'data:text/html;base64,AAAA', 'gitnotes://repo-image/a/b/main/x.png', '//evil.test/x', 'vbscript:x'])(
    'rejects %j',
    (href) => {
      expect(sanitizeHref(href)).toBeNull();
    },
  );

  it.each(['https://example.com/a?b=1#c', 'http://example.com', 'mailto:me@example.com', 'other.html', '#section', '../index.html'])('keeps %j', (href) => {
    expect(sanitizeHref(href)).toBe(href);
  });
});
