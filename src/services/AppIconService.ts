/**
 * AppIconService — typed runtime adapter for alternate app icons.
 *
 * Storage key: `@gitnotes:app_icon`
 * Schema: plain string value — one of the logical AppIconName values, or absent for default.
 *
 * Architecture:
 *  - Logical names (`AppIconName`) are what the UI sees: 'Neon', 'Grayscale', etc.
 *  - Native names are the PascalCase paired variants registered in app.json:
 *    'NeonLight'/'NeonDark', 'GrayscaleLight'/'GrayscaleDark', etc.
 *  - `set(name)` auto-resolves the correct native variant via `Appearance.getColorScheme()`
 *  - `setForTheme(name, isDark)` applies the explicit native variant
 *  - ThemeContext sync keeps the active icon in sync on initial mount and isDark changes
 *
 * Does NOT depend on Git/repository state. Safe on web/unsupported platforms
 * (returns unavailable result; never calls native APIs).
 */

import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  supportsAlternateIcons,
  getAppIconName,
  setAlternateAppIcon,
  resetAppIcon,
} from 'expo-alternate-app-icons';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Valid alternate icon names exposed to the UI. `null` represents the default (reset) icon. */
export type AppIconName = 'Neon' | 'Grayscale' | 'Gold' | 'TerminalMono' | 'AmberTerminal' | 'MonochromeGrid' | null;

/** Result shape returned by mutate operations (set / reset). */
export interface AppIconResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** The resulting icon name after the operation (absent on failure). */
  current?: AppIconName | null;
  /** Error message string when `success === false` and `unavailable !== true`. */
  error?: string;
  /** True when the platform does not support alternate icons. */
  unavailable?: boolean;
  /** The previously stored icon name before the failed operation. */
  previous?: AppIconName | null;
  /** True when the current icon is the default (null). */
  isDefault?: boolean;
  /** True when the platform supports alternate icons. */
  isSupported?: boolean;
}

