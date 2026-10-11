/**
 * ReferralService TDD tests.
 *
 * These tests characterize the behavior of:
 * - URL parsing (gitnotes://r/<code> and https://gitnotes.org/r/<code>)
 * - Cryptographically secure installation ID generation and SecureStore persistence
 * - Identity proof selection (GitHub OAuth token preferred, installation fallback)
 * - Pending referral code durable storage through cold start
 * - Referral completion called exactly once after first successful repo connection
 * - Idempotent / retry-safe completion
 * - Completion NOT triggered on auth success, clone start, failed clone, or failed push
 *
 * Run with: yarn jest __tests__/services/ReferralService.test.ts --no-coverage --forceExit
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Mock workerApi
jest.mock('../../src/services/workerApi', () => ({
  workerApi: {
    referrals: {
      complete: jest.fn(),
    },
  },
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

// Direct mock replacement — replaces jest.fn() references with fresh instances
// to avoid spy/restoreAllMocks state machine issues.


// Import after mocks are set up
import { ReferralService } from '../../src/services/ReferralService';
import { ReferralIdentityService } from '../../src/services/ReferralIdentityService';
import { workerApi } from '../../src/services/workerApi';
import { AccountStorage } from '../../src/services/AccountStorage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const mockGetRandomBytesAsync = Crypto.getRandomBytesAsync as jest.Mock;
const mockSecureStoreGet = SecureStore.getItemAsync as jest.Mock;
const mockSecureStoreSet = SecureStore.setItemAsync as jest.Mock;
const mockSecureStoreDelete = SecureStore.deleteItemAsync as jest.Mock;
const mockComplete = workerApi.referrals.complete as jest.Mock;
const mockGetOAuthCredential = AccountStorage.getOAuthCredential as jest.Mock;
const mockGetActiveHostId = AccountStorage.getActiveHostId as jest.Mock;
const mockGetHostConnection = AccountStorage.getHostConnection as jest.Mock;
const mockGetHostToken = AccountStorage.getHostToken as jest.Mock;

const INSTALL_ID_KEY = 'gitnotes_install_id';
const PENDING_CODE_KEY = '@gitnotes:referral_pending_code';

// In-memory AsyncStorage store for test isolation
let asyncStorageStore: Record<string, string> = {};

beforeEach(() => {
  mockGetRandomBytesAsync.mockReset();
  mockSecureStoreGet.mockReset();
  mockSecureStoreSet.mockReset();
  mockSecureStoreDelete.mockReset();
  mockComplete.mockReset();
  mockGetOAuthCredential.mockReset();
  mockGetActiveHostId.mockReset();
  mockGetHostConnection.mockReset();
  mockGetHostToken.mockReset();
  mockGetRandomBytesAsync.mockImplementation(() => Promise.resolve(new Uint8Array(16)));
  mockSecureStoreGet.mockImplementation(() => Promise.resolve(null));
  mockSecureStoreSet.mockImplementation(() => Promise.resolve());
  mockSecureStoreDelete.mockImplementation(() => Promise.resolve());
  mockComplete.mockImplementation(() => Promise.resolve({ accepted: true }));
  mockGetOAuthCredential.mockImplementation(() => Promise.resolve(null));
  mockGetActiveHostId.mockImplementation(() => Promise.resolve(null));
  mockGetHostConnection.mockImplementation(() => Promise.resolve(null));
  mockGetHostToken.mockImplementation(() => Promise.resolve(null));
  // Fresh in-memory AsyncStorage for each test.
  asyncStorageStore = {};
  // Replace AsyncStorage mock methods with fresh jest.fn() implementations using our store.
  AsyncStorage.getItem = jest.fn(
    async (key: string) => asyncStorageStore[key] ?? null
  ) as typeof AsyncStorage.getItem;
  AsyncStorage.setItem = jest.fn(
    async (key: string, value: string) => { asyncStorageStore[key] = value; }
  ) as typeof AsyncStorage.setItem;
  AsyncStorage.removeItem = jest.fn(
    async (key: string) => { delete asyncStorageStore[key]; }
  ) as typeof AsyncStorage.removeItem;
  AsyncStorage.clear = jest.fn(
    async () => { asyncStorageStore = {}; }
  ) as typeof AsyncStorage.clear;
  ReferralService.resetFirstRepoCompletion();
});

describe('ReferralService URL parsing', () => {
  describe('parseDeepLink', () => {
    it('parses gitnotes://r/<code> custom scheme', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/qa-code-1771');
      expect(result).toBe('qa-code-1771');
    });

    it('parses gitnotes://r/<code> with no trailing slash', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/myreferral');
      expect(result).toBe('myreferral');
    });

    it('parses https://gitnotes.org/r/<code> HTTPS form', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/test-code-42');
      expect(result).toBe('test-code-42');
    });

    it('returns null for empty code in gitnotes://r/', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/');
      expect(result).toBeNull();
    });

    it('returns null for empty code in https://gitnotes.org/r/', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/');
      expect(result).toBeNull();
    });

    it('returns null for gitnotes://oauth/callback (wrong path)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://oauth/callback?code=abc');
      expect(result).toBeNull();
    });

    it('returns null for gitnotes://app/callback (wrong path)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://app/callback?installation_id=123');
      expect(result).toBeNull();
    });

    it('returns null for arbitrary gitnotes:// paths', () => {
      const result = ReferralService.parseDeepLink('gitnotes://home');
      expect(result).toBeNull();
    });

    it('returns null for non-gitnotes URLs', () => {
      const result = ReferralService.parseDeepLink('https://github.com/skepjandi/gitnotes');
      expect(result).toBeNull();
    });

    it('returns null for malformed URLs', () => {
      const result = ReferralService.parseDeepLink('not-a-url');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = ReferralService.parseDeepLink('');
      expect(result).toBeNull();
    });

    it('returns null for URL with path traversal attempt', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/../etc/passwd');
      expect(result).toBeNull();
    });

    it('trims trailing whitespace from code', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/qa-code-1771  ');
      expect(result).toBe('qa-code-1771');
    });

    it('accepts alphanumeric and hyphen code characters', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc123-XYZ-789');
      expect(result).toBe('abc123-XYZ-789');
    });

    it('accepts underscore in code (URL-safe base64)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc_123_XYZ');
      expect(result).toBe('abc_123_XYZ');
    });

    it('returns null for code with spaces', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/my referral');
      expect(result).toBeNull();
    });

    it('returns null for code containing colon (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc:def');
      expect(result).toBeNull();
    });

    it('returns null for code containing at-sign (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc@def');
      expect(result).toBeNull();
    });

    it('returns null for code containing equals (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc=def');
      expect(result).toBeNull();
    });

    it('returns null for code containing question mark (query string delimiter)', () => {
      // The ? character is interpreted by URL() as starting a query string.
      // parseDeepLink now rejects any URL with a search component.
      const result = ReferralService.parseDeepLink('gitnotes://r/abc?def');
      expect(result).toBeNull();
    });

    it('returns null for URL with explicit query string', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc?code=evil');
      expect(result).toBeNull();
    });

    it('returns null for URL with fragment', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc#fragment');
      expect(result).toBeNull();
    });

    it('returns null for code containing square brackets (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc[def]');
      expect(result).toBeNull();
    });

    it('returns null for code containing backslash (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc\\def');
      expect(result).toBeNull();
    });

    it('returns null for code containing caret (legal ASCII range from hyphen bug)', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc^def');
      expect(result).toBeNull();
    });

    it('accepts hyphen as code character', () => {
      const result = ReferralService.parseDeepLink('gitnotes://r/abc-def-123');
      expect(result).toBe('abc-def-123');
    });
  });
});

describe('ReferralService installation ID', () => {
  it('generates installation ID using expo-crypto (not Math.random)', async () => {
    const uuidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      uuidBytes[i] = i;
    }
    mockGetRandomBytesAsync.mockResolvedValueOnce(uuidBytes);

    await ReferralService.getOrCreateInstallationId();

    expect(mockGetRandomBytesAsync).toHaveBeenCalledWith(16);
  });

  it('persists generated ID to SecureStore', async () => {
    const uuidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      uuidBytes[i] = i;
    }
    mockGetRandomBytesAsync.mockResolvedValueOnce(uuidBytes);

    await ReferralService.getOrCreateInstallationId();

    expect(mockSecureStoreSet).toHaveBeenCalledWith(
      INSTALL_ID_KEY,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    );
  });

  it('returns cached ID on subsequent calls (not re-generated)', async () => {
    const cachedId = 'deadbeef-dead-beef-dead-beefdeadbeef';
    mockSecureStoreGet.mockImplementation(() => Promise.resolve(cachedId));

    const id1 = await ReferralService.getOrCreateInstallationId();
    const id2 = await ReferralService.getOrCreateInstallationId();

    expect(id1).toBe(cachedId);
    expect(id2).toBe(cachedId);
    expect(mockGetRandomBytesAsync).not.toHaveBeenCalled();
  });

  it('throws when SecureStore is unavailable (does NOT fallback to predictable ID)', async () => {
    mockSecureStoreGet.mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(ReferralService.getOrCreateInstallationId()).rejects.toThrow();
  });
});

describe('ReferralService identity proof', () => {
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

    const proof = await ReferralService.getIdentityProof();

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

    const proof = await ReferralService.getIdentityProof();

    expect(proof.kind).toBe('github');
    expect(proof.token).toBe('gho_pat_token');
    expect((proof as any).installationId).toBe(cachedId);
  });

  it('falls back to installation-only when no GitHub credentials', async () => {
    const cachedId = 'install-only-uuid-456';
    mockSecureStoreGet.mockResolvedValueOnce(cachedId);

    const proof = await ReferralService.getIdentityProof();

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

    const proof = await ReferralService.getIdentityProof();

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

    const proof = await ReferralService.getIdentityProof();

    expect(proof.kind).toBe('installation');
    expect(proof.installationId).toBe(cachedId);
  });
});

describe('ReferralService pending code storage', () => {
  it('stores pending code with expiry in AsyncStorage', async () => {
    const expiresAt = Date.now() + 86400000;
    await ReferralService.storePendingCode('pending-code-abc', expiresAt);

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('pending-code-abc');
    expect(parsed.expiresAt).toBe(expiresAt);
  });

  it('retrieves stored pending code', async () => {
    const expiresAt = Date.now() + 86400000;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'retrieved-code', expiresAt })
    );

    const result = await ReferralService.getPendingCode();
    expect(result?.code).toBe('retrieved-code');
    expect(result?.expiresAt).toBe(expiresAt);
  });

  it('retrieves null when no pending code stored', async () => {
    const result = await ReferralService.getPendingCode();
    expect(result).toBeNull();
  });

  it('retrieves null when pending code has expired', async () => {
    const expiredAt = Date.now() - 1000;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'expired-code', expiresAt: expiredAt })
    );

    const result = await ReferralService.getPendingCode();
    expect(result).toBeNull();
  });

  it('retrieves null when expiresAt equals Date.now() (server expiry boundary)', async () => {
    // Server contract: now >= expiresAt means expired. Date.now() === expiresAt must be treated as expired.
    const boundaryTime = Date.now();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'boundary-code', expiresAt: boundaryTime })
    );

    const result = await ReferralService.getPendingCode();
    expect(result).toBeNull();
  });

  it('clears pending code from storage', async () => {
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'to-clear', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.clearPendingCode();

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('preserves existing pending code when storing new one (no overwrite)', async () => {
    const oldExpiry = Date.now() + 86400000;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'existing-code', expiresAt: oldExpiry })
    );

    await ReferralService.storePendingCode('new-code', Date.now() + 86400000);

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('existing-code');
  });

  it('overwrites expired pending code with new one', async () => {
    const expiredAt = Date.now() - 1000;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'expired-code', expiresAt: expiredAt })
    );

    await ReferralService.storePendingCode('new-code', Date.now() + 86400000);

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('new-code');
  });
});

describe('ReferralService referral completion', () => {
  beforeEach(() => {
    mockComplete.mockImplementation(() => Promise.resolve({ accepted: true }));
  });

  it('calls workerApi.referrals.complete with code and identity proof', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();

    const result = await ReferralService.completeReferral('test-code-xyz');

    expect(mockComplete).toHaveBeenCalledWith(
      { code: 'test-code-xyz' },
      expect.objectContaining({ kind: 'installation' })
    );
    expect(result).toEqual({ accepted: true });
  });

  it('clears pending code after successful completion', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'test-code-xyz', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.completeReferral('test-code-xyz');

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('does NOT throw when completion fails (retry-able)', async () => {
    mockComplete.mockImplementationOnce(() => Promise.reject(new Error('Network error')));
    await ReferralService.setFirstRepoPending();

    const result = await ReferralService.completeReferral('test-code-xyz');

    expect(result).toBeUndefined();
  });

  it('tracks first-repo completion state (pending → connected on accepted)', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();

    expect(await ReferralService.hasCompletedFirstRepo()).toBe(false);

    await ReferralService.completeReferral('first-code');

    expect(await ReferralService.hasCompletedFirstRepo()).toBe(true);
  });

  it('completion is idempotent - second call does not call workerApi again', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();

    await ReferralService.completeReferral('first-code');
    await ReferralService.completeReferral('first-code');

    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('uses stored pending code when called with no arguments', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'stored-pending-code', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.completeReferral();

    expect(mockComplete).toHaveBeenCalledWith(
      { code: 'stored-pending-code' },
      expect.any(Object)
    );
  });

  it('does NOT mark completed when accepted is false', async () => {
    mockComplete.mockImplementationOnce(() => Promise.resolve({ accepted: false }));
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'rejected-code', expiresAt: Date.now() + 86400000 })
    );

    const result = await ReferralService.completeReferral('rejected-code');

    expect(result?.accepted).toBe(false);
    expect(await ReferralService.hasCompletedFirstRepo()).toBe(false);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).not.toBeNull();
  });
});

describe('ReferralService onFirstRepoCloneSuccess integration', () => {
  beforeEach(() => {
    mockComplete.mockImplementation(() => Promise.resolve({ accepted: true }));
  });

  it('calls completeReferral when first repo clone succeeds (status=pending)', async () => {
    mockSecureStoreGet.mockResolvedValue('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'onboard-code', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).toHaveBeenCalled();
  });

  it('does NOT call completeReferral when no pending code BUT marks connected', async () => {
    await ReferralService.setFirstRepoPending();

    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).not.toHaveBeenCalled();
    expect(await ReferralService.getFirstRepoStatus()).toBe('connected');
  });

  it('is no-op when status is unknown (not pending)', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');

    // Status is 'unknown' (fresh install, no add started)
    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('is no-op when already connected', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoConnected();

    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('second repo add after first success does NOT call completeReferral (already connected)', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    // First repo succeeded with no pending code → status is connected
    await ReferralService.setFirstRepoPending();
    await ReferralService.onFirstRepoCloneSuccess(); // no pending code, sets connected

    // Second repo add — calls onFirstRepoCloneSuccess again
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('failed clone leaves status pending — retry when saved failed repo exists still calls completeReferral', async () => {
    // Simulate: first attempt, clone failed, status is pending
    await ReferralService.setFirstRepoPending();
    // (clone fails here, onFirstRepoCloneSuccess never called)
    // Simulate saved failed repo row in AsyncStorage (persisted by GitService.addRepository)
    // On retry, isFirstRepo = false so setFirstRepoPending is NOT called again
    // But status is still 'pending' from first attempt
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'retry-code', expiresAt: Date.now() + 86400000 })
    );

    // Retry succeeds
    await ReferralService.onFirstRepoCloneSuccess();

    expect(mockComplete).toHaveBeenCalledWith(
      { code: 'retry-code' },
      expect.objectContaining({ kind: 'installation' })
    );
  });

  it('first success with no pending code marks connected permanently — second add never re-triggers', async () => {
    // First clone success, no pending code
    await ReferralService.setFirstRepoPending();
    await ReferralService.onFirstRepoCloneSuccess(); // no pending code
    expect(await ReferralService.getFirstRepoStatus()).toBe('connected');

    // Second repo add — status is already connected
    await ReferralService.onFirstRepoCloneSuccess();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

const FIRST_REPO_STATUS_KEY = '@gitnotes:first_repo_status';

describe('ReferralService first-repo eligibility state machine', () => {
  beforeEach(() => {
    // Reset status before each test
    asyncStorageStore = {};
    ReferralService.resetFirstRepoCompletion();
  });

  it('initializeFirstRepoStatus with existing repos sets connected', async () => {
    const result = await ReferralService.initializeFirstRepoStatus(3);

    expect(result).toBe('connected');
    const stored = await AsyncStorage.getItem(FIRST_REPO_STATUS_KEY);
    expect(stored).toBe('connected');
  });

  it('initializeFirstRepoStatus with zero repos leaves unknown', async () => {
    const result = await ReferralService.initializeFirstRepoStatus(0);

    expect(result).toBe('unknown');
    const stored = await AsyncStorage.getItem(FIRST_REPO_STATUS_KEY);
    expect(stored).toBeNull();
  });

  it('initializeFirstRepoStatus with pending status leaves pending unchanged', async () => {
    await ReferralService.setFirstRepoPending();

    const result = await ReferralService.initializeFirstRepoStatus(0);

    expect(result).toBe('pending');
  });

  it('initializeFirstRepoStatus with connected status leaves connected unchanged', async () => {
    await ReferralService.setFirstRepoConnected();

    const result = await ReferralService.initializeFirstRepoStatus(5);

    expect(result).toBe('connected');
  });

  it('setFirstRepoPending persists pending status', async () => {
    await ReferralService.setFirstRepoPending();

    const status = await ReferralService.getFirstRepoStatus();
    expect(status).toBe('pending');
  });

  it('setFirstRepoConnected persists connected status', async () => {
    await ReferralService.setFirstRepoConnected();

    const status = await ReferralService.getFirstRepoStatus();
    expect(status).toBe('connected');
  });

  it('hasCompletedFirstRepo returns false when unknown', async () => {
    const result = await ReferralService.hasCompletedFirstRepo();
    expect(result).toBe(false);
  });

  it('hasCompletedFirstRepo returns true when connected', async () => {
    await ReferralService.setFirstRepoConnected();

    const result = await ReferralService.hasCompletedFirstRepo();
    expect(result).toBe(true);
  });

  it('hasCompletedFirstRepo returns false when pending', async () => {
    await ReferralService.setFirstRepoPending();

    const result = await ReferralService.hasCompletedFirstRepo();
    expect(result).toBe(false);
  });

  it('completeReferral returns undefined when status is unknown', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'test-code', expiresAt: Date.now() + 86400000 })
    );

    const result = await ReferralService.completeReferral('test-code');

    expect(result).toBeUndefined();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('completeReferral returns undefined when status is connected (idempotent)', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoConnected();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'test-code', expiresAt: Date.now() + 86400000 })
    );

    const result = await ReferralService.completeReferral('test-code');

    expect(result).toBeUndefined();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('completeReferral calls workerApi when status is pending', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'pending-code', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.completeReferral('pending-code');

    expect(mockComplete).toHaveBeenCalledWith(
      { code: 'pending-code' },
      expect.objectContaining({ kind: 'installation' })
    );
  });

  it('completeReferral sets status to connected on accepted', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();

    await ReferralService.completeReferral('any-code');

    const status = await ReferralService.getFirstRepoStatus();
    expect(status).toBe('connected');
  });

  it('completeReferral keeps status pending when accepted is false (retry-able)', async () => {
    mockComplete.mockImplementationOnce(() => Promise.resolve({ accepted: false }));
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    await ReferralService.setFirstRepoPending();
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'rejected-code', expiresAt: Date.now() + 86400000 })
    );

    await ReferralService.completeReferral('rejected-code');

    const status = await ReferralService.getFirstRepoStatus();
    expect(status).toBe('pending');
  });

  it('resetFirstRepoCompletion clears status to unknown', async () => {
    await ReferralService.setFirstRepoConnected();
    await ReferralService.setFirstRepoPending();

    await ReferralService.resetFirstRepoCompletion();

    const status = await ReferralService.getFirstRepoStatus();
    expect(status).toBe('unknown');
  });
});

describe('ReferralService captureReferralUrl', () => {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  it('returns true and stores code for gitnotes://r/<code> (cold-start custom URL)', async () => {
    const result = await ReferralService.captureReferralUrl('gitnotes://r/qa-code-1771');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('qa-code-1771');
    expect(parsed.expiresAt).toBeGreaterThan(Date.now());
    expect(parsed.expiresAt).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS_MS);
  });

  it('returns true and stores code for https://gitnotes.org/r/<code> (cold-start HTTPS URL)', async () => {
    const result = await ReferralService.captureReferralUrl('https://gitnotes.org/r/test-code-42');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('test-code-42');
  });

  it('returns false and stores nothing for non-referral URL', async () => {
    const result = await ReferralService.captureReferralUrl('https://github.com/skepjandi/gitnotes');

    expect(result).toBe(false);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('returns false for gitnotes://oauth/callback (non-referral path)', async () => {
    const result = await ReferralService.captureReferralUrl('gitnotes://oauth/callback?code=abc');

    expect(result).toBe(false);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('accepts underscore in code (URL-safe base64, Worker-produced codes)', async () => {
    const result = await ReferralService.captureReferralUrl('gitnotes://r/abc_123_XYZ_abc');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('abc_123_XYZ_abc');
  });

  it('returns false for path traversal attempt', async () => {
    const result = await ReferralService.captureReferralUrl('gitnotes://r/../etc/passwd');

    expect(result).toBe(false);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('returns false for malformed URL', async () => {
    const result = await ReferralService.captureReferralUrl('not-a-url');

    expect(result).toBe(false);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    expect(stored).toBeNull();
  });

  it('returns false for empty string', async () => {
    const result = await ReferralService.captureReferralUrl('');

    expect(result).toBe(false);
  });

  it('returns false for code with spaces (even URL-encoded)', async () => {
    const result = await ReferralService.captureReferralUrl('gitnotes://r/my%20referral');

    expect(result).toBe(false);
  });

  it('preserves existing valid pending code when capturing a new one', async () => {
    const oldExpiry = Date.now() + THIRTY_DAYS_MS;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'existing-code', expiresAt: oldExpiry })
    );

    const result = await ReferralService.captureReferralUrl('gitnotes://r/new-code');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('existing-code');
  });

  it('overwrites expired pending code with new code', async () => {
    const expiredAt = Date.now() - 1000;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'expired-code', expiresAt: expiredAt })
    );

    const result = await ReferralService.captureReferralUrl('gitnotes://r/fresh-code');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('fresh-code');
  });

  it('sets 30-day local maximum expiry', async () => {
    const before = Date.now();
    await ReferralService.captureReferralUrl('gitnotes://r/thirty-day-code');
    const after = Date.now();

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS);
    expect(parsed.expiresAt).toBeLessThanOrEqual(after + THIRTY_DAYS_MS);
  });
});

describe('ReferralService no unwanted side effects', () => {
  it('does NOT call completion on auth success (connectHost)', async () => {
    await ReferralIdentityService.getIdentityProof();

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('getIdentityProof does NOT send token in body or log it', async () => {
    mockSecureStoreGet.mockResolvedValueOnce('install-id-789');
    mockGetActiveHostId.mockResolvedValueOnce('github-host-123');
    mockGetHostConnection.mockResolvedValueOnce({ provider: 'github' } as any);
    mockGetOAuthCredential.mockResolvedValueOnce({
      kind: 'oauth',
      accessToken: 'gho_secret_token_123',
      login: 'testuser',
    } as any);

    const proof = await ReferralIdentityService.getIdentityProof();

    expect(proof.token).toBe('gho_secret_token_123');
  });
});

describe('ReferralService HTTPS URL parsing edge cases', () => {
  describe('parseDeepLink HTTPS variants', () => {
    it('parses https://www.gitnotes.org/r/<code> with www prefix', () => {
      const result = ReferralService.parseDeepLink('https://www.gitnotes.org/r/www-code');
      expect(result).toBe('www-code');
    });

    it('returns null for https://gitnotes.org/r/ with empty code', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org/r/.. (path traversal)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/../etc/passwd');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org/r/code?query (query string)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/code?evil=true');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org/r/code#fragment (fragment)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/code#fragment');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org/r/code/ (trailing slash)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/code/');
      expect(result).toBeNull();
    });

    it('trims whitespace from HTTPS URL code', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/https-code  ');
      expect(result).toBe('https-code');
    });

    it('accepts underscore in HTTPS URL code', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/r/https_code_123');
      expect(result).toBe('https_code_123');
    });

    it('returns null for non-gitnotes.org HTTPS URLs', () => {
      const result = ReferralService.parseDeepLink('https://example.com/r/code');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org (no /r/ path)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org');
      expect(result).toBeNull();
    });

    it('returns null for https://gitnotes.org/home (wrong path)', () => {
      const result = ReferralService.parseDeepLink('https://gitnotes.org/home');
      expect(result).toBeNull();
    });
  });
});

describe('ReferralService cold-start and runtime URL delivery', () => {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  it('captureReferralUrl handles cold-start HTTPS URL (Linking.getInitialURL simulation)', async () => {
    // Simulates: app launched via https://gitnotes.org/r/cold-start-code
    const result = await ReferralService.captureReferralUrl('https://gitnotes.org/r/cold-start-code');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('cold-start-code');
  });

  it('captureReferralUrl handles cold-start custom scheme URL (Linking.getInitialURL simulation)', async () => {
    // Simulates: app launched via gitnotes://r/cold-start-custom
    const result = await ReferralService.captureReferralUrl('gitnotes://r/cold-start-custom');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('cold-start-custom');
  });

  it('captureReferralUrl handles runtime URL (Linking.addEventListener simulation)', async () => {
    // Simulates: user clicks referral link while app is in foreground
    const result = await ReferralService.captureReferralUrl('https://gitnotes.org/r/runtime-code');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('runtime-code');
  });

  it('captureReferralUrl sets 30-day local expiry for cold-start URL', async () => {
    const before = Date.now();
    await ReferralService.captureReferralUrl('https://gitnotes.org/r/expiry-test');
    const after = Date.now();

    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS);
    expect(parsed.expiresAt).toBeLessThanOrEqual(after + THIRTY_DAYS_MS);
  });

  it('pending code survives cold start (persists across app restarts)', async () => {
    // Store a pending code as if it was captured during a previous cold start
    const existingExpiry = Date.now() + THIRTY_DAYS_MS;
    await AsyncStorage.setItem(
      PENDING_CODE_KEY,
      JSON.stringify({ code: 'survived-cold-start', expiresAt: existingExpiry })
    );

    // Simulate app restart - captureReferralUrl should not overwrite valid pending code
    const result = await ReferralService.captureReferralUrl('https://gitnotes.org/r/new-code');

    expect(result).toBe(true);
    const stored = await AsyncStorage.getItem(PENDING_CODE_KEY);
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe('survived-cold-start'); // Old code preserved
  });
});
