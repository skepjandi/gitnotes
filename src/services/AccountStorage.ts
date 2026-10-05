import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { GitHostProvider } from './git/GitHost';
import type {
  GitHubOAuthCredentialRecord,
  GitHubAppCredentialRecord,
  CredentialKind,
} from './git/contracts';
import { isKnownCredentialKind } from './git/contracts';

const ACCOUNTS_KEY = '@gitnotes:accounts';
const HOSTS_KEY = '@gitnotes:host_connections';
const ACTIVE_HOST_KEY = '@gitnotes:active_host_id';
const ACTIVE_ACCOUNT_ID_KEY = '@gitnotes:active_account_id';
const PER_ID_TOKEN_PREFIX_WEB = '@gitnotes:account_token:';
const PER_HOST_TOKEN_PREFIX_WEB = '@gitnotes:host_token:';
const PER_ID_TOKEN_PREFIX_NATIVE = 'gitnotes_account_token_';
const PER_HOST_TOKEN_PREFIX_NATIVE = 'gitnotes_host_token_';
const PER_HOST_SSH_PRIVATE_PREFIX_NATIVE = 'gitnotes_ssh_private_';
const PER_HOST_SSH_PUBLIC_PREFIX_NATIVE = 'gitnotes_ssh_public_';
const PER_HOST_SSH_PRIVATE_PREFIX_WEB = '@gitnotes:ssh_private:';
const PER_HOST_SSH_PUBLIC_PREFIX_WEB = '@gitnotes:ssh_public:';
const USE_SSH_KEY_PREFIX_WEB = '@gitnotes:host_use_ssh:';
const USE_SSH_KEY_PREFIX_NATIVE = 'gitnotes_host_use_ssh_';

const LEGACY_TOKEN_KEY_WEB = '@gitnotes:github_token';
const LEGACY_TOKEN_KEY_NATIVE = 'gitnotes_github_token';

// ── New OAuth / GitHub App credential keys (independent of token/SSH keys) ──
const OAUTH_CREDENTIAL_PREFIX_WEB = '@gitnotes:oauth_cred:';
const OAUTH_CREDENTIAL_PREFIX_NATIVE = 'gitnotes_oauth_cred_';
const GITHUB_APP_CREDENTIAL_PREFIX_WEB = '@gitnotes:gh_app_cred:';
const GITHUB_APP_CREDENTIAL_PREFIX_NATIVE = 'gitnotes_gh_app_cred_';

// Maps hostId → list of credential ids of all kinds stored for that host.
// Enables bulk removal without iterating all AsyncStorage keys.
const HOST_CREDENTIALS_KEY = '@gitnotes:host_credential_ids';

// Stores manually-entered commit author email + name per host, set when the
// user explicitly overrides the API-derived identity and opting to persist.
const REMEMBERED_EMAILS_KEY = '@gitnotes:remembered_commit_authors';

// Stores manually-entered commit author email + name per repository.
// Scoped by repository id, independent of host connections.
const REMEMBERED_REPO_AUTHORS_KEY = '@gitnotes:remembered_repo_commit_authors';

export interface StoredAccount {
  id: string;
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
  addedAt: number;
  /**
   * ids of `HostConnection`s that belong to this account. Always present
   * (defaulted to `[]` for legacy rows). One account may be connected to
   * several git hosts (e.g. personal GitHub + work self-hosted GitLab).
   */
  hostIds: string[];
}

