export const SITE_CONFIG_VERSION = 1;

export const SITE_FONT_KEYS = ['system', 'serif', 'mono', 'rounded', 'humanist', 'editorial'] as const;
export type SiteFontKey = (typeof SITE_FONT_KEYS)[number];

export const SITE_COLOR_MODES = ['auto', 'light', 'dark'] as const;
export type SiteColorMode = (typeof SITE_COLOR_MODES)[number];

export const SITE_HEADER_STYLES = ['left', 'centered', 'banner', 'minimal'] as const;
export type SiteHeaderStyle = (typeof SITE_HEADER_STYLES)[number];

export const SITE_INDEX_LAYOUTS = ['list', 'cards', 'grid', 'compact'] as const;
export type SiteIndexLayout = (typeof SITE_INDEX_LAYOUTS)[number];

export const SITE_LINK_STYLES = ['underline', 'hover', 'highlight'] as const;
export type SiteLinkStyle = (typeof SITE_LINK_STYLES)[number];

export const SITE_PRESET_IDS = ['paper', 'docs', 'journal', 'midnight', 'terminal', 'brutalist'] as const;
export type SitePresetId = (typeof SITE_PRESET_IDS)[number];

export const PALETTE_KEYS = [
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'accent',
  'link',
  'codeBackground',
] as const;
export type SitePaletteKey = (typeof PALETTE_KEYS)[number];
export type SitePalette = Record<SitePaletteKey, string>;

export interface SiteNavLink {
  label: string;
  url: string;
}

export const MAX_NAV_LINKS = 6;
export const CUSTOM_CSS_MAX_LENGTH = 20000;

/** Visual design: everything a preset sets and the theme editor customizes. */
export interface SiteDesign {
  colorMode: SiteColorMode;
  colors: { light: SitePalette; dark: SitePalette };
  bodyFont: SiteFontKey;
  headingFont: SiteFontKey;
  /** Multiplier on the 17px base size. */
  fontScale: number;
  lineHeight: number;
  /** Max article width in px. */
  contentWidth: number;
  /** Corner radius in px. */
  radius: number;
  headerStyle: SiteHeaderStyle;
  indexLayout: SiteIndexLayout;
  linkStyle: SiteLinkStyle;
  showDates: boolean;
  showTags: boolean;
  showReadingTime: boolean;
  showToc: boolean;
  showPrevNext: boolean;
}

/** Site identity and content settings, independent of the visual design. */
export interface SiteIdentity {
  title: string;
  tagline: string;
  author: string;
  footer: string;
  language: string;
  /** Optional public https URL; enables canonical links, sitemap.xml and robots.txt. */
  baseUrl: string;
  faviconEmoji: string;
  navLinks: SiteNavLink[];
  customCss: string;
}

export interface SiteConfig extends SiteDesign, SiteIdentity {
  version: typeof SITE_CONFIG_VERSION;
  presetId: SitePresetId;
}

export type SiteFileContent = { kind: 'text'; text: string } | { kind: 'base64'; base64: string };

export interface SiteFile {
  path: string;
  content: SiteFileContent;
}

export interface SitePage {
  noteId: string;
  slug: string;
  path: string;
  title: string;
}

export interface SiteWarning {
  noteId?: string;
  noteTitle?: string;
  code: 'unsupported-format' | 'image-unresolved' | 'empty-note' | 'link-unselected';
  detail?: string;
}

export interface SiteArtifact {
  files: SiteFile[];
  pages: SitePage[];
  warnings: SiteWarning[];
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (HEX6.test(trimmed)) return trimmed.toLowerCase();
  if (HEX3.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function text(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isSafeNavUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}

function normalizePalette(value: unknown, fallback: SitePalette): SitePalette {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<SitePaletteKey, unknown>>;
  const out = {} as SitePalette;
  for (const key of PALETTE_KEYS) out[key] = normalizeHex(source[key], fallback[key]);
  return out;
}

function normalizeNavLinks(value: unknown): SiteNavLink[] {
  if (!Array.isArray(value)) return [];
  const links: SiteNavLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const label = text((item as SiteNavLink).label, 40, '').trim();
    const url = text((item as SiteNavLink).url, 500, '').trim();
    if (label && isSafeNavUrl(url)) links.push({ label, url });
    if (links.length === MAX_NAV_LINKS) break;
  }
  return links;
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+(\/[^\s?#]*)?$/i.test(trimmed) ? trimmed : '';
}

/**
 * Coerces untrusted/persisted input into a valid config. Every value that
 * reaches generated CSS or HTML passes through here (hex validation, enum
 * membership, numeric clamps), so downstream emitters can trust the shape.
 */
export function normalizeSiteConfig(raw: unknown, fallback: SiteConfig): SiteConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const colors = (source.colors && typeof source.colors === 'object' ? source.colors : {}) as Record<string, unknown>;

  return {
    version: SITE_CONFIG_VERSION,
    presetId: oneOf(source.presetId, SITE_PRESET_IDS, fallback.presetId),
    colorMode: oneOf(source.colorMode, SITE_COLOR_MODES, fallback.colorMode),
    colors: {
      light: normalizePalette(colors.light, fallback.colors.light),
      dark: normalizePalette(colors.dark, fallback.colors.dark),
    },
    bodyFont: oneOf(source.bodyFont, SITE_FONT_KEYS, fallback.bodyFont),
    headingFont: oneOf(source.headingFont, SITE_FONT_KEYS, fallback.headingFont),
    fontScale: clampNumber(source.fontScale, 0.85, 1.4, fallback.fontScale),
    lineHeight: clampNumber(source.lineHeight, 1.3, 2.1, fallback.lineHeight),
    contentWidth: Math.round(clampNumber(source.contentWidth, 480, 1100, fallback.contentWidth)),
    radius: Math.round(clampNumber(source.radius, 0, 28, fallback.radius)),
    headerStyle: oneOf(source.headerStyle, SITE_HEADER_STYLES, fallback.headerStyle),
    indexLayout: oneOf(source.indexLayout, SITE_INDEX_LAYOUTS, fallback.indexLayout),
    linkStyle: oneOf(source.linkStyle, SITE_LINK_STYLES, fallback.linkStyle),
    showDates: bool(source.showDates, fallback.showDates),
    showTags: bool(source.showTags, fallback.showTags),
    showReadingTime: bool(source.showReadingTime, fallback.showReadingTime),
    showToc: bool(source.showToc, fallback.showToc),
    showPrevNext: bool(source.showPrevNext, fallback.showPrevNext),
    title: text(source.title, 80, fallback.title),
    tagline: text(source.tagline, 160, fallback.tagline),
    author: text(source.author, 80, fallback.author),
    footer: text(source.footer, 240, fallback.footer),
    language: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(source.language))
      ? String(source.language)
      : fallback.language,
    baseUrl: 'baseUrl' in source ? normalizeBaseUrl(source.baseUrl) : fallback.baseUrl,
    faviconEmoji: text(source.faviconEmoji, 8, fallback.faviconEmoji),
    navLinks: 'navLinks' in source ? normalizeNavLinks(source.navLinks) : fallback.navLinks,
    customCss: text(source.customCss, CUSTOM_CSS_MAX_LENGTH, fallback.customCss),
  };
}