/** Hydration result — current icon plus platform/support metadata. */
export interface AppIconHydration extends AppIconResult {
  current: AppIconName | null;
  isSupported: boolean;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dedicated AsyncStorage key for the app icon preference. */
export const APP_ICON_STORAGE_KEY = '@gitnotes:app_icon';

/** Logical icon names — the canonical set the UI works with. */
export const LOGICAL_ICON_NAMES: ReadonlySet<string> = new Set([
  'Neon',
  'Grayscale',
  'Gold',
  'TerminalMono',
  'AmberTerminal',
  'MonochromeGrid',
]);

/**
 * Maps each logical icon name to its light/dark native variant names.
 * iOS uses `setAlternateAppIcon('NeonLight')` or `setAlternateAppIcon('NeonDark')`.
 * Android uses the same logical-to-native mapping for the native call.
 */
export const NATIVE_VARIANT_MAP: Record<string, { light: string; dark: string }> = {
  Neon: { light: 'NeonLight', dark: 'NeonDark' },
  Grayscale: { light: 'GrayscaleLight', dark: 'GrayscaleDark' },
  Gold: { light: 'GoldLight', dark: 'GoldDark' },
  TerminalMono: { light: 'TerminalMonoLight', dark: 'TerminalMonoDark' },
  AmberTerminal: { light: 'AmberTerminalLight', dark: 'AmberTerminalDark' },
  MonochromeGrid: { light: 'MonochromeGridLight', dark: 'MonochromeGridDark' },
};

function isAppIconSwitchingSupported(): boolean {
  return supportsAlternateIcons && !(Platform.OS === 'android' && __DEV__);
}

// ---------------------------------------------------------------------------
// Normalization: native name → logical name
// ---------------------------------------------------------------------------

/**
 * Converts a native variant name (e.g. 'NeonDark') back to its logical name ('Neon').
 * Returns `null` for unrecognized native names.
 */
function normalizeNativeName(nativeName: string | null): AppIconName {
  if (!nativeName) return null;
  for (const [logical, variants] of Object.entries(NATIVE_VARIANT_MAP)) {
    if (variants.light === nativeName || variants.dark === nativeName) {
      return logical as AppIconName;
    }
  }
  // Fallback: check if it's already a valid logical name
  if (LOGICAL_ICON_NAMES.has(nativeName)) {
    return nativeName as AppIconName;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Platform support check
// ---------------------------------------------------------------------------

/** Returns `true` when the current platform supports alternate app icons. */
export async function isSupported(): Promise<boolean> {
  return isAppIconSwitchingSupported();
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Reads stored preference and cross-checks with native state.
 *
 * Priority: stored-valid > native-current > null (default)
 * Stored values are always normalized (native names → logical names).
 *
 * @returns AppIconHydration with current icon and support metadata
 */
export async function hydrate(): Promise<AppIconHydration> {
  const supported = isAppIconSwitchingSupported();

  if (!supported) {
    return {
      success: true,
      current: null,
      isSupported: false,
      isDefault: true,
    };
  }

  // 1. Read stored value
  const stored = await AsyncStorage.getItem(APP_ICON_STORAGE_KEY);

  // 2. Validate and normalize stored value
  const storedLogical = stored !== null && LOGICAL_ICON_NAMES.has(stored) ? (stored as AppIconName) : normalizeNativeName(stored);
  if (storedLogical !== null) {
    return {
      success: true,
      current: storedLogical,
      isSupported: supported,
      isDefault: false,
    };
  }

  // 3. Stored is absent or invalid — consult native state
  if (supported) {
    const native = getAppIconName();
    const normalized = normalizeNativeName(native);
    return {
      success: true,
      current: normalized,
      isSupported: true,
      isDefault: normalized === null,
    };
  }

  // 4. Unsupported platform
  return {
    success: true,
    current: null,
    isSupported: false,
    isDefault: true,
  };
}

// ---------------------------------------------------------------------------
// Current selection (storage only — authoritative for user intent)
// ---------------------------------------------------------------------------

/**
 * Returns the stored icon preference (normalized to logical name).
 * Returns `null` when no preference is set or the stored value is invalid.
 */
export async function current(): Promise<AppIconName | null> {
  const stored = await AsyncStorage.getItem(APP_ICON_STORAGE_KEY);
  return stored !== null && LOGICAL_ICON_NAMES.has(stored) ? (stored as AppIconName) : normalizeNativeName(stored);
}

// ---------------------------------------------------------------------------
// Mutate operations
// ---------------------------------------------------------------------------

/**
 * Sets the alternate app icon, auto-resolving the correct native variant
 * from the current system color scheme.
 *
 * Calls `setForTheme(name, Appearance.getColorScheme() === 'dark')` internally.
 *
 * @param name - The logical icon name, or `null` to reset to the default icon.
 * @returns AppIconResult indicating success or failure.
 */
export async function set(name: AppIconName): Promise<AppIconResult> {
  const isDark = Appearance.getColorScheme() === 'dark';
  return setForTheme(name, isDark);
}

/**
 * Sets the alternate app icon to a specific native variant.
 *
 * @param name - The logical icon name, or `null` to reset to the default icon.
 * @param isDark - Whether to select the dark variant.
 * @returns AppIconResult indicating success or failure.
 */
export async function setForTheme(name: AppIconName, isDark: boolean): Promise<AppIconResult> {
  if (!isAppIconSwitchingSupported()) {
    return { success: false, unavailable: true };
  }

  const previous = await current();

  try {
    // Resolve native name: null → null (reset), logical → paired variant
    const nativeName = name === null ? null : resolveNative(name, isDark);
    if (name !== null && getAppIconName() === nativeName) {
      return {
        success: true,
        current: name,
        isDefault: name === null,
      };
    }
    const result = await setAlternateAppIcon(nativeName);

    // Persist logical name to storage after native success
    if (name === null) {
      await AsyncStorage.removeItem(APP_ICON_STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(APP_ICON_STORAGE_KEY, name);
    }

    const normalized = normalizeNativeName(result ?? null);
    return {
      success: true,
      current: normalized,
      isDefault: normalized === null,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error,
      previous,
      unavailable: false,
    };
  }
}

/**
 * Syncs the active icon to the current system color scheme.
 * Reads the stored logical name and applies the correct native variant.
 *
 * Call this on ThemeContext `isDark` changes and on initial mount
 * after the theme is known.
 *
 * @returns AppIconResult for the requested theme variant.
 */
export async function syncToTheme(isDark: boolean): Promise<AppIconResult> {
  const stored = await current();
  if (stored === null) return { success: true, current: null, isDefault: true };
  return setForTheme(stored, isDark);
}

export async function syncToCurrentTheme(): Promise<AppIconResult> {
  return syncToTheme(Appearance.getColorScheme() === 'dark');
}

/**
 * Resets the app icon to the default.
 * Clears storage and calls native reset.
 */
export async function reset(): Promise<AppIconResult> {
  if (!isAppIconSwitchingSupported()) {
    return { success: false, unavailable: true };
  }

  const previous = await current();

  try {
    await resetAppIcon();
    await AsyncStorage.removeItem(APP_ICON_STORAGE_KEY);
    return {
      success: true,
      current: null,
      isDefault: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error,
      previous,
      unavailable: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolves a logical name + isDark flag to the native variant name. */
function resolveNative(name: Exclude<AppIconName, null>, isDark: boolean): string {
  const variants = NATIVE_VARIANT_MAP[name];
  return isDark ? variants.dark : variants.light;
}

// ---------------------------------------------------------------------------
// Named export group (React context / DI convenience)
// ---------------------------------------------------------------------------

export const AppIconService = {
  isSupported,
  hydrate,
  current,
  set,
  setForTheme,
  syncToTheme,
  syncToCurrentTheme,
  reset,
};
