/**
 * Unit tests for canCreateAdditionalIdentity() policy.
 *
 * Host identity = accountId + provider + instanceBaseUrl.
 * Same host = credential update (always allowed).
 * New host on existing account = blocked for Free.
 * First host on new account = always allowed.
 *
 * Uses jest.spyOn on the actual module-level functions.
 */
import { beforeEach, describe, expect, it, jest, afterEach } from '@jest/globals';

jest.unmock('@/stores/proStore');
jest.unmock('@/services/TierLimits');
jest.unmock('@/services/AccountStorage');

const { useProStore } = jest.requireActual<typeof import('@/stores/proStore')>('@/stores/proStore');
const { canCreateAdditionalIdentity } = jest.requireActual<typeof import('@/services/TierLimits')>('@/services/TierLimits');
const { AccountStorage: AccountStorageActual } = jest.requireActual<typeof import('@/services/AccountStorage')>('@/services/AccountStorage');

function makeHost(
  accountId: string,
  provider: 'github' | 'gitlab' | 'gitea' | 'forgejo',
  instanceBaseUrl: string | null,
): import('@/services/AccountStorage').HostConnection {
  const normalizedUrl = instanceBaseUrl ? instanceBaseUrl.replace(/\/+$/, '') : null;
  const instanceKey = (normalizedUrl ?? 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    id: `${accountId}:${provider}:${instanceKey}`,
    accountId,
    provider,
    instanceBaseUrl,
    hostLogin: 'testuser',
    hostUserId: 12345,
    name: 'Test User',
    email: 'test@example.com',
    avatarUrl: null,
    addedAt: Date.now(),
  };
}

describe('canCreateAdditionalIdentity', () => {
  let listHostConnectionsSpy: jest.SpyInstance;
  let listAccountsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useProStore.setState({ status: 'free', entitlementActive: false });
    listHostConnectionsSpy = jest.spyOn(AccountStorageActual, 'listHostConnections');
    listAccountsSpy = jest.spyOn(AccountStorageActual, 'listAccounts');
  });

  afterEach(() => {
    listHostConnectionsSpy.mockRestore();
    listAccountsSpy.mockRestore();
  });

  it('returns true for Pro users regardless of host count', async () => {
    useProStore.setState({ status: 'pro', entitlementActive: true });
    listHostConnectionsSpy.mockResolvedValue([
      makeHost('acc-1', 'github', null),
      makeHost('acc-1', 'gitlab', null),
      makeHost('acc-2', 'github', null),
    ]);

    const result = await canCreateAdditionalIdentity('acc-1', 'github', null);
    expect(result).toBe(true);
  });

  it('returns true when same host already exists (credential update)', async () => {
    listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);

    const result = await canCreateAdditionalIdentity('acc-1', 'github', null);
    expect(result).toBe(true);
  });

  it('returns true when no hosts on account yet (first host allowed)', async () => {
    listHostConnectionsSpy.mockResolvedValue([makeHost('acc-other', 'github', null)]);

    const result = await canCreateAdditionalIdentity('acc-new', 'gitlab', null);
    expect(result).toBe(true);
  });

  it('returns false when a different host exists on the account (new host blocked)', async () => {
    listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);

    const result = await canCreateAdditionalIdentity('acc-1', 'gitlab', null);
    expect(result).toBe(false);
  });

  it('returns false when multiple hosts exist on the account', async () => {
    listHostConnectionsSpy.mockResolvedValue([
      makeHost('acc-1', 'github', null),
      makeHost('acc-1', 'gitlab', null),
    ]);

    const result = await canCreateAdditionalIdentity('acc-1', 'forgejo', null);
    expect(result).toBe(false);
  });

  it('returns true for same instanceBaseUrl on same provider (same host)', async () => {
    listHostConnectionsSpy.mockResolvedValue([
      makeHost('acc-1', 'gitlab', 'https://gitlab.mycompany.com'),
    ]);

    const result = await canCreateAdditionalIdentity('acc-1', 'gitlab', 'https://gitlab.mycompany.com');
    expect(result).toBe(true);
  });

  it('returns false when switching instanceBaseUrl on same provider (new host)', async () => {
    listHostConnectionsSpy.mockResolvedValue([
      makeHost('acc-1', 'gitlab', 'https://gitlab.mycompany.com'),
    ]);

    const result = await canCreateAdditionalIdentity('acc-1', 'gitlab', 'https://gitlab.other.com');
    expect(result).toBe(false);
  });

  it('allows Free user with no accounts to create first host', async () => {
    listHostConnectionsSpy.mockResolvedValue([]);

    const result = await canCreateAdditionalIdentity('acc-new', 'github', null);
    expect(result).toBe(true);
  });

  it('blocks Free user from fresh account when one account already exists', async () => {
    listAccountsSpy.mockResolvedValue([
      { id: 'acc-1', login: 'user1', name: 'U1', email: 'u1@ex.com', avatarUrl: '', addedAt: Date.now(), hostIds: [] },
    ]);

    const result = await canCreateAdditionalIdentity('__new__', 'github', null);
    expect(result).toBe(false);
  });

  it('allows Pro user to create a second+ fresh account (Path C regression)', async () => {
    useProStore.setState({ status: 'pro', entitlementActive: true });
    listAccountsSpy.mockResolvedValue([
      { id: 'acc-1', login: 'user1', name: 'U1', email: 'u1@ex.com', avatarUrl: '', addedAt: Date.now(), hostIds: [] },
      { id: 'acc-2', login: 'user2', name: 'U2', email: 'u2@ex.com', avatarUrl: '', addedAt: Date.now(), hostIds: [] },
    ]);

    const result = await canCreateAdditionalIdentity('__new__', 'github', null);
    expect(result).toBe(true);
  });
});
