import {
  SITE_CONFIG_VERSION,
  SiteConfig,
  SiteDesign,
  SiteFontKey,
  SitePalette,
  SitePresetId,
  normalizeHex,
} from './siteTypes';

export const SITE_FONT_STACKS: Record<SiteFontKey, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Segoe UI", system-ui, sans-serif',
  humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif',
  editorial: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
};

const DESIGN_DEFAULTS = {
  fontScale: 1,
  lineHeight: 1.7,
  contentWidth: 720,
  showDates: true,
  showTags: true,
  showReadingTime: true,
  showToc: false,
  showPrevNext: true,
} as const;

function palette(
  background: string,
  surface: string,
  text: string,
  muted: string,
  border: string,
  accent: string,
  codeBackground: string,
): SitePalette {
  return { background, surface, text, muted, border, accent, link: accent, codeBackground };
}

export const SITE_PRESETS: Record<SitePresetId, SiteDesign> = {
  paper: {
    ...DESIGN_DEFAULTS,
    colorMode: 'auto',
    colors: {
      light: palette('#fbfaf7', '#ffffff', '#2b2a27', '#79756c', '#e7e3d9', '#a8431f', '#f1eee6'),
      dark: palette('#1c1b19', '#262421', '#ebe8df', '#9b978b', '#3a3732', '#e08a5f', '#2d2b27'),
    },
    bodyFont: 'editorial',
    headingFont: 'editorial',
    lineHeight: 1.75,
    radius: 6,
    headerStyle: 'centered',
    indexLayout: 'list',
    linkStyle: 'underline',
  },
  docs: {
    ...DESIGN_DEFAULTS,
    colorMode: 'auto',
    colors: {
      light: palette('#ffffff', '#f6f8fa', '#1f2328', '#656d76', '#d8dee4', '#0969da', '#f0f3f6'),
      dark: palette('#0d1117', '#161b22', '#e6edf3', '#8d96a0', '#30363d', '#58a6ff', '#1c2128'),
    },
    bodyFont: 'system',
    headingFont: 'system',
    contentWidth: 840,
    lineHeight: 1.6,
    radius: 8,
    headerStyle: 'left',
    indexLayout: 'compact',
    linkStyle: 'hover',
    showToc: true,
  },
  journal: {
    ...DESIGN_DEFAULTS,
    colorMode: 'auto',
    colors: {
      light: palette('#fff8f0', '#ffffff', '#3b2f2f', '#8c7b70', '#f0dfcf', '#d9480f', '#faeee0'),
      dark: palette('#221b17', '#2c241f', '#f3e8dc', '#b09c8d', '#42362e', '#ff9a5c', '#33291f'),
    },
    bodyFont: 'humanist',
    headingFont: 'rounded',
    radius: 18,
    headerStyle: 'banner',
    indexLayout: 'cards',
    linkStyle: 'highlight',
  },
  midnight: {
    ...DESIGN_DEFAULTS,
    colorMode: 'dark',
    colors: {
      light: palette('#f4f5fb', '#ffffff', '#1b1e33', '#666b8a', '#dcdff0', '#5b5bd6', '#eaecf8'),
      dark: palette('#0b0d1a', '#14172b', '#e8eaff', '#8f94b8', '#252a4a', '#8b8bff', '#1a1e38'),
    },
    bodyFont: 'system',
    headingFont: 'rounded',
    radius: 14,
    headerStyle: 'left',
    indexLayout: 'grid',
    linkStyle: 'hover',
  },
  terminal: {
    ...DESIGN_DEFAULTS,
    colorMode: 'dark',
    colors: {
      light: palette('#f2f7f2', '#ffffff', '#12261a', '#4f6b58', '#cfe0d2', '#157a3c', '#e4efe6'),
      dark: palette('#050805', '#0b120c', '#b8f5c4', '#5fa070', '#17301d', '#39ff7a', '#0f1a11'),
    },
    bodyFont: 'mono',
    headingFont: 'mono',
    fontScale: 0.94,
    lineHeight: 1.65,
    radius: 0,
    headerStyle: 'minimal',
    indexLayout: 'compact',
    linkStyle: 'underline',
  },
  brutalist: {
    ...DESIGN_DEFAULTS,
    colorMode: 'light',
    colors: {
      light: palette('#ffe9a8', '#ffffff', '#000000', '#3d3d3d', '#000000', '#d4200f', '#fff3cf'),
      dark: palette('#111111', '#1c1c1c', '#fff6dc', '#c9c2a8', '#fff6dc', '#ff6a5c', '#262626'),
    },
    bodyFont: 'system',
    headingFont: 'system',
    lineHeight: 1.6,
    radius: 0,
    headerStyle: 'banner',
    indexLayout: 'grid',
    linkStyle: 'highlight',
  },
};

export const DEFAULT_SITE_PRESET: SitePresetId = 'paper';

export function createDefaultSiteConfig(): SiteConfig {
  return {
    version: SITE_CONFIG_VERSION,
    presetId: DEFAULT_SITE_PRESET,
    ...SITE_PRESETS[DEFAULT_SITE_PRESET],
    title: 'My Notes',
    tagline: '',
    author: '',
    footer: '',
    language: 'en',
    baseUrl: '',
    faviconEmoji: '📝',
    navLinks: [],
    customCss: '',
  };
}

/** Replaces every design field with the preset's; identity/content fields are kept. */
export function applySitePreset(config: SiteConfig, presetId: SitePresetId): SiteConfig {
  const preset = SITE_PRESETS[presetId];
  return { ...config, ...preset, colors: { light: { ...preset.colors.light }, dark: { ...preset.colors.dark } }, presetId };
}

/** Sets one accent for both modes; the link color follows it. */
export function applySiteAccent(config: SiteConfig, accent: string): SiteConfig {
  const hex = normalizeHex(accent, config.colors.light.accent);
  return {
    ...config,
    colors: {
      light: { ...config.colors.light, accent: hex, link: hex },
      dark: { ...config.colors.dark, accent: hex, link: hex },
    },
  };
}

/** Black or white, whichever is more readable on top of `hex`. */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  const value = normalizeHex(hex, '#000000').slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(value.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
