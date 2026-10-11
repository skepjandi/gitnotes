export type ThemeStyle = 'neumorphic' | 'flat' | 'neo-brutalist' | 'retrofuturistic' | 'terminal-mono' | 'crt-green' | 'developer-desk';

export interface Palette {
  bg: string;
  surface: string;
  highlight: string;
  shadow: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentMuted: string;
  error: string;
  success: string;
  warning: string;
  background: string;
  surfaceSecondary: string;
  primary: string;
  border: string;
  card: string;
  elevated: string;
}

// Neumorphic palette uses a near-pure white (light) / black (dark) surface
// with a slightly off-shade bg so the soft inner/outer shadows still read.
// Pure mono-tone (surface === bg) flattens the depth illusion.
export const NEUMORPHIC_LIGHT: Palette = {
  bg: '#F2F2F2',
  surface: '#FFFFFF',
  highlight: '#FFFFFF',
  shadow: '#BFBFBF',
  text: '#1C1C1E',
  textSecondary: '#6E6E73',
  accent: '#7B8CDE',
  accentMuted: '#A8B3E5',
  error: '#E07A7A',
  success: '#15803D',
  warning: '#B45309',
  background: '#F2F2F2',
  surfaceSecondary: '#F5F5F5',
  primary: '#7B8CDE',
  border: '#D8D8D8',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
};

export const NEUMORPHIC_DARK: Palette = {
  bg: '#0E0E0E',
  surface: '#000000',
  highlight: '#1F1F1F',
  shadow: '#000000',
  text: '#F2F2F7',
  // #A8A8AE: ~5.4:1 on the #0A0A0A card surface, clears WCAG AA (4.5:1).
  // Apple's #8E8E93 is borderline for body text in pure-black mode (#541).
  textSecondary: '#A8A8AE',
  accent: '#8B9BE8',
  accentMuted: '#5A6BB5',
  error: '#E07A7A',
  success: '#4ADE80',
  warning: '#FBBF24',
  background: '#0E0E0E',
  surfaceSecondary: '#141414',
  primary: '#8B9BE8',
  border: '#262626',
  card: '#0A0A0A',
  elevated: '#1C1C1E',
};

export const FLAT_LIGHT: Palette = {
  bg: '#f2f2f7',
  surface: '#ffffff',
  highlight: '#ffffff',
  shadow: '#000000',
  text: '#1c1c1e',
  textSecondary: '#6e6e73',
  accent: '#007AFF',
  accentMuted: '#5AC8FA',
  error: '#ff3b30',
  success: '#34C759',
  warning: '#FF9500',
  background: '#f2f2f7',
  surfaceSecondary: '#f2f2f7',
  primary: '#007AFF',
  border: '#c6c6c8',
  card: '#ffffff',
  elevated: '#ffffff',
};

export const FLAT_DARK: Palette = {
  bg: '#000000',
  surface: '#1c1c1e',
  highlight: '#1c1c1e',
  shadow: '#000000',
  text: '#f2f2f7',
  textSecondary: '#a8a8ae',
  accent: '#0a84ff',
  accentMuted: '#64d2ff',
  error: '#ff453a',
  success: '#30D158',
  warning: '#FF9F0A',
  background: '#000000',
  surfaceSecondary: '#2c2c2e',
  primary: '#0a84ff',
  border: '#38383a',
  card: '#2c2c2e',
  elevated: '#2c2c2e',
};

// Neo-Brutalist: bold flat colors, thick borders, high contrast, no gradients.
// Light: warm cream base with bold saturated accents.
// Dark: near-black base with vivid saturated neon accents.
export const NEUTRAL_BRUTALIST_LIGHT: Palette = {
  bg: '#F5F0E8',
  surface: '#FFFEF9',
  highlight: '#FFFEF9',
  shadow: '#000000',
  text: '#1A1A1A',
  textSecondary: '#5C5C5C',
  accent: '#FF5C00',
  accentMuted: '#FF8533',
  error: '#D93025',
  success: '#1E7D3A',
  warning: '#B45309',
  background: '#F5F0E8',
  surfaceSecondary: '#EAE5D9',
  primary: '#FF5C00',
  border: '#000000',
  card: '#FFFEF9',
  elevated: '#FFFEF9',
};

export const NEUTRAL_BRUTALIST_DARK: Palette = {
  bg: '#0D0D0D',
  surface: '#1A1A1A',
  highlight: '#2A2A2A',
  shadow: '#000000',
  text: '#F5F5F5',
  textSecondary: '#D8D8D8',
  accent: '#00E5FF',
  accentMuted: '#00C4CC',
  error: '#FF6B6B',
  success: '#4ADE80',
  warning: '#FBBF24',
  background: '#0D0D0D',
  surfaceSecondary: '#262626',
  primary: '#FF5C00',
  border: '#FFFFFF',
  card: '#1A1A1A',
  elevated: '#2A2A2A',
};

