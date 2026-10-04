/**
 * Tests for AppIconService.
 * Exercises: supportsAlternateIcons, getAppIconName, setAlternateAppIcon, resetAppIcon.
 *
 * Strategy: jest.mock factory with inline controlled mock. The real module throws on
 * import (requireNativeModule fails in test env), so we replace it entirely.
 */

type IconName = 'Neon' | 'Grayscale' | 'Gold';

const sharedStorage: Record<string, string | null> = {};

jest.mock('expo-alternate-app-icons', () => {
  let mockPlatformSupports = true;
  let mockCurrentIcon: IconName | null = null;
  let mockSetError: Error | null = null;
  const mockSetCalls: Array<{ name: IconName | null }> = [];

  return {
    get supportsAlternateIcons() {
      return mockPlatformSupports;
    },
    getAppIconName(): IconName | null {
      return mockCurrentIcon;
    },
    async setAlternateAppIcon(name: IconName | null): Promise<IconName | null> {
      mockSetCalls.push({ name });
      if (mockSetError) throw mockSetError;
      mockCurrentIcon = name;
      return name;
    },
    async resetAppIcon(): Promise<void> {
      mockSetCalls.push({ name: null });
      if (mockSetError) throw mockSetError;
      mockCurrentIcon = null;
    },
    _reset() {
      mockPlatformSupports = true;
      mockCurrentIcon = null;
      mockSetError = null;
      mockSetCalls.length = 0;
    },
    _setPlatformSupports(v: boolean) {
      mockPlatformSupports = v;
    },
    _setCurrentIcon(v: IconName | null) {
      mockCurrentIcon = v;
    },
    _setError(v: Error | null) {
      mockSetError = v;
    },
    _getSetCalls() {
      return mockSetCalls;
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

import { AppIconService } from '@/services/AppIconService';
import * as ExpoAlternateAppIcons from 'expo-alternate-app-icons';
import { Platform } from 'react-native';

type ExpoMock = {
  _reset: () => void;
  _setPlatformSupports: (v: boolean) => void;
  _setCurrentIcon: (v: IconName | null) => void;
  _setError: (v: Error | null) => void;
  _getSetCalls: () => Array<{ name: IconName | null }>;
};

const mock = ExpoAlternateAppIcons as unknown as ExpoMock;

beforeEach(() => {
  mock._reset();
  Object.keys(sharedStorage).forEach((k) => {
    delete sharedStorage[k];
  });
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

describe('AppIconService.set valid names', () => {
  it('set("Neon") calls native setAlternateAppIcon with "Neon"', async () => {
    await AppIconService.set('Neon');
    expect(mock._getSetCalls()).toContainEqual({ name: 'Neon' });
  });

  it('set("Grayscale") calls native setAlternateAppIcon with "Grayscale"', async () => {
    await AppIconService.set('Grayscale');
    expect(mock._getSetCalls()).toContainEqual({ name: 'Grayscale' });
  });

  it('set("Gold") calls native setAlternateAppIcon with "Gold"', async () => {
    await AppIconService.set('Gold');
    expect(mock._getSetCalls()).toContainEqual({ name: 'Gold' });
  });

  it('set(null) calls native resetAppIcon', async () => {
    await AppIconService.set(null);
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });
});

describe('AppIconService invalid storage hydration', () => {
  it('hydrate with unknown stored value falls back to null', async () => {
    sharedStorage['@gitnotes:app_icon'] = 'Mars';
    const result = await AppIconService.hydrate();
    expect(result.current).toBeNull();
  });

  it('hydrate with empty string falls back to null', async () => {
    sharedStorage['@gitnotes:app_icon'] = '';
    const result = await AppIconService.hydrate();
    expect(result.current).toBeNull();
  });
});

describe('AppIconService.hydrate', () => {
  it('hydrate reads native state when supported and no stored value', async () => {
    mock._setCurrentIcon('Neon');
    const result = await AppIconService.hydrate();
    expect(result.current).toBe('Neon');
    expect(result.isDefault).toBe(false);
  });

  it('hydrate returns stored value when valid', async () => {
    sharedStorage['@gitnotes:app_icon'] = 'Gold';
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

describe('AppIconService.set persistence', () => {
  it('set persists the icon name after native success', async () => {
    await AppIconService.set('Gold');
    expect(sharedStorage['@gitnotes:app_icon']).toBe('Gold');
  });

  it('set does not persist when native throws', async () => {
    mock._setError(new Error('rejected'));
    await AppIconService.set('Neon');
    expect('@gitnotes:app_icon' in sharedStorage).toBe(false);
  });

  it('set returns error result when native throws', async () => {
    mock._setError(new Error('rejected'));
    const result = await AppIconService.set('Neon');
    expect(result.success).toBe(false);
    expect(result.error).toBe('rejected');
    expect(result.unavailable).toBe(false);
  });

  it('set returns unavailable when platform does not support', async () => {
    mock._setPlatformSupports(false);
    const result = await AppIconService.set('Neon');
    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('set(null) persists null and calls native resetAppIcon', async () => {
    sharedStorage['@gitnotes:app_icon'] = 'Neon';
    await AppIconService.set(null);
    expect('@gitnotes:app_icon' in sharedStorage).toBe(false);
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });
});

describe('AppIconService.reset', () => {
  it('reset calls native resetAppIcon', async () => {
    await AppIconService.reset();
    expect(mock._getSetCalls()).toContainEqual({ name: null });
  });

  it('reset removes storage key', async () => {
    sharedStorage['@gitnotes:app_icon'] = 'Gold';
    await AppIconService.reset();
    expect('@gitnotes:app_icon' in sharedStorage).toBe(false);
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
    sharedStorage['@gitnotes:app_icon'] = 'Gold';
    const result = await AppIconService.current();
    expect(result).toBe('Gold');
  });

  it('current returns null when storage is empty', async () => {
    const result = await AppIconService.current();
    expect(result).toBeNull();
  });

  it('current returns null when stored value is invalid', async () => {
    sharedStorage['@gitnotes:app_icon'] = 'Mars';
    const result = await AppIconService.current();
    expect(result).toBeNull();
  });
});
