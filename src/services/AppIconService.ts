/**
 * AppIconService — typed runtime adapter for alternate app icons.
 *
 * Storage key: `@gitnotes:app_icon`
 * Schema: plain string value — one of "Neon" | "Grayscale" | "Gold", or absent for default.
 *
 * Does NOT depend on Git/repository state. Safe on web/unsupported platforms
 * (returns unavailable result; never calls native APIs).
 *
 * Architecture:
 *  - `hydrate()` — reads stored preference + native current icon; returns current selection
 *  - `current()` — reads stored preference (authoritative for user selection)
 *  - `set(name)`  — persists after native success; preserves prior state on failure
 *  - `reset()`    — clears storage and calls native reset
 *  - `isSupported()` — checks platform support without calling native icon APIs
 */

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

/** Valid alternate icon names. `null` represents the default (reset) icon. */
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

const VALID_NAMES: ReadonlySet<string> = new Set(['Neon', 'Grayscale', 'Gold', 'TerminalMono', 'AmberTerminal', 'MonochromeGrid']);

function isAppIconSwitchingSupported(): boolean {
  return supportsAlternateIcons && !(Platform.OS === 'android' && __DEV__);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidName(name: string | null): name is AppIconName {
  return name !== null && name !== '' && VALID_NAMES.has(name);
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
 * Unknown stored values fall back to null (default).
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

  // 2. Validate stored value
  if (isValidName(stored)) {
    return {
      success: true,
      current: stored,
      isSupported: supported,
      isDefault: stored === null,
    };
  }

  // 3. Stored is absent or invalid — consult native state when supported
  if (supported) {
    const native = getAppIconName();
    const normalized: AppIconName = isValidName(native) ? native : null;
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
 * Returns the stored icon preference.
 * Returns `null` when no preference is set or the stored value is invalid.
 */
export async function current(): Promise<AppIconName | null> {
  const stored = await AsyncStorage.getItem(APP_ICON_STORAGE_KEY);
  return isValidName(stored) ? stored : null;
}

// ---------------------------------------------------------------------------
// Mutate operations
// ---------------------------------------------------------------------------

/**
 * Sets the alternate app icon.
 *
 * @param name - The icon name, or `null` to reset to the default icon.
 * @returns AppIconResult indicating success or failure.
 *
 * Behavior:
 *  - Platform unsupported → returns `{ success: false, unavailable: true }`
 *  - Native call throws  → returns `{ success: false, error, previous }`; storage unchanged
 *  - Native call succeeds → persists `name` to AsyncStorage; returns `{ success: true, current: name }`
 */
export async function set(name: AppIconName): Promise<AppIconResult> {
  if (!isAppIconSwitchingSupported()) {
    return { success: false, unavailable: true };
  }

  const previous = await current();

  try {
    const result = await setAlternateAppIcon(name);
    // Persist only after native success
    if (name === null) {
      await AsyncStorage.removeItem(APP_ICON_STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(APP_ICON_STORAGE_KEY, name);
    }
    return {
      success: true,
      current: isValidName(result) ? result : null,
      isDefault: result === null,
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
 * Resets the app icon to the default.
 * Shorthand for `set(null)` with storage cleared.
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
// Named export group (React context / DI convenience)
// ---------------------------------------------------------------------------

export const AppIconService = {
  isSupported,
  hydrate,
  current,
  set,
  reset,
};
