/**
 * exceedsFreeTierCaps() decides whether first render may skip waiting on the
 * RevenueCat entitlement. It must report true whenever enforceTierLimits could
 * truncate data (#1233), and must not consume the repo boot value.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as TierLimitsModule from '@/services/TierLimits';
import type * as AccountStorageModule from '@/services/AccountStorage';
import type * as StorageBootstrapModule from '@/services/StorageBootstrap';

jest.unmock('@/services/TierLimits');
jest.unmock('@/services/AccountStorage');
jest.unmock('@/services/StorageBootstrap');

const { exceedsFreeTierCaps } = jest.requireActual<typeof TierLimitsModule>('@/services/TierLimits');
const { AccountStorage } = jest.requireActual<typeof AccountStorageModule>('@/services/AccountStorage');
const { clearBootCache, bootstrapStorage, getBootValue } =
  jest.requireActual<typeof StorageBootstrapModule>('@/services/StorageBootstrap');
const repo = (path: string) => ({ path });
const setRepos = (n: number) =>
  AsyncStorage.setItem('@gitnotes:repos', JSON.stringify(Array.from({ length: n }, (_, i) => repo(`r${i}`))));

describe('exceedsFreeTierCaps', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearBootCache();
    jest.restoreAllMocks();
    jest.spyOn(AccountStorage, 'listAccounts').mockResolvedValue([]);
  });

  it('is false for no data and for data at the cap', async () => {
    expect(await exceedsFreeTierCaps()).toBe(false);
    clearBootCache();
    await setRepos(1);
    jest.spyOn(AccountStorage, 'listAccounts').mockResolvedValue([{ id: 'a', login: 'a' }] as never);
    expect(await exceedsFreeTierCaps()).toBe(false);
  });

  it('is true when repos exceed the cap', async () => {
    await setRepos(2);
    expect(await exceedsFreeTierCaps()).toBe(true);
  });

  it('is true when accounts exceed the cap', async () => {
    jest.spyOn(AccountStorage, 'listAccounts').mockResolvedValue([
      { id: 'a', login: 'a' },
      { id: 'b', login: 'b' },
    ] as never);
    expect(await exceedsFreeTierCaps()).toBe(true);
  });

  it('falls back to the blocking path when reads fail', async () => {
    jest.spyOn(AccountStorage, 'listAccounts').mockRejectedValue(new Error('boom'));
    expect(await exceedsFreeTierCaps()).toBe(true);
  });

  it('leaves the repo boot value for the stores to consume', async () => {
    await setRepos(1);
    await exceedsFreeTierCaps();
    expect(getBootValue('@gitnotes:repos')).toBe(JSON.stringify([repo('r0')]));
  });
});

describe('bootstrapStorage', () => {
  beforeEach(() => {
    clearBootCache();
    jest.clearAllMocks();
  });

  it('shares one multiGet between concurrent callers', async () => {
    const [a, b] = await Promise.all([bootstrapStorage(), bootstrapStorage()]);
    expect(a).toBe(b);
    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed read instead of caching the rejection', async () => {
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await expect(bootstrapStorage()).rejects.toThrow('disk');
    await expect(bootstrapStorage()).resolves.toBeInstanceOf(Map);
  });
});