// Retrofuturistic: dark-mode primary with deep-space navy + neon glow accents.
// Dark: #0D0D1A bg, electric cyan #00E5FF glow, amber #FFD700, hot-pink #E91E63.
// Light: cream #FAFAF5 base, muted cyan/amber/pink for readability on light surfaces.
export const RETROFUTURISTIC_LIGHT: Palette = {
  bg: '#F5F5F0',
  surface: '#FAFAF5',
  highlight: '#FFFFFF',
  shadow: '#000000',
  text: '#1A1A2E',
  textSecondary: '#5C5C7A',
  accent: '#007B8A',
  accentMuted: '#0097A7',
  error: '#C41E3A',
  success: '#1E7D3A',
  warning: '#B45309',
  background: '#FAFAF5',
  surfaceSecondary: '#EFEFEA',
  primary: '#007B8A',
  border: '#BFBFBF',
  card: '#FAFAF5',
  elevated: '#FFFFFF',
};

export const RETROFUTURISTIC_DARK: Palette = {
  bg: '#0D0D1A',
  surface: '#12122A',
  highlight: '#1E1E3A',
  shadow: '#000000',
  text: '#E8E8F0',
  textSecondary: '#A0A0C0',
  accent: '#00E5FF',
  accentMuted: '#00C4CC',
  error: '#FF6B6B',
  success: '#4ADE80',
  warning: '#FFD700',
  background: '#0D0D1A',
  surfaceSecondary: '#1A1A35',
  primary: '#E91E63',
  border: '#2A2A50',
  card: '#12122A',
  elevated: '#1E1E3A',
};

// Referral reward palettes
// Terminal Mono — classic black terminal with amber phosphor accent.
// Meets WCAG AA contrast for text on background (amber on #0D0D0A: ~7.2:1).
export const TERMINAL_MONO_LIGHT: Palette = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  highlight: '#FFFFFF',
  shadow: '#BFBFBF',
  text: '#1A1A1A',
  textSecondary: '#6E6E73',
  accent: '#FF8C00', // Amber
  accentMuted: '#FFB347',
  error: '#FF3B30',
  success: '#34C759',
  warning: '#FF9500',
  background: '#F5F5F5',
  surfaceSecondary: '#EBEBEB',
  primary: '#FF8C00',
  border: '#D8D8D8',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
};

export const TERMINAL_MONO_DARK: Palette = {
  bg: '#0D0D0A',
  surface: '#1A1A17',
  highlight: '#262620',
  shadow: '#000000',
  text: '#F5F5F0',
  textSecondary: '#A8A89F',
  accent: '#FFB347', // Lighter amber for dark
  accentMuted: '#CC8800',
  error: '#FF6B6B',
  success: '#4ADE80',
  warning: '#FFD700',
  background: '#0D0D0A',
  surfaceSecondary: '#141410',
  primary: '#FFB347',
  border: '#333330',
  card: '#1A1A17',
  elevated: '#262620',
};

// CRT Green — green phosphor CRT monitor aesthetic.
export const CRT_GREEN_LIGHT: Palette = {
  bg: '#F0F5F0',
  surface: '#FFFFFF',
  highlight: '#FFFFFF',
  shadow: '#BFBFBF',
  text: '#1A2E1A',
  textSecondary: '#5C7A5C',
  accent: '#22C55E', // Green phosphor
  accentMuted: '#4ADE80',
  error: '#DC2626',
  success: '#16A34A',
  warning: '#CA8A04',
  background: '#F0F5F0',
  surfaceSecondary: '#E5EBE5',
  primary: '#22C55E',
  border: '#C6D6C6',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
};

export const CRT_GREEN_DARK: Palette = {
  bg: '#0A0E0A',
  surface: '#141E14',
  highlight: '#1E2A1E',
  shadow: '#000000',
  text: '#D4E8D4',
  textSecondary: '#8FBC8F',
  accent: '#4ADE80', // Bright phosphor green
  accentMuted: '#22C55E',
  error: '#EF4444',
  success: '#4ADE80',
  warning: '#FACC15',
  background: '#0A0E0A',
  surfaceSecondary: '#1A281A',
  primary: '#4ADE80',
  border: '#2E3E2E',
  card: '#141E14',
  elevated: '#1E2A1E',
};

// Developer Desk — IDE/editor inspired with syntax-highlighting accents.
export const DEVELOPER_DESK_LIGHT: Palette = {
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  highlight: '#FFFFFF',
  shadow: '#BFBFBF',
  text: '#24292E',
  textSecondary: '#6E7C8A',
  accent: '#0A84FF', // VS Code blue
  accentMuted: '#64D2FF',
  error: '#D32F2F',
  success: '#28A745',
  warning: '#F9A825',
  background: '#FAFAFA',
  surfaceSecondary: '#F0F0F0',
  primary: '#0A84FF',
  border: '#D0D7DE',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
};

