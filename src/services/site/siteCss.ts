import { SITE_FONT_STACKS, readableTextOn } from './siteThemes';
import { PALETTE_KEYS, SiteConfig, SitePalette } from './siteTypes';

function cssVars(p: SitePalette): string {
  const vars = PALETTE_KEYS.map((key) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${p[key]};`);
  return `${vars.join('')}--on-accent:${readableTextOn(p.accent)};`;
}

function colorSchemeCss(config: SiteConfig): string {
  const { light, dark } = config.colors;
  if (config.colorMode === 'light') return `:root{color-scheme:light;${cssVars(light)}}`;
  if (config.colorMode === 'dark') return `:root{color-scheme:dark;${cssVars(dark)}}`;
  return (
    `:root{color-scheme:light dark;${cssVars(light)}}` +
    `@media (prefers-color-scheme:dark){:root{${cssVars(dark)}}}`
  );
}

const LINK_STYLES: Record<SiteConfig['linkStyle'], string> = {
  underline: 'a{color:var(--link);text-decoration:underline;text-underline-offset:.18em}',
  hover: 'a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:.18em}',
  highlight:
    'a{color:var(--link);text-decoration:none;background:linear-gradient(transparent 62%,color-mix(in srgb,var(--link) 28%,transparent) 62%)}a:hover{background:color-mix(in srgb,var(--link) 22%,transparent)}',
};

const HEADER_STYLES: Record<SiteConfig['headerStyle'], string> = {
  left: '.site-header{padding-block:2.25rem 1.5rem}',
  centered: '.site-header{padding-block:2.5rem 1.75rem;text-align:center}.site-nav{justify-content:center}',
  banner:
    '.site-header-wrap{background:var(--accent);color:var(--on-accent)}.site-header{padding-block:2.75rem 2.25rem}.site-header a,.site-title,.site-tagline{color:var(--on-accent);background:none}.site-tagline{opacity:.85}',
  minimal: '.site-header{padding-block:1.25rem .75rem}.site-tagline{display:none}.site-title{font-size:1.1rem}',
};

const INDEX_LAYOUTS: Record<SiteConfig['indexLayout'], string> = {
  list: '.note-list{display:flex;flex-direction:column;gap:1.75rem}.note-item h2{font-size:1.4rem}',
  cards:
    '.note-list{display:flex;flex-direction:column;gap:1rem}.note-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1.4rem}.note-item h2{font-size:1.25rem}',
  grid:
    '.note-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem}.note-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem 1.2rem}.note-item h2{font-size:1.1rem}',
  compact:
    '.note-list{display:flex;flex-direction:column}.note-item{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem 1rem;padding:.65rem 0;border-bottom:1px solid var(--border)}.note-item h2{font-size:1.05rem;margin:0}.note-excerpt{display:none}',
};

export function buildSiteCss(config: SiteConfig): string {
  const body = SITE_FONT_STACKS[config.bodyFont];
  const heading = SITE_FONT_STACKS[config.headingFont];
  const css = [
    colorSchemeCss(config),
    `:root{--radius:${config.radius}px;--width:${config.contentWidth}px}`,
    `*{box-sizing:border-box}html{font-size:${(17 * config.fontScale).toFixed(2)}px;-webkit-text-size-adjust:100%}`,
    `body{margin:0;background:var(--background);color:var(--text);font-family:${body};line-height:${config.lineHeight}}`,
    `h1,h2,h3,h4,h5,h6,.site-title{font-family:${heading};line-height:1.25;margin:1.8em 0 .5em}`,
    'h1{font-size:2rem;margin-top:0}h2{font-size:1.5rem}h3{font-size:1.2rem}h4,h5,h6{font-size:1rem}',
    LINK_STYLES[config.linkStyle],
    '.wrap{max-width:var(--width);margin-inline:auto;padding-inline:1.25rem}',
    HEADER_STYLES[config.headerStyle],
    '.site-title{font-size:1.6rem;font-weight:700;margin:0;color:var(--text);text-decoration:none;background:none}',
    '.site-tagline{margin:.35rem 0 0;color:var(--muted)}',
    '.site-nav{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:.9rem;font-size:.92rem}',
    'main{padding-block:1.5rem 3rem}',
    INDEX_LAYOUTS[config.indexLayout],
    '.note-item h2{margin:0 0 .3rem}.note-item h2 a{color:var(--text);background:none;text-decoration:none}.note-item h2 a:hover{color:var(--link)}',
    '.note-excerpt{margin:.4rem 0 0;color:var(--muted)}',
    '.meta{color:var(--muted);font-size:.85rem;display:flex;flex-wrap:wrap;gap:.2rem .9rem}',
    '.tag{display:inline-block;padding:0 .55em;border:1px solid var(--border);border-radius:999px;font-size:.78rem;color:var(--muted)}',
    'article>header{margin-bottom:1.75rem}article>header h1{margin-bottom:.4rem}',
    'article img{max-width:100%;height:auto;border-radius:var(--radius)}figure{margin:1.5rem 0}figcaption{color:var(--muted);font-size:.85rem}',
    'blockquote{margin:1.25rem 0;padding:.1rem 1.1rem;border-left:4px solid var(--accent);color:var(--muted);background:var(--surface);border-radius:0 var(--radius) var(--radius) 0}',
    'code,pre{font-family:' + SITE_FONT_STACKS.mono + ';font-size:.88em}',
    'code{background:var(--code-background);padding:.12em .4em;border-radius:calc(var(--radius)/2)}',
    'pre{background:var(--code-background);padding:1rem 1.1rem;border-radius:var(--radius);overflow-x:auto;border:1px solid var(--border)}pre code{background:none;padding:0}',
    'table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border:1px solid var(--border);padding:.45rem .7rem;text-align:left}th{background:var(--surface)}',
    'hr{border:0;border-top:1px solid var(--border);margin:2rem 0}',
    'ul.checklist{list-style:none;padding-left:.2rem}li:has(>input[type=checkbox]){list-style:none}li>input[type=checkbox]{margin:0 .5em 0 -1.3em}ul.checklist>li>input[type=checkbox]{margin-left:0}',
    'dt{font-weight:600}dd{margin:0 0 .6rem 1.2rem}details{margin:1rem 0}summary{cursor:pointer;font-weight:600}',
    '.todo-state{font-size:.7em;font-weight:700;padding:.1em .5em;border-radius:var(--radius);background:var(--accent);color:var(--on-accent);margin-right:.4em;vertical-align:middle}',
    '.toc{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.8rem 1.2rem;margin:0 0 2rem;font-size:.92rem}.toc strong{display:block;margin-bottom:.3rem}.toc ol{margin:0;padding-left:1.2rem}.toc li.l3{margin-left:1rem}',
    '.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--border);font-size:.95rem}.pager span{color:var(--muted);display:block;font-size:.78rem}',
    '.unresolved{color:var(--muted);border-bottom:1px dotted var(--muted)}',
    'footer.site-footer{border-top:1px solid var(--border);padding-block:1.5rem 2.5rem;color:var(--muted);font-size:.88rem}',
    '@media (max-width:560px){html{font-size:' + (16 * config.fontScale).toFixed(2) + 'px}.pager{flex-direction:column}}',
  ];
  if (config.customCss.trim()) css.push(`/* custom */\n${config.customCss.replace(/<\/style/gi, '')}`);
  return css.join('\n');
}