export interface AccountProfile {
  login: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface HostConnection {
  /** Stable id; format `<accountId>:<provider>:<instanceKey>`. */
  id: string;
  accountId: string;
  provider: GitHostProvider;
  /** Self-hosted instance base URL. `null` for SaaS defaults (github.com / gitlab.com / gitea.com / codeberg.org). */
  instanceBaseUrl: string | null;
  /** User login *on this host* (can differ from `account.login` across providers). */
  hostLogin: string;
  /** Provider-side numeric id. */
  hostUserId: number;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  addedAt: number;
}

/** Composite id used as a token key suffix. */
export function makeHostId(
  accountId: string,
  provider: GitHostProvider,
  instanceBaseUrl: string | null,
): string {
  const normalized = instanceBaseUrl ? instanceBaseUrl.replace(/\/+$/, '') : null;
  const instanceKey = (normalized ?? 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${accountId}:${provider}:${instanceKey}`;
}

function tokenKeyFor(id: string): string {
  if (Platform.OS === 'web') return `${PER_ID_TOKEN_PREFIX_WEB}${id}`;
  // SecureStore on iOS allows alphanumerics, `.`, `-`, `_`. Our ids already match.
  return `${PER_ID_TOKEN_PREFIX_NATIVE}${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function hostTokenKeyFor(hostId: string): string {
  if (Platform.OS === 'web') return `${PER_HOST_TOKEN_PREFIX_WEB}${hostId}`;
  return `${PER_HOST_TOKEN_PREFIX_NATIVE}${hostId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

async function readTokenById(id: string): Promise<string | null> {
  const key = tokenKeyFor(id);
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn('[AccountStorage] Failed to read token:', error);
    return null;
  }
}

async function writeTokenById(id: string, token: string): Promise<void> {
  const key = tokenKeyFor(id);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, token);
    return;
  }
  await SecureStore.setItemAsync(key, token);
}

async function deleteTokenById(id: string): Promise<void> {
  const key = tokenKeyFor(id);
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}

async function readHostToken(hostId: string): Promise<string | null> {
  return readTokenById(hostTokenKeyFor(hostId));
}

async function writeHostToken(hostId: string, token: string): Promise<void> {
  return writeTokenById(hostTokenKeyFor(hostId), token);
}

async function deleteHostToken(hostId: string): Promise<void> {
  return deleteTokenById(hostTokenKeyFor(hostId));
}

async function readSshPrivateKey(hostId: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(PER_HOST_SSH_PRIVATE_PREFIX_WEB + hostId);
  const key = PER_HOST_SSH_PRIVATE_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function readSshPublicKey(hostId: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(PER_HOST_SSH_PUBLIC_PREFIX_WEB + hostId);
  const key = PER_HOST_SSH_PUBLIC_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function writeSshKey(hostId: string, keys: { privateKey: string; publicKey: string }): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(PER_HOST_SSH_PRIVATE_PREFIX_WEB + hostId, keys.privateKey);
    await AsyncStorage.setItem(PER_HOST_SSH_PUBLIC_PREFIX_WEB + hostId, keys.publicKey);
    return;
  }
  const privateKey = PER_HOST_SSH_PRIVATE_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  const publicKey = PER_HOST_SSH_PUBLIC_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  await SecureStore.setItemAsync(privateKey, keys.privateKey);
  await SecureStore.setItemAsync(publicKey, keys.publicKey);
}

async function deleteSshKey(hostId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(PER_HOST_SSH_PRIVATE_PREFIX_WEB + hostId);
    await AsyncStorage.removeItem(PER_HOST_SSH_PUBLIC_PREFIX_WEB + hostId);
    return;
  }
  const privateKey = PER_HOST_SSH_PRIVATE_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  const publicKey = PER_HOST_SSH_PUBLIC_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  await SecureStore.deleteItemAsync(privateKey).catch(() => undefined);
  await SecureStore.deleteItemAsync(publicKey).catch(() => undefined);
}

async function readHostUseSsh(hostId: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const val = await AsyncStorage.getItem(USE_SSH_KEY_PREFIX_WEB + hostId);
    return val === 'true';
  }
  const key = USE_SSH_KEY_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  const val = await SecureStore.getItemAsync(key);
  return val === 'true';
}

async function writeHostUseSsh(hostId: string, useSsh: boolean): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(USE_SSH_KEY_PREFIX_WEB + hostId, String(useSsh));
    return;
  }
  const key = USE_SSH_KEY_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
  await SecureStore.setItemAsync(key, String(useSsh));
}

async function readLegacyToken(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(LEGACY_TOKEN_KEY_WEB);
  try {
    const secure = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY_NATIVE);
    if (secure) return secure;
  } catch {
    // fall through
  }
  return AsyncStorage.getItem(LEGACY_TOKEN_KEY_WEB);
}

async function deleteLegacyToken(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_TOKEN_KEY_WEB).catch(() => undefined);
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY_NATIVE).catch(() => undefined);
  }
}

function generateAccountId(): string {
  return `acc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Credential index helpers ─────────────────────────────────────────────────

interface RememberedCommitAuthor {
  email: string;
  name?: string;
}

async function readRememberedAuthors(): Promise<Record<string, RememberedCommitAuthor>> {
  const raw = await AsyncStorage.getItem(REMEMBERED_EMAILS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, RememberedCommitAuthor] => {
          const value = entry[1];
          return typeof value === 'object'
            && value !== null
            && typeof (value as { email?: unknown }).email === 'string';
        },
      ),
    );
  } catch {
    return {};
  }
}

async function writeRememberedAuthors(
  mapping: Record<string, RememberedCommitAuthor>,
): Promise<void> {
  await AsyncStorage.setItem(REMEMBERED_EMAILS_KEY, JSON.stringify(mapping));
}

async function readRememberedRepoAuthors(): Promise<Record<string, RememberedCommitAuthor>> {
  const raw = await AsyncStorage.getItem(REMEMBERED_REPO_AUTHORS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, RememberedCommitAuthor] => {
          const value = entry[1];
          return typeof value === 'object'
            && value !== null
            && typeof (value as { email?: unknown }).email === 'string';
        },
      ),
    );
  } catch {
    return {};
  }
}

