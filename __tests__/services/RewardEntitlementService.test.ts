/**
 * RewardEntitlementService TDD tests — account-scope cache isolation.
 *
 * These tests verify:
 * 1. Cache is scoped to identity: account A's status never leaks to account B
 * 2. Late responses (A resolves after switch to B) do not overwrite B's cache
 * 3. clearCache() wipes both in-memory and AsyncStorage for the current scope
 * 4. SettingsScreen useEffect refreshes when activeAccountId changes
 *
 * Run with: yarn jest __tests__/services/RewardEntitlementService.test.ts --no-coverage --forceExit
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Mock reset helper ─────────────────────────────────────────────────────────

function resetAsyncStorage() {
  AsyncStorage.getItem = jest.fn();
  AsyncStorage.setItem = jest.fn();
  AsyncStorage.removeItem = jest.fn();
}

// ── In-memory AsyncStorage mock ───────────────────────────────────────────────

const asyncStorageStore: Record<string, string> = {};

beforeEach(() => {
  Object.keys(asyncStorageStore).forEach((k) => delete asyncStorageStore[k]);
  resetAsyncStorage();
  AsyncStorage.getItem.mockImplementation(async (key: string) => asyncStorageStore[key] ?? null);
  AsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
    asyncStorageStore[key] = value;
  });
  AsyncStorage.removeItem.mockImplementation(async (key: string) => {
    delete asyncStorageStore[key];
  });
});

// ── Mock workerApi ─────────────────────────────────────────────────────────────

const mockReferralsStatus = jest.fn();
jest.mock('../../src/services/workerApi', () => ({
  workerApi: {
    referrals: {
      status: (...args: unknown[]) => mockReferralsStatus(...args),
    },
  },
}));

// ── Mock ReferralIdentityService.getIdentityScope ────────────────────────────────
// We mock at the module level so RewardEntitlementService picks it up.

type IdentityScope = { kind: 'github'; accountId: string; installationId: string } | { kind: 'installation'; installationId: string };

const mockGetIdentityScope = jest.fn<() => Promise<IdentityScope>>();
jest.mock('../../src/services/ReferralIdentityService', () => ({
  ReferralIdentityService: {
    getIdentityProof: jest.fn(),
    getIdentityScope: () => mockGetIdentityScope(),
  },
  getIdentityScope: () => mockGetIdentityScope(),
}));

// We need to import the module AFTER mocks are set up so the mock is active.
// But because of Jest hoisting, we use require in beforeEach or top-level import works.
// We import the service module which will use our mock.
import { RewardEntitlementService } from '../../src/services/RewardEntitlementService';
import { ReferralIdentityService } from '../../src/services/ReferralIdentityService';

const SCOPE_A_GITHUB: IdentityScope = { kind: 'github', accountId: 'account-a', installationId: 'install-a' };
const SCOPE_B_GITHUB: IdentityScope = { kind: 'github', accountId: 'account-b', installationId: 'install-b' };
const SCOPE_INSTALL_A: IdentityScope = { kind: 'installation', installationId: 'install-a' };

function mockStatusResponse(progress: number, milestones: number[]) {
  return {
    has_pending_code: false,
    pending_code: null,
    pending_expires_at: null,
    progress,
    catalog_version: 1,
    unlocked_milestones: milestones,
    milestones: [
      { milestone: 3, name: 'Terminal Mono Theme', reward_type: 'theme', reward_key: 'terminal-mono-theme', unlocked: milestones.includes(3) },
      { milestone: 1, name: 'Terminal Mono Icon', reward_type: 'icon', reward_key: 'terminal-mono-icon', unlocked: milestones.includes(1) },
      { milestone: 5, name: 'Amber Terminal Icon', reward_type: 'icon', reward_key: 'amber-terminal-icon', unlocked: milestones.includes(5) },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// RED phase: these tests characterize the BROKEN behavior — they FAIL on the
// current code because RewardEntitlementService has no identity scoping.
// ════════════════════════════════════════════════════════════════════════════════

describe('RewardEntitlementService account-scope cache isolation', () => {
  afterEach(async () => {
    await RewardEntitlementService.clearCache();
  });

  it('RED: account A status does not leak into account B getStatus()', async () => {
    mockGetIdentityScope
      .mockResolvedValueOnce(SCOPE_A_GITHUB)
      .mockResolvedValueOnce(SCOPE_B_GITHUB);
    mockReferralsStatus
      .mockResolvedValueOnce(mockStatusResponse(3, [3]))
      .mockResolvedValueOnce(mockStatusResponse(0, []));

    const statusA = await RewardEntitlementService.fetchStatus();
    expect(statusA.progress).toBe(3);
    expect(statusA.unlocked_milestones).toContain(3);

    // Account B fetch — uses B's identity scope
    const statusB = await RewardEntitlementService.fetchStatus();
    expect(statusB.progress).toBe(0);

    // After fix: getStatus() returns B's scoped cache, not A's
    const cachedForB = RewardEntitlementService.getStatus();
    expect(cachedForB?.progress).toBe(0);
    expect(cachedForB?.progress).not.toBe(3);
  });

  it('RED: late response from account A does not overwrite account B cache', async () => {
    // Account A fetch starts but resolves LATE (after switch to B)
    let resolveA: (v: unknown) => void;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });

    // Mock A's identity scope for the first fetch
    mockGetIdentityScope
      .mockResolvedValueOnce(SCOPE_A_GITHUB)
      // Second call: B's scope (happens when fetchStatus reads scope at start)
      .mockResolvedValueOnce(SCOPE_B_GITHUB);

    // A's API call hangs; B's API call resolves immediately with progress 5
    mockReferralsStatus
      .mockReturnValueOnce(promiseA) // A's call hangs
      .mockResolvedValueOnce(mockStatusResponse(5, [5])); // B's call resolves

    // Fire A's request (will hang on API call)
    const fetchA = RewardEntitlementService.fetchStatus();
    // Simulate account switch by clearing cache
    await RewardEntitlementService.clearCache();
    // B's status fetched (B's scope already set in mock chain above)
    const statusB = await RewardEntitlementService.fetchStatus();
    expect(statusB.progress).toBe(5);

    // Late A response resolves — BEFORE fix, this would overwrite B's cache
    resolveA!(mockStatusResponse(3, [3]));
    await fetchA;

    // A's late response must NOT overwrite B's cache
    const afterLateA = RewardEntitlementService.getStatus();
    expect(afterLateA?.progress).toBe(5); // Should still be B's progress, not A's
  });

  it('RED: clearCache() removes AsyncStorage entry for current scope', async () => {
    mockGetIdentityScope.mockResolvedValue(SCOPE_A_GITHUB);
    mockReferralsStatus.mockResolvedValue(mockStatusResponse(3, [3]));

    await RewardEntitlementService.clearCache();
    await RewardEntitlementService.fetchStatus();

    // Verify something was written to AsyncStorage
    expect(Object.keys(asyncStorageStore).some((k) => k.includes('referral_status_cache'))).toBe(true);

    await RewardEntitlementService.clearCache();

    // After clearCache, AsyncStorage should have the entry removed
    const cacheKeys = Object.keys(asyncStorageStore).filter((k) => k.includes('referral_status_cache'));
    expect(cacheKeys.length).toBe(0);
  });

  it('RED: different identity kinds (github vs installation) use separate caches', async () => {
    mockGetIdentityScope
      .mockResolvedValueOnce(SCOPE_A_GITHUB)
      .mockResolvedValueOnce(SCOPE_INSTALL_A);
    mockReferralsStatus
      .mockResolvedValueOnce(mockStatusResponse(7, [7]))
      .mockResolvedValueOnce(mockStatusResponse(0, []));

    const ghStatus = await RewardEntitlementService.fetchStatus();
    expect(ghStatus.progress).toBe(7);

    // Installation scope fetch — should use installationId scope, not github scope
    const installStatus = await RewardEntitlementService.fetchStatus();
    expect(installStatus.progress).toBe(0);

    // getStatus() returns installation-scoped cache
    const cached = RewardEntitlementService.getStatus();
    expect(cached?.progress).toBe(0);
    expect(cached?.progress).not.toBe(7);
  });

  it('RED: resetMemory() preserves per-identity AsyncStorage cache while clearing in-memory state', async () => {
    mockGetIdentityScope.mockResolvedValueOnce(SCOPE_A_GITHUB);
    mockReferralsStatus.mockResolvedValueOnce(mockStatusResponse(3, [3]));
    await RewardEntitlementService.fetchStatus();

    const hasACache = Object.keys(asyncStorageStore).some((k) => k.includes('account-a'));
    expect(hasACache).toBe(true);

    await RewardEntitlementService.resetMemory();

    const cacheAfterReset = Object.keys(asyncStorageStore).some((k) => k.includes('account-a'));
    expect(cacheAfterReset).toBe(true);

    const inMemoryAfterReset = RewardEntitlementService.getStatus();
    expect(inMemoryAfterReset).toBeUndefined();
  });

  it('RED: account A offline cache is preserved and restored when switching A→B→A', async () => {
    mockGetIdentityScope.mockResolvedValueOnce(SCOPE_A_GITHUB);
    mockReferralsStatus.mockResolvedValueOnce(mockStatusResponse(3, [3]));
    await RewardEntitlementService.fetchStatus();

    mockGetIdentityScope.mockResolvedValueOnce(SCOPE_B_GITHUB);
    mockReferralsStatus.mockResolvedValueOnce(mockStatusResponse(5, [5]));
    await RewardEntitlementService.fetchStatus();

    mockGetIdentityScope.mockResolvedValueOnce(SCOPE_A_GITHUB);
    const restoredA = await RewardEntitlementService.hydrateCache();
    expect(restoredA?.progress).toBe(3);
  });
});

describe('SettingsScreen referral effect account-switch behavior', () => {
  it('RED: SettingsScreen refresh effect has activeAccountId in dependency array', () => {
    const path = require('path');
    const fs = require('fs');
    const worktreeRoot = path.resolve(__dirname, '../..');
    const source = fs.readFileSync(
      path.join(worktreeRoot, 'src/screens/SettingsScreen.tsx'),
      'utf-8',
    );

    const activeAccountIdIdx = source.indexOf('activeAccountId');
    const nextUseEffect = source.indexOf('useEffect(() => {', activeAccountIdIdx);
    const afterEffect = source.slice(nextUseEffect);
    const effectEnd = afterEffect.indexOf('const refreshLfsPending');
    const effectBlock = afterEffect.slice(0, effectEnd > 0 ? effectEnd : undefined);

    expect(effectBlock.length).toBeGreaterThan(0);
    expect(effectBlock).toMatch(/activeAccountId/);
    expect(effectBlock).not.toMatch(/\[\s*\]\s*;.*Hydrate referral status/);
  });

  it('RED: SettingsScreen referral effect has disposed guard in cleanup and before setState calls', () => {
    const path = require('path');
    const fs = require('fs');
    const worktreeRoot = path.resolve(__dirname, '../..');
    const source = fs.readFileSync(
      path.join(worktreeRoot, 'src/screens/SettingsScreen.tsx'),
      'utf-8',
    );

    const activeAccountIdIdx = source.indexOf('activeAccountId');
    const nextUseEffect = source.indexOf('useEffect(() => {', activeAccountIdIdx);
    const afterEffect = source.slice(nextUseEffect);
    const effectEnd = afterEffect.indexOf('const refreshLfsPending');
    const effectBlock = afterEffect.slice(0, effectEnd > 0 ? effectEnd : undefined);

    expect(effectBlock).toMatch(/let disposed = false/);
    expect(effectBlock).toMatch(/return \(\) => \{\s*disposed = true/);
    expect(effectBlock).toMatch(/if \(disposed\) return;/);
    expect(effectBlock).toMatch(/setReferralProgress\(status\.progress\)/);
    expect(effectBlock).toMatch(/setReferralUnlockedCount\(status\.unlocked_milestones\.length\)/);
  });
});

describe('Generation guard — stale scope lookup race', () => {
  afterEach(async () => {
    jest.useRealTimers();
    await RewardEntitlementService.clearCache();
  });

  it('RED: slow A scope lookup resolves after resetMemory + B fetch; A must not corrupt B cache', async () => {
    jest.useFakeTimers();
    mockGetIdentityScope.mockReset();
    mockReferralsStatus.mockReset();
    const mockGetIdentityProof = (ReferralIdentityService as unknown as { getIdentityProof: jest.Mock }).getIdentityProof;
    mockGetIdentityProof.mockReset();
    mockGetIdentityProof.mockImplementation(() => Promise.resolve({ kind: 'github', token: 'fake-token', installationId: 'fake-install' }));

    // A's scope resolves via setTimeout — scheduled at queue time, fires after synchronous code
    mockGetIdentityScope.mockImplementation(() => new Promise<IdentityScope>((res) => {
      setTimeout(() => res(SCOPE_A_GITHUB), 0);
    }));

    mockReferralsStatus
      .mockResolvedValueOnce(mockStatusResponse(5, [5]))
      .mockResolvedValueOnce(mockStatusResponse(3, [3]));

    const fetchA = RewardEntitlementService.fetchStatus();

    RewardEntitlementService.resetMemory();

    mockGetIdentityScope.mockResolvedValue(SCOPE_B_GITHUB);
    const statusB = await RewardEntitlementService.fetchStatus();
    expect(statusB.progress).toBe(5);

    jest.advanceTimersByTime(0);

    const resultA = await fetchA;
    expect(resultA.progress).toBe(0);
    expect(RewardEntitlementService.getStatus()?.progress).toBe(5);
  });
});
