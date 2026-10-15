/**
 * Tests for AppIconService.
 * Exercises: supportsAlternateIcons, getAppIconName, setAlternateAppIcon, resetAppIcon,
 * setForTheme, syncToCurrentTheme, native variant mapping, storage normalization.
 *
 * Strategy: jest.mock factory with inline controlled mock. The real module throws on
 * import (requireNativeModule fails in test env), so we replace it entirely.
 */

type NativeIconName =
  | 'NeonLight'
  | 'NeonDark'
  | 'GrayscaleLight'
  | 'GrayscaleDark'
  | 'GoldLight'
  | 'GoldDark'
  | 'TerminalMonoLight'
  | 'TerminalMonoDark'
  | 'AmberTerminalLight'
  | 'AmberTerminalDark'
  | 'MonochromeGridLight'
  | 'MonochromeGridDark'
  | null;

const sharedStorage: Record<string, string | null> = {};

jest.mock('expo-alternate-app-icons', () => {
  let mockPlatformSupports = true;
  let mockCurrentIcon: NativeIconName = null;
  let mockSetError: Error | null = null;
  const mockSetCalls: Array<{ name: NativeIconName }> = [];
  let mockErrorQueue: Error[] = [];
  let mockDelayMs = 0;
  let activeCalls = 0;
  let maxConcurrentCalls = 0;

  return {
    get supportsAlternateIcons() {
      return mockPlatformSupports;
    },
    getAppIconName(): NativeIconName {
      return mockCurrentIcon;
    },
    async setAlternateAppIcon(name: NativeIconName): Promise<NativeIconName> {
      mockSetCalls.push({ name });
      activeCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      try {
        if (mockDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, mockDelayMs));
        if (mockErrorQueue.length > 0) throw mockErrorQueue.shift()!;
        if (mockSetError) throw mockSetError;
        mockCurrentIcon = name;
        return name;
      } finally {
        activeCalls -= 1;
      }
    },
    async resetAppIcon(): Promise<void> {
      mockSetCalls.push({ name: null });
      activeCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      try {
        if (mockDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, mockDelayMs));
        if (mockErrorQueue.length > 0) throw mockErrorQueue.shift()!;
        if (mockSetError) throw mockSetError;
        mockCurrentIcon = null;
      } finally {
        activeCalls -= 1;
      }
    },
    _reset() {
      mockPlatformSupports = true;
      mockCurrentIcon = null;
      mockSetError = null;
      mockSetCalls.length = 0;
      mockErrorQueue = [];
      mockDelayMs = 0;
      activeCalls = 0;
      maxConcurrentCalls = 0;
    },
    _setPlatformSupports(v: boolean) {
      mockPlatformSupports = v;
    },
    _setCurrentIcon(v: NativeIconName) {
      mockCurrentIcon = v;
    },
    _setError(v: Error | null) {
      mockSetError = v;
    },
    _setNextErrors(errors: Error[]) {
      mockErrorQueue = [...errors];
    },
    _setDelay(ms: number) {
      mockDelayMs = ms;
    },
    _getSetCalls() {
      return mockSetCalls;
    },
    _getCallCount() {
      return mockSetCalls.length;
    },
    _getMaxConcurrentCalls() {
      return maxConcurrentCalls;
    },
    _storage: sharedStorage,
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => {
        return key in sharedStorage ? (sharedStorage[key] ?? null) : null;
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        sharedStorage[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete sharedStorage[key];
      }),
    },
  };
});

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '18.6', select: (o: object) => o },
  Appearance: {
    getColorScheme: jest.fn(() => 'light'),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    removeEventListener: jest.fn(),
  },
}));

import { AppIconService, APP_ICON_STORAGE_KEY } from '@/services/AppIconService';
import * as ExpoAlternateAppIcons from 'expo-alternate-app-icons';
import { Platform, Appearance } from 'react-native';