async function writeRememberedRepoAuthors(
  mapping: Record<string, RememberedCommitAuthor>,
): Promise<void> {
  await AsyncStorage.setItem(REMEMBERED_REPO_AUTHORS_KEY, JSON.stringify(mapping));
}

async function readHostCredentialIds(): Promise<Record<string, string[]>> {
  const raw = await AsyncStorage.getItem(HOST_CREDENTIALS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeHostCredentialIds(
  mapping: Record<string, string[]>,
): Promise<void> {
  await AsyncStorage.setItem(HOST_CREDENTIALS_KEY, JSON.stringify(mapping));
}

async function addHostCredentialId(
  hostId: string,
  credId: string,
): Promise<void> {
  const mapping = await readHostCredentialIds();
  const existing = mapping[hostId] ?? [];
  if (!existing.includes(credId)) {
    mapping[hostId] = [...existing, credId];
    await writeHostCredentialIds(mapping);
  }
}

async function removeHostCredentialId(
  hostId: string,
  credId: string,
): Promise<void> {
  const mapping = await readHostCredentialIds();
  const existing = mapping[hostId] ?? [];
  const filtered = existing.filter((id) => id !== credId);
  if (filtered.length === 0) {
    delete mapping[hostId];
  } else {
    mapping[hostId] = filtered;
  }
  await writeHostCredentialIds(mapping);
}

// ── OAuth credential helpers ──────────────────────────────────────────────────

function oauthCredKeyFor(hostId: string): string {
  if (Platform.OS === 'web') return `${OAUTH_CREDENTIAL_PREFIX_WEB}${hostId}`;
  return `${OAUTH_CREDENTIAL_PREFIX_NATIVE}${hostId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

async function readOAuthCredential(
  hostId: string,
): Promise<GitHubOAuthCredentialRecord | null> {
  const key = oauthCredKeyFor(hostId);
  const raw = Platform.OS === 'web'
    ? await AsyncStorage.getItem(key)
    : await SecureStore.getItemAsync(key).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind !== 'oauth') return null;
    return parsed as GitHubOAuthCredentialRecord;
  } catch {
    return null;
  }
}

async function writeOAuthCredential(
  hostId: string,
  cred: GitHubOAuthCredentialRecord,
): Promise<void> {
  const key = oauthCredKeyFor(hostId);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, JSON.stringify(cred));
  } else {
    await SecureStore.setItemAsync(key, JSON.stringify(cred));
  }
  await addHostCredentialId(hostId, cred.id);
}

async function deleteOAuthCredential(hostId: string): Promise<void> {
  const credId = `${hostId}:oauth`;
  await removeHostCredentialId(hostId, credId);
  const key = oauthCredKeyFor(hostId);
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  }
}

// ── GitHub App credential helpers ───────────────────────────────────────────

function githubAppCredKeyFor(hostId: string): string {
  if (Platform.OS === 'web') return `${GITHUB_APP_CREDENTIAL_PREFIX_WEB}${hostId}`;
  return `${GITHUB_APP_CREDENTIAL_PREFIX_NATIVE}${hostId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

async function readGitHubAppCredential(
  hostId: string,
): Promise<GitHubAppCredentialRecord | null> {
  const key = githubAppCredKeyFor(hostId);
  const raw = Platform.OS === 'web'
    ? await AsyncStorage.getItem(key)
    : await SecureStore.getItemAsync(key).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind !== 'github_app') return null;
    return parsed as GitHubAppCredentialRecord;
  } catch {
    return null;
  }
}

async function writeGitHubAppCredential(
  hostId: string,
  cred: GitHubAppCredentialRecord,
): Promise<void> {
  const key = githubAppCredKeyFor(hostId);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, JSON.stringify(cred));
  } else {
    await SecureStore.setItemAsync(key, JSON.stringify(cred));
  }
  await addHostCredentialId(hostId, cred.id);
}

