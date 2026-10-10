/**
 * ReferralIdentityService TDD tests.
 *
 * These tests characterize the behavior of:
 * - Cryptographically secure installation ID generation via expo-crypto
 * - SecureStore persistence of installation ID
 * - Identity proof construction (GitHub OAuth preferred, installation fallback)
 * - SecureStore read/write failure handling
 *
 * Run with: yarn jest __tests__/services/ReferralIdentityService.test.ts --no-coverage --forceExit
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64', HEX: 'hex' },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Mock AccountStorage
jest.mock('../../src/services/AccountStorage', () => ({
  AccountStorage: {
    getOAuthCredential: jest.fn(),
    getActiveHostId: jest.fn(),
    getHostConnection: jest.fn(),
    getHostToken: jest.fn(),
  },
}));

import { ReferralIdentityService } from '../../src/services/ReferralIdentityService';
import { AccountStorage } from '../../src/services/AccountStorage';

const mockGetRandomBytesAsync = Crypto.getRandomBytesAsync as jest.Mock;
const mockSecureStoreGet = SecureStore.getItemAsync as jest.Mock;
const mockSecureStoreSet = SecureStore.setItemAsync as jest.Mock;
const mockSecureStoreDelete = SecureStore.deleteItemAsync as jest.Mock;
const mockGetOAuthCredential = AccountStorage.getOAuthCredential as jest.Mock;
const mockGetActiveHostId = AccountStorage.getActiveHostId as jest.Mock;
const mockGetHostConnection = AccountStorage.getHostConnection as jest.Mock;
const mockGetHostToken = AccountStorage.getHostToken as jest.Mock;

beforeEach(() => {
  mockGetRandomBytesAsync.mockReset();
  mockSecureStoreGet.mockReset();
  mockSecureStoreSet.mockReset();
  mockSecureStoreDelete.mockReset();
  mockGetOAuthCredential.mockReset();
  mockGetActiveHostId.mockReset();
  mockGetHostConnection.mockReset();
  mockGetHostToken.mockReset();
  mockGetRandomBytesAsync.mockImplementation(() => Promise.resolve(new Uint8Array(16)));
  mockSecureStoreGet.mockImplementation(() => Promise.resolve(null));
  mockSecureStoreSet.mockImplementation(() => Promise.resolve());
  mockSecureStoreDelete.mockImplementation(() => Promise.resolve());
  mockGetOAuthCredential.mockImplementation(() => Promise.resolve(null));
  mockGetActiveHostId.mockImplementation(() => Promise.resolve(null));
  mockGetHostConnection.mockImplementation(() => Promise.resolve(null));
  mockGetHostToken.mockImplementation(() => Promise.resolve(null));
});

describe('ReferralIdentityService installation ID', () => {
  it('generates installation ID using expo-crypto (not Math.random)', async () => {
    const uuidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      uuidBytes[i] = i;
    }
    mockGetRandomBytesAsync.mockResolvedValueOnce(uuidBytes);

    await ReferralIdentityService.getOrCreateInstallationId();

    expect(mockGetRandomBytesAsync).toHaveBeenCalledWith(16);
  });

  it('persists generated ID to SecureStore', async () => {
    const uuidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      uuidBytes[i] = i;
    }
    mockGetRandomBytesAsync.mockResolvedValueOnce(uuidBytes);

    await ReferralIdentityService.getOrCreateInstallationId();

    expect(mockSecureStoreSet).toHaveBeenCalledWith(
      'gitnotes_install_id',
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    );
  });

  it('returns cached ID on subsequent calls (not re-generated)', async () => {
    const cachedId = 'deadbeef-dead-beef-dead-beefdeadbeef';
    mockSecureStoreGet.mockImplementation(() => Promise.resolve(cachedId));

    const id1 = await ReferralIdentityService.getOrCreateInstallationId();
    const id2 = await ReferralIdentityService.getOrCreateInstallationId();

    expect(id1).toBe(cachedId);
    expect(id2).toBe(cachedId);
    expect(mockGetRandomBytesAsync).not.toHaveBeenCalled();
  });

  it('throws when SecureStore read fails (does NOT fallback to predictable ID)', async () => {
    mockSecureStoreGet.mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(ReferralIdentityService.getOrCreateInstallationId()).rejects.toThrow();
  });

  it('throws when SecureStore write fails (does NOT fallback to in-memory ID)', async () => {
    const uuidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      uuidBytes[i] = i;
    }
    mockGetRandomBytesAsync.mockResolvedValueOnce(uuidBytes);
    mockSecureStoreGet.mockResolvedValueOnce(null); // ID doesn't exist yet
    mockSecureStoreSet.mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(ReferralIdentityService.getOrCreateInstallationId()).rejects.toThrow();
  });

  it('does NOT use insecure fallback when both read and write fail', async () => {
    mockSecureStoreGet.mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(ReferralIdentityService.getOrCreateInstallationId()).rejects.toThrow(
      'SecureStore unavailable'
    );
  });
});

describe('ReferralIdentityService identity proof', () => {
  it('prefers GitHub OAuth token when available', async () => {
    const cachedId = 'install-cached-uuid-123';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce({
      kind: 'oauth',
      accessToken: 'gho_preferred_token',
      login: 'testuser',
    } as any);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('github');
    expect(proof.token).toBe('gho_preferred_token');
    expect((proof as any).installationId).toBe(cachedId);
  });

  it('falls back to GitHub PAT when no OAuth', async () => {
    const cachedId = 'install-pat-uuid-456';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce(null);
    mockGetHostToken.mockResolvedValueOnce('gho_pat_token');

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('github');
    expect(proof.token).toBe('gho_pat_token');
    expect((proof as any).installationId).toBe(cachedId);
  });

  it('falls back to installation-only when no GitHub credentials', async () => {
    const cachedId = 'install-only-uuid-456';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });

  it('falls back to installation when GitHub OAuth token is empty', async () => {
    const cachedId = 'install-empty-oauth-uuid';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce({
      kind: 'oauth',
      accessToken: '',
      login: 'testuser',
    } as any);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });

  it('falls back to installation when GitHub PAT is empty string', async () => {
    const cachedId = 'install-empty-pat-uuid';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce(null);
    mockGetHostToken.mockResolvedValueOnce('');

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });

  it('does NOT use GitLab/Gitea/Forgejo token as GitHub identity', async () => {
    const cachedId = 'install-non-gh-uuid';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('gitlab-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'gitlab' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce({
      kind: 'oauth',
      accessToken: 'gl_token',
      login: 'testuser',
    } as any);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });

  it('does NOT use GitHub App installation token as GitHub identity', async () => {
    const cachedId = 'install-app-only-uuid';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    // No OAuth credential, no PAT — only App installation token (not verifiable via /user)
    mockGetOAuthCredential.mockResolvedValueOnce(null);
    mockGetHostToken.mockResolvedValueOnce(null);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });

  it('always includes installationId alongside github token', async () => {
    const cachedId = 'install-both-uuid';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce({
      kind: 'oauth',
      accessToken: 'gho_with_install_id',
      login: 'testuser',
    } as any);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.kind).toBe('github');
    expect((proof as any).installationId).toBe(cachedId);
  });
});