type ExpoMock = {
  _reset: () => void;
  _setPlatformSupports: (v: boolean) => void;
  _setCurrentIcon: (v: NativeIconName) => void;
  _setError: (v: Error | null) => void;
  _setNextErrors: (errors: Error[]) => void;
  _setDelay: (ms: number) => void;
  _getSetCalls: () => Array<{ name: NativeIconName }>;
  _getCallCount: () => number;
  _getMaxConcurrentCalls: () => number;
};

const mock = ExpoAlternateAppIcons as unknown as ExpoMock;

beforeEach(() => {
  mock._reset();
  Object.keys(sharedStorage).forEach((k) => {
    delete sharedStorage[k];
  });
  (Appearance.getColorScheme as jest.Mock).mockReturnValue('light');
});

describe('AppIconService.isSupported', () => {
  it('returns true when platform supports alternate icons', async () => {
    mock._setPlatformSupports(true);
    const result = await AppIconService.isSupported();
    expect(result).toBe(true);
  });

  it('returns false when platform does not support alternate icons', async () => {
    mock._setPlatformSupports(false);
    const result = await AppIconService.isSupported();
    expect(result).toBe(false);
  });

  it('returns false for Android development builds', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const result = await AppIconService.isSupported();
      expect(result).toBe(false);
    } finally {
      platform.restore();
    }
  });

});

describe('AppIconService.setForTheme — native variant resolution', () => {
  beforeEach(() => {
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('light');
  });

  it('setForTheme(Neon, false) calls native with NeonLight', async () => {
    await AppIconService.setForTheme('Neon', false);
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonLight' });
  });

  it('setForTheme(Neon, true) calls native with NeonDark', async () => {
    await AppIconService.setForTheme('Neon', true);
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonDark' });
  });

  it('setForTheme(Grayscale, true) calls native with GrayscaleDark', async () => {
    await AppIconService.setForTheme('Grayscale', true);
    expect(mock._getSetCalls()).toContainEqual({ name: 'GrayscaleDark' });
  });

  it('setForTheme(Gold, false) calls native with GoldLight', async () => {
    await AppIconService.setForTheme('Gold', false);
    expect(mock._getSetCalls()).toContainEqual({ name: 'GoldLight' });
  });

  it('setForTheme(TerminalMono, true) calls native with TerminalMonoDark', async () => {
    await AppIconService.setForTheme('TerminalMono', true);
    expect(mock._getSetCalls()).toContainEqual({ name: 'TerminalMonoDark' });
  });

  it('setForTheme(AmberTerminal, false) calls native with AmberTerminalLight', async () => {
    await AppIconService.setForTheme('AmberTerminal', false);
    expect(mock._getSetCalls()).toContainEqual({ name: 'AmberTerminalLight' });
  });

  it('setForTheme(MonochromeGrid, true) calls native with MonochromeGridDark', async () => {
    await AppIconService.setForTheme('MonochromeGrid', true);
    expect(mock._getSetCalls()).toContainEqual({ name: 'MonochromeGridDark' });
  });

  it('setForTheme(null, _) calls native with null (reset)', async () => {
    await AppIconService.setForTheme(null, true);
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });
});

describe('AppIconService.set — auto-resolves from Appearance.getColorScheme', () => {
  it('set(Neon) when isDark=false resolves to NeonLight', async () => {
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('light');
    await AppIconService.set('Neon');
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonLight' });
  });

  it('set(Neon) when isDark=true resolves to NeonDark', async () => {
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('dark');
    await AppIconService.set('Neon');
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonDark' });
  });
});

describe('AppIconService.syncToCurrentTheme', () => {
  it('syncToCurrentTheme reads stored logical name and applies correct native variant', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Neon';
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('dark');
    await AppIconService.syncToCurrentTheme();
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonDark' });
  });

  it('syncToCurrentTheme does nothing when no icon is stored', async () => {
    await AppIconService.syncToCurrentTheme();
    expect(mock._getSetCalls()).toHaveLength(0);
  });
});

