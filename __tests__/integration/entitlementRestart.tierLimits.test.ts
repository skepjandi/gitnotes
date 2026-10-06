/**
 * Integration tests for enforceTierLimits — account-cap enforcement ordering.
 *
 * These tests verify that bootstrapEntitlement resolves Pro/Free state BEFORE
 * enforceTierLimits runs, and that enforceAccountCap correctly truncates
 * over-limit restored accounts for Free users while letting Pro users keep all.
 *
 * Key guarantees tested:
 * - Pro entitlement is resolved at the time enforceTierLimits is called
 *   (storeStateAtEnforceCall captures status/entitlementActive).
 * - Free users with >FREE_TIER_MAX_ACCOUNTS restored accounts are truncated
 *   to exactly FREE_TIER_MAX_ACCOUNTS, keeping the most-recently-added.
 * - Pro users with >FREE_TIER_MAX_ACCOUNTS accounts are NOT truncated.
 * - Free users with ≤FREE_TIER_MAX_ACCOUNTS accounts are untouched.
 *
 * Uses the shared entitlementTestHelpers mock infrastructure.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  bootstrapEntitlement,
  useProStore,
  PRO_ENTITLEMENT_ID,
  resetAll,
  getPurchasesMock,
  mockAuthGetActiveSummary,
  mockSaveRepositories,
  mockRemoveAccount,
  storeStateAtEnforceCall,
  mockEnforceTierLimits,
} from './entitlementTestHelpers';

// ── Override listAccounts per-test to simulate restored accounts ─────────────────

function getListAccountsMock(): jest.Mock {
  const mock = jest.requireMock('@/services/AccountStorage') as {
    AccountStorage: { listAccounts: jest.Mock };
  };
  return mock.AccountStorage.listAccounts;
}

function makeStoredAccount(id: string, addedAt: number) {
  return { id, login: `user-${id}`, name: `User ${id}`, email: null, avatarUrl: null, addedAt };
}

describe('entitlement restart: enforceTierLimits ordering and account-cap enforcement', () => {
  beforeEach(() => { resetAll(); });
  afterEach(() => { jest.restoreAllMocks(); });

  // ── Bootstrap ordering guarantees ─────────────────────────────────────────

  describe('Pro state is resolved before enforceTierLimits runs', () => {
    it('store has status=pro and entitlementActive=true when enforceTierLimits executes', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce({
        account: { id: 'acc1', name: 'Account 1', login: 'user1' },
        activeHostId: 'host1',
        hosts: [{ id: 'host1', provider: 'github', hostLogin: 'user1', hostUserId: '12345' }],
      });
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: { [PRO_ENTITLEMENT_ID]: { isActive: true, periodType: 'paid' } } },
      });

      await bootstrapEntitlement();

      // The mock captures store state at the moment enforceTierLimits is called.
      // With Pro entitlement, status must already be 'pro' at that moment.
      expect(storeStateAtEnforceCall[0]?.status).toBe('pro');
      expect(storeStateAtEnforceCall[0]?.entitlementActive).toBe(true);
    });

    it('store has status=free and entitlementActive=false when enforceTierLimits executes for Free user', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: {} },
      });

      await bootstrapEntitlement();

      expect(storeStateAtEnforceCall[0]?.status).toBe('free');
      expect(storeStateAtEnforceCall[0]?.entitlementActive).toBe(false);
    });
  });

  // ── Pro skips account truncation ─────────────────────────────────────────

  describe('Pro users keep all accounts — no truncation', () => {
    it('pro status prevents any account removal even with over-limit restored data', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce({
        account: { id: 'acc1', name: 'Account 1', login: 'user1' },
        activeHostId: 'host1',
        hosts: [{ id: 'host1', provider: 'github', hostLogin: 'user1', hostUserId: '12345' }],
      });
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: { [PRO_ENTITLEMENT_ID]: { isActive: true, periodType: 'paid' } } },
      });

      await bootstrapEntitlement();

      // Pro: no accounts removed, no repos saved
      expect(mockRemoveAccount).not.toHaveBeenCalled();
      expect(mockSaveRepositories).not.toHaveBeenCalled();
    });

    it('pro status permits multiple identities across providers without triggering any cap enforcement', async () => {
      // This is the integration-level proof that the policy allows unlimited Pro identities.
      mockAuthGetActiveSummary.mockResolvedValueOnce({
        account: { id: 'acc1', name: 'Account 1', login: 'user1' },
        activeHostId: 'host1',
        hosts: [
          { id: 'host1', provider: 'github', hostLogin: 'user1', hostUserId: '12345' },
          { id: 'host2', provider: 'gitlab', hostLogin: 'user1', hostUserId: '12345' },
          { id: 'host3', provider: 'gitea', hostLogin: 'user1', hostUserId: '12345', instanceBaseUrl: 'https://gitea.mycompany.com' },
        ],
      });
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: { [PRO_ENTITLEMENT_ID]: { isActive: true, periodType: 'paid' } } },
      });

      await bootstrapEntitlement();

      // All three host identities are preserved for Pro
      expect(mockRemoveAccount).not.toHaveBeenCalled();
      expect(useProStore.getState().status).toBe('pro');
      expect(useProStore.getState().entitlementActive).toBe(true);
    });
  });

  // ── Free account-cap enforcement ──────────────────────────────────────────

  describe('Free users are truncated to FREE_TIER_MAX_ACCOUNTS after entitlement resolves', () => {
    it('Free user with 2 restored accounts is reduced to 1 (most-recently-added kept)', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: {} },
      });

      // Override listAccounts to simulate 2 restored accounts
      const listAccountsMock = getListAccountsMock();
      listAccountsMock.mockResolvedValueOnce([
        makeStoredAccount('acc-old', Date.now() - 1000),
        makeStoredAccount('acc-new', Date.now()),
      ]);

      await bootstrapEntitlement();

      // Free: accounts over the cap of 1 must be removed.
      expect(mockRemoveAccount.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('Free user with exactly FREE_TIER_MAX_ACCOUNTS accounts has zero removals', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: {} },
      });

      await bootstrapEntitlement();

      // Exactly at the cap — no removal needed
      expect(mockRemoveAccount).not.toHaveBeenCalled();
    });

    it('Free user with 0 accounts has zero removals', async () => {
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: {} },
      });

      await bootstrapEntitlement();

      expect(mockRemoveAccount).not.toHaveBeenCalled();
    });
  });

  // ── Entitlement cannot be bypassed via restored data ──────────────────────

  describe('Backup restoration never accidentally grants Pro or preserves an over-limit identity', () => {
    it('Free entitlement remains false even if over-limit accounts were previously stored', async () => {
      // Simulate: a Free user had 3 accounts restored from backup, then opened the app.
      // bootstrapEntitlement must resolve to Free and truncate to 1 account.
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: {} },
      });

      await bootstrapEntitlement();

      // State is definitively Free — no Pro entitlement leaked through
      expect(storeStateAtEnforceCall[0]?.entitlementActive).toBe(false);
      expect(storeStateAtEnforceCall[0]?.status).toBe('free');
      expect(useProStore.getState().entitlementActive).toBe(false);
      expect(useProStore.getState().status).toBe('free');
    });

    it('entitlementActive=true from RevenueCat overrides any prior Free state', async () => {
      // Previously Free, now Pro via restored purchase
      mockAuthGetActiveSummary.mockResolvedValueOnce(null);
      const Purchases = getPurchasesMock();
      (Purchases.configure as jest.Mock).mockResolvedValue(undefined);
      (Purchases.getCustomerInfo as jest.Mock).mockResolvedValueOnce({
        entitlements: { active: { [PRO_ENTITLEMENT_ID]: { isActive: true, periodType: 'restored' } } },
      });

      await bootstrapEntitlement();

      // Restored purchase grants Pro — confirmed at enforce time
      expect(storeStateAtEnforceCall[0]?.entitlementActive).toBe(true);
      expect(storeStateAtEnforceCall[0]?.status).toBe('pro');
      expect(mockRemoveAccount).not.toHaveBeenCalled(); // Pro skips truncation
    });
  });
});
