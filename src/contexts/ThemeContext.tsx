import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBootValue } from '../services/StorageBootstrap';
import {
  Palette,
  ThemeStyle,
  resolveColors,
  deriveAccentMuted,
  RADII,
  SPACING,
  TYPE,
} from '../theme/tokens';

type ThemeMode = 'light' | 'dark' | 'system';

export interface Tokens {
  colors: Palette;
  radii: typeof RADII;
  spacing: typeof SPACING;
  type: typeof TYPE;
}

interface ThemeContextType {
  theme: ThemeMode;
  isDark: boolean;
  style: ThemeStyle;
  setTheme: (theme: ThemeMode) => void;
  setStyle: (style: ThemeStyle) => void;
  accentColor: string | null;
  setAccentColor: (color: string | null) => void;
  colors: Palette;
  tokens: Tokens;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@gitnotes:theme';
const STYLE_STORAGE_KEY = '@gitnotes:style';
const ACCENT_STORAGE_KEY = '@gitnotes:accent';

interface ThemeProviderProps {
  children: ReactNode;
}

const STRICT_HEX = /^#[0-9A-Fa-f]{6}$/;

function isValidHex(hex: string): boolean {
  return STRICT_HEX.test(hex);
}

function readBootTheme(): ThemeMode {
  const v = getBootValue('@gitnotes:theme');
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

function readBootStyle(): ThemeStyle {
  const v = getBootValue('@gitnotes:style');
  if (v === 'neumorphic' || v === 'flat' || v === 'neo-brutalist' || v === 'retrofuturistic' || v === 'terminal-mono' || v === 'crt-green' || v === 'developer-desk') return v;
  return 'flat';
}

function readBootAccent(): string | null {
  const v = getBootValue('@gitnotes:accent');
  if (typeof v === 'string' && isValidHex(v)) return v.toLowerCase();
  return null;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(readBootTheme);
  const [style, setStyleState] = useState<ThemeStyle>(readBootStyle);
  const [accentColor, setAccentColorState] = useState<string | null>(readBootAccent);
  const systemColorScheme = useColorScheme();

  const loadPersisted = useCallback(async () => {
    try {
      if (getBootValue('@gitnotes:theme') === undefined) {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
          setThemeState(savedTheme);
        }
      }
      if (getBootValue('@gitnotes:style') === undefined) {
        const savedStyle = await AsyncStorage.getItem(STYLE_STORAGE_KEY);
        if (savedStyle === 'neumorphic' || savedStyle === 'flat' || savedStyle === 'neo-brutalist' || savedStyle === 'retrofuturistic' || savedStyle === 'terminal-mono' || savedStyle === 'crt-green' || savedStyle === 'developer-desk') {
          setStyleState(savedStyle);
        }
      }
      if (getBootValue('@gitnotes:accent') === undefined) {
        const savedAccent = await AsyncStorage.getItem(ACCENT_STORAGE_KEY);
        if (typeof savedAccent === 'string' && isValidHex(savedAccent)) {
          setAccentColorState(savedAccent.toLowerCase());
        }
      }
    } catch (error) {
      console.error('Error loading theme preferences:', error);
    }
  }, []);

  useEffect(() => {
    loadPersisted();
  }, [loadPersisted]);

  const isDark = useMemo(() => {
    if (theme === 'system') {
      return systemColorScheme === 'dark';
    }
    return theme === 'dark';
  }, [theme, systemColorScheme]);

  const setTheme = useCallback(async (newTheme: ThemeMode) => {
    try {
      setThemeState(newTheme);
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  }, []);

  const setStyle = useCallback(async (newStyle: ThemeStyle) => {
    try {
      setStyleState(newStyle);
      await AsyncStorage.setItem(STYLE_STORAGE_KEY, newStyle);
    } catch (error) {
      console.error('Error saving style:', error);
    }
  }, []);

  const setAccentColor = useCallback(async (color: string | null) => {
    if (color !== null && !isValidHex(color)) return;
    const normalized = color?.toLowerCase() ?? null;
    try {
      setAccentColorState(normalized);
      if (normalized === null) {
        await AsyncStorage.removeItem(ACCENT_STORAGE_KEY);
      } else {
        await AsyncStorage.setItem(ACCENT_STORAGE_KEY, normalized);
      }
    } catch (error) {
      console.error('Error saving accent color:', error);
    }
  }, []);

  const baseColors = useMemo(() => resolveColors(style, isDark), [style, isDark]);

  const colors = useMemo<Palette>(() => {
    if (accentColor === null) return baseColors;
    return {
      ...baseColors,
      accent: accentColor,
      primary: accentColor,
      accentMuted: deriveAccentMuted(accentColor, isDark),
    };
  }, [baseColors, accentColor, isDark]);

  const tokens: Tokens = useMemo(
    () => ({ colors, radii: RADII, spacing: SPACING, type: TYPE }),
    [colors],
  );

  const value: ThemeContextType = useMemo(
    () => ({ theme, isDark, style, setTheme, setStyle, accentColor, setAccentColor, colors, tokens }),
    [theme, isDark, style, setTheme, setStyle, accentColor, setAccentColor, colors, tokens],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const SAFE_DEFAULT_TOKENS: Tokens = {
  colors: {
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
  },
  radii: { sm: 12, md: 18, lg: 24, pill: 999 },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
  type: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28 },
};

export const SAFE_DEFAULT_THEME: ThemeContextType = {
  theme: 'system',
  isDark: false,
  style: 'flat',
  setTheme: (() => { /* noop */ }) as () => void,
  setStyle: (() => { /* noop */ }) as () => void,
  accentColor: null,
  setAccentColor: (() => { /* noop */ }) as (color: string | null) => void,
  colors: SAFE_DEFAULT_TOKENS.colors,
  tokens: SAFE_DEFAULT_TOKENS,
};

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) return SAFE_DEFAULT_THEME;
  return context;
}

export function useTokens(): Tokens {
  const context = useContext(ThemeContext);
  if (context === undefined) return SAFE_DEFAULT_TOKENS;
  return context.tokens;
}

export { ThemeContext };