describe('AppIconService.syncToTheme', () => {
  it('uses the resolved app theme instead of the system appearance', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Neon';
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('light');
    await AppIconService.syncToTheme(true);
    expect(mock._getSetCalls()).toContainEqual({ name: 'NeonDark' });
  });

  it('does not call native switching when the requested variant is already active', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Neon';
    mock._setCurrentIcon('NeonDark');
    const result = await AppIconService.syncToTheme(true);
    expect(result.current).toBe('Neon');
    expect(mock._getSetCalls()).toHaveLength(0);
  });
});

describe('AppIconService storage normalization', () => {
  it('set persists the logical name to storage, not the native name', async () => {
    await AppIconService.setForTheme('Neon', true);
    expect(sharedStorage[APP_ICON_STORAGE_KEY]).toBe('Neon');
  });

  it('hydrate with native NeonDark in storage normalizes to logical Neon', async () => {
    mock._setCurrentIcon('NeonDark');
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Neon');
  });

  it('hydrate with native GrayscaleLight normalizes to Grayscale', async () => {
    mock._setCurrentIcon('GrayscaleLight');
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Grayscale');
  });

  it('hydrate returns stored logical name directly', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Gold';
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Gold');
  });
});

describe('AppIconService invalid storage hydration', () => {
  it('hydrate with unknown stored value falls back to null', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Mars';
    const result = await AppIconService.hydrate();
    expect(result.current).toBeNull();
  });

  it('hydrate with empty string falls back to null', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = '';
    const result = await AppIconService.hydrate();
    expect(result.current).toBeNull();
  });
});

describe('AppIconService.hydrate', () => {
  it('hydrate reads native state when supported and no stored value', async () => {
    mock._setCurrentIcon('NeonDark');
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Neon');
    expect(result.isDefault).toBe(false);
  });

  it('hydrate returns stored value when valid', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Gold';
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Gold');
    expect(result.isDefault).toBe(false);
  });

  it('hydrate returns null when both storage and native are null', async () => {
    mock._setCurrentIcon(null);
    const result = await AppIconService.hydrate();
    expect(result.current).toBeNull();
    expect(result.isDefault).toBe(true);
  });

  it('hydrate returns isSupported=false when platform does not support', async () => {
    mock._setPlatformSupports(false);
    const result = await AppIconService.hydrate();
    expect(result.isSupported).toBe(false);
  });
});