async function deleteGitHubAppCredential(hostId: string): Promise<void> {
  const credId = `${hostId}:github_app`;
  await removeHostCredentialId(hostId, credId);
  const key = githubAppCredKeyFor(hostId);
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  }
}

async function listHostConnections(): Promise<HostConnection[]> {
  const raw = await AsyncStorage.getItem(HOSTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (h): h is HostConnection =>
          typeof h?.id === 'string' &&
          typeof h?.accountId === 'string' &&
          typeof h?.provider === 'string' &&
          (typeof h?.hostLogin === 'string' || h?.hostLogin == null),
      )
      .map((h) => ({
        ...h,
        hostLogin: typeof h.hostLogin === 'string' ? h.hostLogin : '',
      }));
  } catch {
    return [];
  }
}

async function writeHostConnections(connections: HostConnection[]): Promise<void> {
  await AsyncStorage.setItem(HOSTS_KEY, JSON.stringify(connections));
}

const sanitizeAccount = (acc: StoredAccount): StoredAccount => ({
  ...acc,
  hostIds: Array.isArray(acc.hostIds) ? acc.hostIds : [],
});

export class AccountStorage {
  // ── Accounts ─────────────────────────────────────────────────────────

  static async listAccounts(): Promise<StoredAccount[]> {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (a): a is StoredAccount =>
            typeof a?.id === 'string' && typeof a?.login === 'string',
        )
        .map(sanitizeAccount);
    } catch {
      return [];
    }
  }

  static async writeAccounts(accounts: StoredAccount[]): Promise<void> {
    await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  static async getActiveAccountId(): Promise<string | null> {
    return AsyncStorage.getItem(ACTIVE_ACCOUNT_ID_KEY);
  }

  static async setActiveAccountId(id: string | null): Promise<void> {
    if (id === null) {
      await AsyncStorage.removeItem(ACTIVE_ACCOUNT_ID_KEY);
      return;
    }
    await AsyncStorage.setItem(ACTIVE_ACCOUNT_ID_KEY, id);
  }

  static async getActiveHostId(): Promise<string | null> {
    return AsyncStorage.getItem(ACTIVE_HOST_KEY);
  }

  static async setActiveHostId(id: string | null): Promise<void> {
    if (id === null) {
      await AsyncStorage.removeItem(ACTIVE_HOST_KEY);
      return;
    }
    await AsyncStorage.setItem(ACTIVE_HOST_KEY, id);
  }

  /**
   * @deprecated used by legacy single-host flow; `connectHost` is the
   * preferred entry point. Kept for back-compat.
   */
  static async getActiveAccount(): Promise<StoredAccount | null> {
    const id = await this.getActiveAccountId();
    if (!id) return null;
    const accounts = await this.listAccounts();
    return accounts.find((a) => a.id === id) ?? null;
  }

  static async getTokenById(id: string): Promise<string | null> {
    return readTokenById(id);
  }

  /**
   * Returns the token for the currently active account, falling back to the
   * legacy single-token storage for installs that haven't migrated yet.
   */
  static async getActiveToken(): Promise<string | null> {
    const activeHostId = await this.getActiveHostId();
    if (activeHostId) {
      const hostToken = await readHostToken(activeHostId);
      if (hostToken) return hostToken;
    }
    const id = await this.getActiveAccountId();
    if (id) {
      const t = await readTokenById(id);
      if (t) return t;
    }
    return readLegacyToken();
  }

  static async getActiveHostConnection(): Promise<HostConnection | null> {
    const hostId = await this.getActiveHostId();
    if (!hostId) return null;
    const hosts = await listHostConnections();
    return hosts.find((h) => h.id === hostId) ?? null;
  }

  /**
   * Persist a token + profile as an account. If an account with the same
   * login exists, its token + profile are replaced (no duplicate). Sets
   * active account when none is currently active. Drops the legacy token
   * after the first account is created.
   */
  static async addAccount(token: string | null, profile: AccountProfile): Promise<StoredAccount> {
    const accounts = await this.listAccounts();
    const existingIndex = accounts.findIndex((a) => a.login === profile.login);

    if (existingIndex >= 0) {
      const existing = accounts[existingIndex];
      const updated: StoredAccount = {
        ...existing,
        login: profile.login,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        hostIds: existing.hostIds ?? [],
      };
      accounts[existingIndex] = updated;
      if (token !== null) await writeTokenById(existing.id, token);
      await this.writeAccounts(accounts);
      const activeId = await this.getActiveAccountId();
      if (!activeId) await this.setActiveAccountId(existing.id);
      return updated;
    }

    const id = generateAccountId();
    const newAccount: StoredAccount = {
      id,
      addedAt: Date.now(),
      login: profile.login,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      hostIds: [],
    };
    accounts.push(newAccount);
    if (token !== null) await writeTokenById(id, token);
    await this.writeAccounts(accounts);

    const activeId = await this.getActiveAccountId();
    if (!activeId) await this.setActiveAccountId(id);

    if (accounts.length === 1) {
      await deleteLegacyToken();
    }

    return newAccount;
  }

  static async removeAccount(id: string): Promise<void> {
    const accounts = await this.listAccounts();
    const remaining = accounts.filter((a) => a.id !== id);
    await this.writeAccounts(remaining);
    await deleteTokenById(id);

    // also remove any host connections bound to this account
    const hosts = await listHostConnections();
    const remainingHosts = hosts.filter((h) => h.accountId !== id);
    for (const host of hosts) {
      if (host.accountId === id) {
        await deleteHostToken(host.id);
        await deleteOAuthCredential(host.id);
        await deleteGitHubAppCredential(host.id);
      }
    }
    await writeHostConnections(remainingHosts);

    // SECURITY: clear AI provider API keys from SecureStore and wipe the
    // AI settings blob so a re-added account can't inherit the previous
    // user's provider keys (bug-hunt 2026-08).
    await this.clearAccountAiState();

    const activeId = await this.getActiveAccountId();
    if (activeId === id) {
      await this.setActiveAccountId(remaining[0]?.id ?? null);
    }
    const activeHostId = await this.getActiveHostId();
    if (activeHostId && !remainingHosts.some((h) => h.id === activeHostId)) {
      await this.setActiveHostId(remainingHosts[0]?.id ?? null);
    }
  }

  private static async clearAccountAiState(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem('ai-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const providers: Array<{ id?: string }> = Array.isArray(parsed?.providers) ? parsed.providers : [];
        await Promise.all(
          providers
            .filter((p): p is { id: string } => typeof p?.id === 'string')
            .map((p) => SecureStore.deleteItemAsync(`ai-provider-key-${p.id}`).catch(() => undefined)),
        );
      }
    } catch { /* best-effort */ }
    try {
      await AsyncStorage.removeItem('ai-settings');
    } catch { /* best-effort */ }
  }

  static async clearAll(): Promise<void> {
    const accounts = await this.listAccounts();
    await Promise.all(accounts.map((a) => deleteTokenById(a.id)));
    const hosts = await listHostConnections();
    await Promise.all(hosts.map((h) => deleteHostToken(h.id)));
    const hostIds = await readHostCredentialIds();
    await Promise.all(
      Object.keys(hostIds).flatMap((hid) => [
        deleteOAuthCredential(hid),
        deleteGitHubAppCredential(hid),
      ]),
    );
    await writeHostConnections([]);
    await this.writeAccounts([]);
    await this.setActiveAccountId(null);
    await this.setActiveHostId(null);
    await deleteLegacyToken();
    await AsyncStorage.removeItem(HOST_CREDENTIALS_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(REMEMBERED_EMAILS_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(REMEMBERED_REPO_AUTHORS_KEY).catch(() => undefined);
  }

  // ── Host connections ─────────────────────────────────────────────────

  static async listHostConnections(): Promise<HostConnection[]> {
    return listHostConnections();
  }

  /**
   * Adds a new host connection. If a connection already exists for the same
   * (accountId, provider, instanceBaseUrl) tuple its profile is updated and
   * its token is replaced; otherwise a fresh connection is created.
   *
   * Returns the resulting `HostConnection`. The caller is responsible for
   * appending its id to the owning account's `hostIds`.
   */
  static async upsertHostConnection(
    connection: Omit<HostConnection, 'id' | 'addedAt'> & { token?: string },
  ): Promise<HostConnection> {
    const hosts = await listHostConnections();
    const accounts = await this.listAccounts();
    const account = accounts.find((a) => a.id === connection.accountId);
    if (!account) {
      throw new Error(`Cannot attach host to unknown account ${connection.accountId}.`);
    }

    const id = makeHostId(connection.accountId, connection.provider, connection.instanceBaseUrl);
    const existingIndex = hosts.findIndex((h) => h.id === id);

    const persisted: HostConnection = {
      id,
      accountId: connection.accountId,
      provider: connection.provider,
      instanceBaseUrl: connection.instanceBaseUrl,
      hostLogin: connection.hostLogin,
      hostUserId: connection.hostUserId,
      name: connection.name,
      email: connection.email,
      avatarUrl: connection.avatarUrl,
      addedAt: Date.now(),
    };

    if (existingIndex >= 0) {
      hosts[existingIndex] = { ...hosts[existingIndex], ...persisted, id };
    } else {
      hosts.push(persisted);
    }

    await writeHostConnections(hosts);
    if (connection.token !== undefined) await writeHostToken(id, connection.token);

    if (!account.hostIds.includes(id)) {
      account.hostIds = [...account.hostIds, id];
      const accountIndex = accounts.findIndex((a) => a.id === account.id);
      accounts[accountIndex] = account;
      await this.writeAccounts(accounts);
    }

    return persisted;
  }

  static async getHostConnection(hostId: string): Promise<HostConnection | null> {
    const hosts = await listHostConnections();
    return hosts.find((h) => h.id === hostId) ?? null;
  }

  static async updateHostProfile(
    hostId: string,
    profile: Pick<HostConnection, 'name' | 'email' | 'avatarUrl' | 'hostLogin'>,
  ): Promise<void> {
    const hosts = await listHostConnections();
    const index = hosts.findIndex((host) => host.id === hostId);
    if (index < 0) return;
    hosts[index] = { ...hosts[index], ...profile };
    await writeHostConnections(hosts);
  }

  static async getHostToken(hostId: string): Promise<string | null> {
    return readHostToken(hostId);
  }

  static async clearHostToken(hostId: string): Promise<void> {
    await deleteHostToken(hostId);
  }

  static async getSshKey(hostId: string): Promise<{ privateKey: string; publicKey: string } | null> {
    const [privateKey, publicKey] = await Promise.all([readSshPrivateKey(hostId), readSshPublicKey(hostId)]);
    if (privateKey && publicKey) return { privateKey, publicKey };
    return null;
  }

  static async setSshKey(hostId: string, keys: { privateKey: string; publicKey: string }): Promise<void> {
    await writeSshKey(hostId, keys);
  }

  static async deleteSshKey(hostId: string): Promise<void> {
    await deleteSshKey(hostId);
  }

  static async getHostUseSsh(hostId: string): Promise<boolean> {
    return readHostUseSsh(hostId);
  }

  static async setHostUseSsh(hostId: string, useSsh: boolean): Promise<void> {
    await writeHostUseSsh(hostId, useSsh);
  }

  static async removeHostConnection(hostId: string): Promise<void> {
    const hosts = await listHostConnections();
    const remaining = hosts.filter((h) => h.id !== hostId);
    await writeHostConnections(remaining);
    await deleteHostToken(hostId);
    await deleteSshKey(hostId);
    const useSshKey = USE_SSH_KEY_PREFIX_NATIVE + hostId.replace(/[^A-Za-z0-9_]/g, '_');
    await SecureStore.deleteItemAsync(useSshKey).catch(() => undefined);

    const accounts = await this.listAccounts();
    let mutated = false;
    const updated = accounts.map((a) => {
      if (a.hostIds.includes(hostId)) {
        mutated = true;
        return { ...a, hostIds: a.hostIds.filter((hid) => hid !== hostId) };
      }
      return a;
    });

    // Drop accounts whose host list is now empty — they have nothing to
    // manage, so leaving them as ghost rows in Settings just shows a stale
    // account row (avatar + name) that only goes away on app reload.
    const accountsToKeep = updated.filter((a) => a.hostIds.length > 0);
    const removedAccountIds = updated
      .filter((a) => a.hostIds.length === 0)
      .map((a) => a.id);
    if (removedAccountIds.length > 0) {
      mutated = true;
    }
    if (mutated) await this.writeAccounts(accountsToKeep);

    // Migrate the active pointers so they don't dangle onto deleted rows.
    const activeAccountId = await this.getActiveAccountId();
    const activeHostId = await this.getActiveHostId();
    const activeAccountWasRemoved =
      !!activeAccountId && removedAccountIds.includes(activeAccountId);

    if (activeAccountWasRemoved) {
      const next = accountsToKeep[0];
      if (next) {
        await this.setActiveAccountId(next.id);
        await this.setActiveHostId(next.hostIds[0] ?? null);
      } else {
        await this.setActiveAccountId(null);
        await this.setActiveHostId(null);
      }
    } else if (activeHostId === hostId) {
      // The disconnected host was active but the owning account is still
      // alive — pick the first remaining host on that account.
      const stillActive = accountsToKeep.find((a) => a.id === activeAccountId);
      await this.setActiveHostId(stillActive?.hostIds[0] ?? null);
    }

    // SECURITY: clear AI keys only when the account is actually dropped
    // (not on every host disconnect), mirroring removeAccount.
    if (removedAccountIds.length > 0) {
      await this.clearAccountAiState();
    }

    // Clean up any OAuth / GitHub App credentials for this host.
    await deleteOAuthCredential(hostId);
    await deleteGitHubAppCredential(hostId);

    // Clean up remembered commit author for this host.
    const remembered = await readRememberedAuthors();
    if (remembered[hostId]) {
      delete remembered[hostId];
      await writeRememberedAuthors(remembered);
    }
  }

  // ── OAuth / GitHub App credentials ─────────────────────────────────────

  /**
   * Read the OAuth credential for a host, or null if none is stored.
   * Validates the `kind` discriminator before returning.
   */
  static async getOAuthCredential(
    hostId: string,
  ): Promise<GitHubOAuthCredentialRecord | null> {
    const cred = await readOAuthCredential(hostId);
    if (!cred) return null;
    if (cred.kind !== 'oauth') return null;
    return cred;
  }

  /**
   * Persist a GitHub OAuth credential for a host.
   * Rejects unknown kinds, empty tokens, expired metadata, and cross-provider reuse.
   * Stores under a separate key from the existing host_token keys so that
   * OAuth and PAT/token auth are fully isolated at rest.
   */
  static async setOAuthCredential(
    hostId: string,
    cred: GitHubOAuthCredentialRecord,
  ): Promise<void> {
    if (!isKnownCredentialKind(cred.kind)) {
      throw new Error(`Cannot store credential with unknown kind: ${cred.kind}`);
    }
    if (cred.kind !== 'oauth') {
      throw new Error(`Expected kind 'oauth', got '${cred.kind}'`);
    }
    if (!cred.accessToken || cred.accessToken.length === 0) {
      throw new Error('Cannot store OAuth credential with empty access token');
    }
    if (typeof cred.expiresAt !== 'number' || cred.expiresAt <= Date.now()) {
      throw new Error('Cannot store OAuth credential with expired metadata');
    }
    if (!cred.renewal?.refreshToken || !cred.renewal?.backendUrl) {
      throw new Error('Cannot store OAuth credential with invalid renewal metadata');
    }
    if (typeof cred.userId !== 'number' || cred.userId <= 0) {
      throw new Error('Cannot store OAuth credential with invalid userId');
    }
    await writeOAuthCredential(hostId, cred);
  }

  /**
   * Delete the OAuth credential for a host. Idempotent when no credential exists.
   */
  static async deleteOAuthCredential(hostId: string): Promise<void> {
    await deleteOAuthCredential(hostId);
  }

  /**
   * Read the GitHub App credential for a host, or null if none is stored.
   * Validates the `kind` discriminator before returning.
   */
  static async getGitHubAppCredential(
    hostId: string,
  ): Promise<GitHubAppCredentialRecord | null> {
    const cred = await readGitHubAppCredential(hostId);
    if (!cred) return null;
    if (cred.kind !== 'github_app') return null;
    return cred;
  }

  /**
   * Persist a GitHub App installation credential for a host.
   * Rejects empty repository selections, expired metadata, and invalid renewal.
   * Stores under a separate key from all existing credential keys so that
   * a GitHub App failure cannot cascade to PAT/SSH for the same host.
   */
  static async setGitHubAppCredential(
    hostId: string,
    cred: GitHubAppCredentialRecord,
  ): Promise<void> {
    if (!isKnownCredentialKind(cred.kind)) {
      throw new Error(`Cannot store credential with unknown kind: ${cred.kind}`);
    }
    if (cred.kind !== 'github_app') {
      throw new Error(`Expected kind 'github_app', got '${cred.kind}'`);
    }
    if (!cred.token || cred.token.length === 0) {
      throw new Error('Cannot store GitHub App credential with empty token');
    }
    if (typeof cred.expiresAt !== 'number' || cred.expiresAt <= Date.now()) {
      throw new Error('Cannot store GitHub App credential with expired metadata');
    }
    if (!Array.isArray(cred.selectedRepositories) || cred.selectedRepositories.length === 0) {
      throw new Error('Cannot store GitHub App credential with empty repository selection');
    }
    for (const repo of cred.selectedRepositories) {
      if (!repo.owner || !repo.repo) {
        throw new Error('Cannot store GitHub App credential with incomplete repository entry');
      }
    }
    if (!cred.renewal?.grantToken || !cred.renewal?.backendUrl) {
      throw new Error('Cannot store GitHub App credential with invalid renewal metadata');
    }
    if (typeof cred.installationId !== 'number' || cred.installationId <= 0) {
      throw new Error('Cannot store GitHub App credential with invalid installationId');
    }
    await writeGitHubAppCredential(hostId, cred);
  }

  /**
   * Delete the GitHub App credential for a host. Idempotent when no credential exists.
   */
  static async deleteGitHubAppCredential(hostId: string): Promise<void> {
    await deleteGitHubAppCredential(hostId);
  }

  // ── Per-kind credential removal ─────────────────────────────────────────────

  // ── Remembered commit authors ─────────────────────────────────────────

  /**
   * Returns the manually-remembered commit author for a host, if one was stored
   * via `setRememberedCommitAuthor`.
   */
  static async getRememberedCommitAuthor(
    hostId: string,
  ): Promise<RememberedCommitAuthor | null> {
    const map = await readRememberedAuthors();
    return map[hostId] ?? null;
  }

  /**
   * Persists a manually-entered commit author (email + optional name) for a host.
   * Call this after a successful commit when the user explicitly provided an email
   * that differs from the API-derived identity.
   * Pass `null` to clear the remembered author for a host.
   */
  static async setRememberedCommitAuthor(
    hostId: string,
    author: RememberedCommitAuthor | null,
  ): Promise<void> {
    const map = await readRememberedAuthors();
    if (author === null) {
      delete map[hostId];
    } else {
      map[hostId] = author;
    }
    await writeRememberedAuthors(map);
  }

  /**
   * Returns the manually-remembered commit author for a repository, if one was stored
   * via `setRememberedCommitAuthorForRepo`.
   */
  static async getRememberedCommitAuthorForRepo(
    repoId: string,
  ): Promise<RememberedCommitAuthor | null> {
    const map = await readRememberedRepoAuthors();
    return map[repoId] ?? null;
  }

  /**
   * Persists a manually-entered commit author (email + optional name) for a repository.
   * Call this after a successful commit when the user explicitly provided an email
   * that differs from the API-derived identity.
   * Pass `null` to clear the remembered author for a repository.
   */
  static async setRememberedCommitAuthorForRepo(
    repoId: string,
    author: RememberedCommitAuthor | null,
  ): Promise<void> {
    const map = await readRememberedRepoAuthors();
    if (author === null) {
      delete map[repoId];
    } else {
      map[repoId] = author;
    }
    await writeRememberedRepoAuthors(map);
  }

  // ── Credential removal ─────────────────────────────────────────────

  static async removeCredential(
    hostId: string,
    kind: CredentialKind,
  ): Promise<{ hostRemoved: boolean }> {
    switch (kind) {
      case 'token': {
        await deleteHostToken(hostId);
        break;
      }
      case 'oauth': {
        const credId = `${hostId}:oauth`;
        await removeHostCredentialId(hostId, credId);
        const key = oauthCredKeyFor(hostId);
        if (Platform.OS === 'web') {
          await AsyncStorage.removeItem(key);
        } else {
          await SecureStore.deleteItemAsync(key).catch(() => undefined);
        }
        break;
      }
      case 'github_app': {
        const credId = `${hostId}:github_app`;
        await removeHostCredentialId(hostId, credId);
        const key = githubAppCredKeyFor(hostId);
        if (Platform.OS === 'web') {
          await AsyncStorage.removeItem(key);
        } else {
          await SecureStore.deleteItemAsync(key).catch(() => undefined);
        }
        break;
      }
      case 'ssh': {
        await deleteSshKey(hostId);
        break;
      }
      default: {
        break;
      }
    }

    const hasOAuth = await readOAuthCredential(hostId);
    const hasApp = await readGitHubAppCredential(hostId);
    const hasToken = await readHostToken(hostId);
    const hasSSH = await readSshPrivateKey(hostId);

    if (!hasOAuth && !hasApp && !hasToken && !hasSSH) {
      await this.removeHostConnection(hostId);
      return { hostRemoved: true };
    }

    return { hostRemoved: false };
  }

  // ── Legacy ───────────────────────────────────────────────────────────

  static async deleteLegacy(): Promise<void> {
    await deleteLegacyToken();
  }

  // ── Internal helpers used by tests ───────────────────────────────────

  /** @internal raw write — used by migration to rewrite the accounts list. */
  static async _rawWriteAccounts(accounts: StoredAccount[]): Promise<void> {
    await this.writeAccounts(accounts);
  }

  /** @internal raw write — used by migration to add host connections. */
  static async _rawWriteHostConnections(connections: HostConnection[]): Promise<void> {
    await writeHostConnections(connections);
  }
}

export default AccountStorage;
