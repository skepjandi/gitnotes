/**
 * Config/assets validation test for alternate app icons.
 *
 * Verifies that every asset path declared in app.json's expo-alternate-app-icons
 * plugin actually exists on disk, with correct PNG dimensions.
 *
 * Run: yarn jest __tests__/services/alternateIconAssets.test.ts --no-coverage
 */

import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');

interface AlternateIconConfig {
  name: string;
  ios: string;
  android: {
    foregroundImage: string;
    backgroundColor: string;
    monochromeImage: string;
  };
}

interface AppJsonConfig {
  expo: {
    plugins: Array<unknown>;
  };
}

function loadAppJson(): AppJsonConfig {
  const raw = fs.readFileSync(path.join(ROOT, 'app.json'), 'utf-8');
  return JSON.parse(raw) as AppJsonConfig;
}

function extractAlternateIcons(config: AppJsonConfig): AlternateIconConfig[] {
  const plugins = config.expo?.plugins ?? [];
  for (const plugin of plugins) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-alternate-app-icons') {
      const icons: AlternateIconConfig[] = [];
      const defs = plugin[1] as AlternateIconConfig[];
      if (Array.isArray(defs)) {
        for (const def of defs) {
          if (def && typeof def === 'object' && 'name' in def && 'ios' in def && 'android' in def) {
            icons.push(def as AlternateIconConfig);
          }
        }
      }
      return icons;
    }
  }
  return [];
}

function getPngDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 24) return null;
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  } catch {
    return null;
  }
}

describe('Alternate app icon assets', () => {
  const icons = extractAlternateIcons(loadAppJson());

  it('finds at least one alternate icon in app.json', () => {
    expect(icons.length).toBeGreaterThan(0);
  });

  for (const icon of icons) {
    describe(`icon: ${icon.name}`, () => {
      const iconPath = path.resolve(ROOT, icon.ios);
      const adaptivePath = path.resolve(ROOT, icon.android.foregroundImage);
      const monochromePath = path.resolve(ROOT, icon.android.monochromeImage);

      it(`${icon.ios} exists`, () => {
        expect(fs.existsSync(iconPath)).toBe(true);
      });

      it(`${icon.android.foregroundImage} exists`, () => {
        expect(fs.existsSync(adaptivePath)).toBe(true);
      });

      it(`${icon.android.monochromeImage} exists`, () => {
        expect(fs.existsSync(monochromePath)).toBe(true);
      });

      if (fs.existsSync(iconPath)) {
        it(`${icon.ios} is 1024x1024 PNG`, () => {
          const dims = getPngDimensions(iconPath);
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(1024);
          expect(dims!.height).toBe(1024);
        });
      }

      if (fs.existsSync(adaptivePath)) {
        it(`${icon.android.foregroundImage} is 1024x1024 PNG`, () => {
          const dims = getPngDimensions(adaptivePath);
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(1024);
          expect(dims!.height).toBe(1024);
        });
      }

      if (fs.existsSync(monochromePath)) {
        it(`${icon.android.monochromeImage} is 1024x1024 PNG`, () => {
          const dims = getPngDimensions(monochromePath);
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(1024);
          expect(dims!.height).toBe(1024);
        });
      }
    });
  }
});