describe('AppIconService.setForTheme persistence', () => {
  it('setForTheme persists the logical icon name after native success', async () => {
    await AppIconService.setForTheme('Gold', false);
    expect(sharedStorage[APP_ICON_STORAGE_KEY]).toBe('Gold');
  });

  it('setForTheme does not persist when native throws', async () => {
    mock._setError(new Error('rejected'));
    await AppIconService.setForTheme('Neon', false);
    expect(APP_ICON_STORAGE_KEY in sharedStorage).toBe(false);
  });

  it('setForTheme returns error result when native throws', async () => {
    mock._setError(new Error('rejected'));
    const result = await AppIconService.setForTheme('Neon', false);
    expect(result.success).toBe(false);
    expect(result.error).toBe('rejected');
    expect(result.unavailable).toBe(false);
  });

  it('setForTheme returns unavailable when platform does not support', async () => {
    mock._setPlatformSupports(false);
    const result = await AppIconService.setForTheme('Neon', false);
    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('setForTheme(null, _) persists null and calls native resetAppIcon', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Neon';
    await AppIconService.setForTheme(null, true);
    expect(APP_ICON_STORAGE_KEY in sharedStorage).toBe(false);
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });
});

describe('AppIconService.reset', () => {
  it('reset calls native resetAppIcon', async () => {
    await AppIconService.reset();
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });

  it('reset removes storage key', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Gold';
    await AppIconService.reset();
    expect(APP_ICON_STORAGE_KEY in sharedStorage).toBe(false);
  });

  it('reset returns error result when native throws', async () => {
    mock._setError(new Error('rejected'));
    const result = await AppIconService.reset();
    expect(result.success).toBe(false);
    expect(result.error).toBe('rejected');
  });

  it('reset returns unavailable when platform does not support', async () => {
    mock._setPlatformSupports(false);
    const result = await AppIconService.reset();
    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('AppIconService.current', () => {
  it('current returns stored icon', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Gold';
    const result = await AppIconService.current();
    expect(result).toBe('Gold');
  });

  it('current returns null when storage is empty', async () => {
    const result = await AppIconService.current();
    expect(result).toBeNull();
  });

  it('current returns null when stored value is invalid', async () => {
    sharedStorage[APP_ICON_STORAGE_KEY] = 'Mars';
    const result = await AppIconService.current();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Serialization and retry regression tests
// ---------------------------------------------------------------------------

describe('AppIconService queue serialization', () => {
  it('serializes mutations — max one native call in flight', async () => {
    mock._setDelay(10);

    const [result1, result2] = await Promise.all([
      AppIconService.setForTheme('Neon', false),
      AppIconService.setForTheme('Grayscale', false),
    ]);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    const calls = mock._getSetCalls();
    expect(calls).toContainEqual({ name: 'NeonLight' });
    expect(calls).toContainEqual({ name: 'GrayscaleLight' });
    expect(mock._getMaxConcurrentCalls()).toBe(1);
  });

  it('transient failure retries and succeeds on subsequent attempt', async () => {
    mock._setNextErrors([new Error('Resource temporarily unavailable')]);

    const result = await AppIconService.setForTheme('Neon', false);

    expect(result.success).toBe(true);
    expect(result.current).toBe('Neon');
    expect(mock._getCallCount()).toBeGreaterThanOrEqual(2);
    expect(sharedStorage[APP_ICON_STORAGE_KEY]).toBe('Neon');
  });

  it('exhausted transient retries — all 3 attempts fail', async () => {
    mock._setNextErrors([
      new Error('Resource temporarily unavailable'),
      new Error('Resource temporarily unavailable'),
      new Error('Resource temporarily unavailable'),
    ]);

    const result = await AppIconService.setForTheme('Neon', false);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Resource temporarily unavailable');
    expect(result.unavailable).toBe(false);
    expect(mock._getCallCount()).toBe(3);
    expect(sharedStorage[APP_ICON_STORAGE_KEY]).toBeUndefined();
  });

  it('non-transient error fails immediately without retry', async () => {
    mock._setNextErrors([new Error('Some permanent rejection')]);

    const result = await AppIconService.setForTheme('Neon', false);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Some permanent rejection');
    expect(mock._getCallCount()).toBe(1);
    expect(sharedStorage[APP_ICON_STORAGE_KEY]).toBeUndefined();
  });

  it('NSPOSIXErrorDomain code 35 triggers retry', async () => {
    const posix35Error = Object.assign(
      new Error('NSPOSIXErrorDomain error 35: Resource temporarily unavailable'),
      { code: 35 },
    );
    mock._setNextErrors([posix35Error]);

    const result = await AppIconService.setForTheme('Neon', false);

    expect(result.success).toBe(true);
    expect(result.current).toBe('Neon');
    expect(mock._getCallCount()).toBeGreaterThanOrEqual(2);
  });

  it('reset() goes through the queue and retries on transient error', async () => {
    mock._setNextErrors([new Error('Resource temporarily unavailable')]);

    const result = await AppIconService.reset();

    expect(result.success).toBe(true);
    expect(result.current).toBeNull();
    expect(result.isDefault).toBe(true);
    expect(mock._getCallCount()).toBeGreaterThanOrEqual(2);
  });

  it('reset() non-transient error fails fast', async () => {
    mock._setNextErrors([new Error('Permanent reset failure')]);

    const result = await AppIconService.reset();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permanent reset failure');
    expect(mock._getCallCount()).toBe(1);
  });
});
