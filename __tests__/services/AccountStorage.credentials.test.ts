/**
 * Tests for per-kind credential removal in AccountStorage.
 *
 * Setup uses public storage APIs to mirror production:
 * - OAuth and GitHub App credentials: stored via SecureStore + indexed via HOST_CREDENTIALS_KEY
 * - PAT and SSH: stored via SecureStore only (writeHostToken/writeSshKey do NOT update index)
 *
 * The removeCredential implementation checks actual storage presence for all four
 * credential kinds to determine whether to call removeHostConnection.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  GitHubOAuthCredentialRecord,
  GitHubAppCredentialRecord,
} from '@/services/git/contracts';
import { AccountStorage } from '@/services/AccountStorage';
import * as SecureStore from 'expo-secure-store';

const HOST_ID = 'acc-test:github.com:default';
const OAUTH_ID = 'acc-test:github.com:default:oauth';
const APP_ID = 'acc-test:github.com:default:github_app';
const HOST_CREDENTIALS_KEY = '@gitnotes:host_credential_ids';

const NATIVE_OAUTH_KEY = `gitnotes_oauth_cred_${HOST_ID.replace(/[^A-Za-z0-9_]/g, '_')}`;
const NATIVE_APP_KEY = `gitnotes_gh_app_cred_${HOST_ID.replace(/[^A-Za-z0-9_]/g, '_')}`;
const NATIVE_TOKEN_KEY = `gitnotes_account_token_gitnotes_host_token_${HOST_ID.replace(/[^A-Za-z0-9_]/g, '_')}`;
const NATIVE_SSH_PRIVATE_KEY = `gitnotes_ssh_private_${HOST_ID.replace(/[^A-Za-z0-9_]/g, '_')}`;
const NATIVE_SSH_PUBLIC_KEY = `gitnotes_ssh_public_${HOST_ID.replace(/[^A-Za-z0-9_]/g, '_')}`;

function makeOAuthRecord(id: string): GitHubOAuthCredentialRecord {
  return {
    id,
    hostId: HOST_ID,
    kind: 'oauth',
    addedAt: Date.now(),
    accessToken: 'gho_test_token',
    login: 'testuser',
    userId: 12345,
    expiresAt: Date.now() + 3600 * 1000,
    renewal: {
      refreshToken: 'refresh_handle',
      refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
      backendUrl: 'https://gitnotes-backend.example.com',
    },
  };
}

function makeAppRecord(id: string): GitHubAppCredentialRecord {
  return {
    id,
    hostId: HOST_ID,
    kind: 'github_app',
    addedAt: Date.now(),
    installationId: 123456,
    appId: 98765,
    appSlug: 'gitnotes-test-app',
    accountLogin: 'testorg',
    accountId: 555,
    selectedRepositories: [{ owner: 'testorg', repo: 'notes' }],
    token: 'ghs_install_token',
    expiresAt: Date.now() + 3600 * 1000,
    renewal: {
      grantToken: 'grant_handle',
      grantExpiresAt: Date.now() + 3600 * 1000,
      backendUrl: 'https://gitnotes-backend.example.com',
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(async () => {
  await SecureStore.clear();
});

describe('AccountStorage.removeCredential', () => {
  describe('oauth credential removal', () => {
    it('removes the OAuth credential when kind is "oauth"', async () => {
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      await AsyncStorage.setItem(HOST_CREDENTIALS_KEY, JSON.stringify({ [HOST_ID]: [OAUTH_ID] }));

      const result = await AccountStorage.removeCredential(HOST_ID, 'oauth');

      expect(result.hostRemoved).toBe(true);
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).toBeNull();
      const index = await AsyncStorage.getItem(HOST_CREDENTIALS_KEY);
      expect(JSON.parse(index ?? '{}')).not.toHaveProperty(HOST_ID);
    });

    it('preserves other credential kinds when removing OAuth', async () => {
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await SecureStore.setItemAsync(NATIVE_TOKEN_KEY, 'pat_token');
      await SecureStore.setItemAsync(NATIVE_SSH_PRIVATE_KEY, 'private_key');
      await SecureStore.setItemAsync(NATIVE_SSH_PUBLIC_KEY, 'public_key');
      await AsyncStorage.setItem(
        HOST_CREDENTIALS_KEY,
        JSON.stringify({ [HOST_ID]: [OAUTH_ID, APP_ID] }),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'oauth');

      expect(result.hostRemoved).toBe(false);
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).not.toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_TOKEN_KEY)).toBe('pat_token');
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PRIVATE_KEY)).toBe('private_key');
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PUBLIC_KEY)).toBe('public_key');
      const index = JSON.parse((await AsyncStorage.getItem(HOST_CREDENTIALS_KEY)) ?? '{}');
      expect(index[HOST_ID]).toHaveLength(1);
      expect(index[HOST_ID]).not.toContain(OAUTH_ID);
    });
  });

  describe('github_app credential removal', () => {
    it('removes the GitHub App credential when kind is "github_app"', async () => {
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await AsyncStorage.setItem(HOST_CREDENTIALS_KEY, JSON.stringify({ [HOST_ID]: [APP_ID] }));

      const result = await AccountStorage.removeCredential(HOST_ID, 'github_app');

      expect(result.hostRemoved).toBe(true);
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).toBeNull();
      const index = await AsyncStorage.getItem(HOST_CREDENTIALS_KEY);
      expect(JSON.parse(index ?? '{}')).not.toHaveProperty(HOST_ID);
    });

    it('preserves other credential kinds when removing GitHub App', async () => {
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await SecureStore.setItemAsync(NATIVE_TOKEN_KEY, 'pat_token');
      await SecureStore.setItemAsync(NATIVE_SSH_PRIVATE_KEY, 'private_key');
      await SecureStore.setItemAsync(NATIVE_SSH_PUBLIC_KEY, 'public_key');
      await AsyncStorage.setItem(
        HOST_CREDENTIALS_KEY,
        JSON.stringify({ [HOST_ID]: [OAUTH_ID, APP_ID] }),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'github_app');

      expect(result.hostRemoved).toBe(false);
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).not.toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_TOKEN_KEY)).toBe('pat_token');
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PRIVATE_KEY)).toBe('private_key');
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PUBLIC_KEY)).toBe('public_key');
      const index = JSON.parse((await AsyncStorage.getItem(HOST_CREDENTIALS_KEY)) ?? '{}');
      expect(index[HOST_ID]).toHaveLength(1);
      expect(index[HOST_ID]).not.toContain(APP_ID);
    });
  });

  describe('token credential removal', () => {
    it('removes the host token when kind is "token"', async () => {
      await SecureStore.setItemAsync(NATIVE_TOKEN_KEY, 'pat_token');

      const result = await AccountStorage.removeCredential(HOST_ID, 'token');

      expect(result.hostRemoved).toBe(true);
      expect(await SecureStore.getItemAsync(NATIVE_TOKEN_KEY)).toBeNull();
    });

    it('preserves OAuth and App credentials when removing token', async () => {
      await SecureStore.setItemAsync(NATIVE_TOKEN_KEY, 'pat_token');
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await AsyncStorage.setItem(
        HOST_CREDENTIALS_KEY,
        JSON.stringify({ [HOST_ID]: [OAUTH_ID, APP_ID] }),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'token');

      expect(result.hostRemoved).toBe(false);
      expect(await SecureStore.getItemAsync(NATIVE_TOKEN_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).not.toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).not.toBeNull();
      const index = JSON.parse((await AsyncStorage.getItem(HOST_CREDENTIALS_KEY)) ?? '{}');
      expect(index[HOST_ID]).toHaveLength(2);
    });
  });

  describe('ssh credential removal', () => {
    it('removes SSH key pair when kind is "ssh"', async () => {
      await SecureStore.setItemAsync(NATIVE_SSH_PRIVATE_KEY, 'private_key');
      await SecureStore.setItemAsync(NATIVE_SSH_PUBLIC_KEY, 'public_key');

      const result = await AccountStorage.removeCredential(HOST_ID, 'ssh');

      expect(result.hostRemoved).toBe(true);
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PRIVATE_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PUBLIC_KEY)).toBeNull();
    });

    it('preserves OAuth and App credentials when removing SSH', async () => {
      await SecureStore.setItemAsync(NATIVE_SSH_PRIVATE_KEY, 'private_key');
      await SecureStore.setItemAsync(NATIVE_SSH_PUBLIC_KEY, 'public_key');
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await AsyncStorage.setItem(
        HOST_CREDENTIALS_KEY,
        JSON.stringify({ [HOST_ID]: [OAUTH_ID, APP_ID] }),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'ssh');

      expect(result.hostRemoved).toBe(false);
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PRIVATE_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_SSH_PUBLIC_KEY)).toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).not.toBeNull();
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).not.toBeNull();
      const index = JSON.parse((await AsyncStorage.getItem(HOST_CREDENTIALS_KEY)) ?? '{}');
      expect(index[HOST_ID]).toHaveLength(2);
    });
  });

  describe('last credential triggers host/account cleanup', () => {
    it('returns hostRemoved:true when the last remaining credential is removed', async () => {
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      await AsyncStorage.setItem(HOST_CREDENTIALS_KEY, JSON.stringify({ [HOST_ID]: [OAUTH_ID] }));
      await AsyncStorage.setItem(
        '@gitnotes:host_connections',
        JSON.stringify([
          {
            id: HOST_ID,
            accountId: 'acc-test',
            provider: 'github',
            instanceBaseUrl: null,
            hostLogin: 'testuser',
            hostUserId: 12345,
            name: 'Test User',
            email: null,
            avatarUrl: null,
            addedAt: Date.now(),
          },
        ]),
      );
      await AsyncStorage.setItem(
        '@gitnotes:accounts',
        JSON.stringify([
          {
            id: 'acc-test',
            login: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
            avatarUrl: '',
            addedAt: Date.now(),
            hostIds: [HOST_ID],
          },
        ]),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'oauth');

      expect(result.hostRemoved).toBe(true);
      const hostsRaw = await AsyncStorage.getItem('@gitnotes:host_connections');
      expect(JSON.parse(hostsRaw ?? '[]')).toHaveLength(0);
      expect(await SecureStore.getItemAsync(NATIVE_OAUTH_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(HOST_CREDENTIALS_KEY)).toBe('{}');
    });

    it('hostRemoved:false when at least one other credential kind remains', async () => {
      await SecureStore.setItemAsync(NATIVE_OAUTH_KEY, JSON.stringify(makeOAuthRecord(OAUTH_ID)));
      const appRecord = makeAppRecord(APP_ID);
      await SecureStore.setItemAsync(NATIVE_APP_KEY, JSON.stringify(appRecord));
      await AsyncStorage.setItem(
        HOST_CREDENTIALS_KEY,
        JSON.stringify({ [HOST_ID]: [OAUTH_ID, APP_ID] }),
      );
      await AsyncStorage.setItem(
        '@gitnotes:host_connections',
        JSON.stringify([
          {
            id: HOST_ID,
            accountId: 'acc-test',
            provider: 'github',
            instanceBaseUrl: null,
            hostLogin: 'testuser',
            hostUserId: 12345,
            name: 'Test User',
            email: null,
            avatarUrl: null,
            addedAt: Date.now(),
          },
        ]),
      );
      await AsyncStorage.setItem(
        '@gitnotes:accounts',
        JSON.stringify([
          {
            id: 'acc-test',
            login: 'testuser',
            name: 'Test User',
            email: 'test@example.com',
            avatarUrl: '',
            addedAt: Date.now(),
            hostIds: [HOST_ID],
          },
        ]),
      );

      const result = await AccountStorage.removeCredential(HOST_ID, 'oauth');

      expect(result.hostRemoved).toBe(false);
      const hostsRaw = await AsyncStorage.getItem('@gitnotes:host_connections');
      expect(JSON.parse(hostsRaw ?? '[]')).toHaveLength(1);
      expect(await SecureStore.getItemAsync(NATIVE_APP_KEY)).not.toBeNull();
    });
  });

  describe('idempotency', () => {
    it('is idempotent when no credential of the given kind exists', async () => {
      await SecureStore.setItemAsync(NATIVE_TOKEN_KEY, 'pat_token');

      const result = await AccountStorage.removeCredential(HOST_ID, 'oauth');

      expect(result.hostRemoved).toBe(false);
      expect(await SecureStore.getItemAsync(NATIVE_TOKEN_KEY)).toBe('pat_token');
    });
  });
});
