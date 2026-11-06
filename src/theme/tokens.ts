export type ThemeStyle = 'neumorphic' | 'flat';

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

// Text/icon color for content sitting on a filled accent/primary/error
// background. Theme-agnostic on purpose: every palette's filled colors are
// mid-tone, so white keeps contrast in light and dark.
export const ON_FILLED = '#FFFFFF';

export const RADII = { sm: 12, md: 18, lg: 24, pill: 999 } as const;
export type Radius = keyof typeof RADII;

export const SPACING = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export type SpacingKey = keyof typeof SPACING;

export const TYPE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28 } as const;
export type TypeSize = keyof typeof TYPE;

export function resolveColors(style: ThemeStyle, isDark: boolean): Palette {
  if (style === 'flat') return isDark ? FLAT_DARK : FLAT_LIGHT;
  return isDark ? NEUMORPHIC_DARK : NEUMORPHIC_LIGHT;
}
