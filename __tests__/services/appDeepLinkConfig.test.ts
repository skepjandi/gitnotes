/**
 * Config validation test for universal / app link deep-link associations.
 *
 * Verifies that:
 * - iOS `associatedDomains` includes `applinks:gitnotes.org`
 * - Android `intentFilters` includes a VIEW filter for `https://gitnotes.org/r/*`
 *
 * These are required for iOS Universal Links and Android App Links to open
 * the app when the user visits https://gitnotes.org/r/<code>.
 *
 * Run: yarn jest __tests__/services/appDeepLinkConfig.test.ts --no-coverage
 */

import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');

interface IntentFilterData {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  pathPrefix?: string;
  pathPattern?: string;
}

interface IntentFilter {
  action?: string;
  autoVerify?: boolean;
  data?: IntentFilterData[];
  category?: string[];
}

interface iOSConfig {
  associatedDomains?: string[];
  [key: string]: unknown;
}

interface AndroidConfig {
  intentFilters?: IntentFilter[];
  [key: string]: unknown;
}

interface AppJsonConfig {
  expo: {
    ios?: iOSConfig;
    android?: AndroidConfig;
    [key: string]: unknown;
  };
}

function loadAppJson(): AppJsonConfig {
  const raw = fs.readFileSync(path.join(ROOT, 'app.json'), 'utf-8');
  return JSON.parse(raw) as AppJsonConfig;
}

function hasApplinksDomain(config: AppJsonConfig, domain: string): boolean {
  const domains = config.expo?.ios?.associatedDomains ?? [];
  return domains.includes(domain);
}

function hasAndroidHttpsReferralFilter(config: AppJsonConfig, host: string, pathPrefix: string): boolean {
  const filters = config.expo?.android?.intentFilters ?? [];
  return filters.some((filter) => {
    if (filter.action !== 'VIEW') return false;
    const dataItems = filter.data ?? [];
    const hasScheme = dataItems.some((d) => d.scheme === 'https');
    const hasHost = dataItems.some((d) => d.host === host);
    const hasPath = dataItems.some(
      (d) => (d.pathPrefix ?? '') === pathPrefix || (d.path ?? '').startsWith(pathPrefix),
    );
    return hasScheme && hasHost && hasPath;
  });
}

describe('App deep link configuration', () => {
  const config = loadAppJson();

  describe('iOS Universal Links', () => {
    it('has associatedDomains array', () => {
      expect(Array.isArray(config.expo?.ios?.associatedDomains)).toBe(true);
    });

    it('includes applinks:gitnotes.org', () => {
      expect(hasApplinksDomain(config, 'applinks:gitnotes.org')).toBe(true);
    });
  });

  describe('Android App Links', () => {
    it('has intentFilters array', () => {
      expect(Array.isArray(config.expo?.android?.intentFilters)).toBe(true);
    });

    it('has VIEW filter for https://gitnotes.org/r/*', () => {
      expect(hasAndroidHttpsReferralFilter(config, 'gitnotes.org', '/r/')).toBe(true);
    });
  });
});