export const DEVELOPER_DESK_DARK: Palette = {
  bg: '#1E1E1E', // VS Code dark background
  surface: '#252526',
  highlight: '#2D2D30',
  shadow: '#000000',
  text: '#D4D4D4',
  textSecondary: '#858585',
  accent: '#569CD6', // VS Code syntax blue
  accentMuted: '#4FC1FF',
  error: '#F14C4C',
  success: '#4EC9B0', // VS Code teal
  warning: '#DCDCAA', // VS Code yellow
  background: '#1E1E1E',
  surfaceSecondary: '#333333',
  primary: '#569CD6',
  border: '#3C3C3C',
  card: '#252526',
  elevated: '#2D2D30',
};

// Note color-coding palette. Keys must match `NoteColor` in models/Note.
// These render as the card border accent in `NoteCard` and as swatches in
// `ColorPicker`. They are intentionally theme-agnostic — same hex in both
// light and dark modes — because the user picks them as labels, not as
// theme-aware backgrounds.
export const NOTE_COLORS = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  gray: '#6b7280',
} as const;
export type NoteColorToken = keyof typeof NOTE_COLORS;

export const RADII = { sm: 12, md: 18, lg: 24, pill: 999 } as const;
export type Radius = keyof typeof RADII;

export const SPACING = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export type SpacingKey = keyof typeof SPACING;

export const TYPE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28 } as const;
export type TypeSize = keyof typeof TYPE;

// Line heights paired with TYPE sizes — 1.4–1.5× for body, tighter for headings.
// Ratios derived from iOS HIG type scaling (SF Pro equivalent).
export const LINE_HEIGHT: Record<TypeSize, number> = {
  xs: 18,   // 1.5× — captions, timestamps
  sm: 21,   // 1.5× — secondary text, labels
  md: 24,   // 1.5× — body copy
  lg: 25,   // ~1.38× — subheadings, card titles
  xl: 30,   // ~1.36× — section headings
  '2xl': 36, // ~1.29× — display text
} as const;
export type LineHeight = (typeof LINE_HEIGHT)[TypeSize];

// Semantic text roles — each role specifies a canonical size and line-height.
// Components should use these roles rather than raw TYPE[size] lookups.
export type TextRole = 'display' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';
export const TEXT_ROLE_SIZE: Record<TextRole, TypeSize> = {
  display: '2xl',
  heading: 'xl',
  subheading: 'lg',
  body: 'md',
  label: 'sm',
  caption: 'xs',
} as const;
export const TEXT_ROLE_LINE_HEIGHT: Record<TextRole, LineHeight> = {
  display: LINE_HEIGHT['2xl'],
  heading: LINE_HEIGHT.xl,
  subheading: LINE_HEIGHT.lg,
  body: LINE_HEIGHT.md,
  label: LINE_HEIGHT.sm,
  caption: LINE_HEIGHT.xs,
} as const;

// Preserves hue, reduces saturation by 18pp, shifts lightness +20pp (light) or -22pp (dark).
export function deriveAccentMuted(accent: string, isDark: boolean): string {
  const hex = accent.replace('#', '');
  if (hex.length !== 6) return accent;
  const rRaw = parseInt(hex.slice(0, 2), 16);
  const gRaw = parseInt(hex.slice(2, 4), 16);
  const bRaw = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(rRaw) || Number.isNaN(gRaw) || Number.isNaN(bRaw)) return accent;

  // Work in 0-1 range for HSL math
  const r = rRaw / 255;
  const g = gRaw / 255;
  const b = bRaw / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  const sMuted = Math.max(0, Math.min(1, s - 0.18));
  const lightnessShift = isDark ? -0.22 : 0.20;
  const lMuted = Math.max(0, Math.min(1, l + lightnessShift));

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let rM: number, gM: number, bM: number;
  if (sMuted === 0) {
    rM = gM = bM = lMuted;
  } else {
    const q = lMuted < 0.5 ? lMuted * (1 + sMuted) : lMuted + sMuted - lMuted * sMuted;
    const p = 2 * lMuted - q;
    rM = hue2rgb(p, q, h + 1 / 3);
    gM = hue2rgb(p, q, h);
    bM = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rM)}${toHex(gM)}${toHex(bM)}`;
}

export function resolveColors(style: ThemeStyle, isDark: boolean): Palette {
  if (style === 'flat') return isDark ? FLAT_DARK : FLAT_LIGHT;
  if (style === 'neumorphic') return isDark ? NEUMORPHIC_DARK : NEUMORPHIC_LIGHT;
  if (style === 'neo-brutalist') return isDark ? NEUTRAL_BRUTALIST_DARK : NEUTRAL_BRUTALIST_LIGHT;
  if (style === 'retrofuturistic') return isDark ? RETROFUTURISTIC_DARK : RETROFUTURISTIC_LIGHT;
  if (style === 'terminal-mono') return isDark ? TERMINAL_MONO_DARK : TERMINAL_MONO_LIGHT;
  if (style === 'crt-green') return isDark ? CRT_GREEN_DARK : CRT_GREEN_LIGHT;
  if (style === 'developer-desk') return isDark ? DEVELOPER_DESK_DARK : DEVELOPER_DESK_LIGHT;
  return isDark ? FLAT_DARK : FLAT_LIGHT;
}
