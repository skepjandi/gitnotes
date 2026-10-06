import AccountStorage, { HostConnection, StoredAccount } from './AccountStorage';
import { GitHubAppService } from './GitHubAppService';
import { gitLabService } from './git/GitLabService';
import {
  giteaHostService,
  forgejoHostService,
} from './git/gitHostFactory';
import type { GitHostProvider } from './git/GitHost';
import type {
  GitHubOAuthCredentialRecord,
  GitHubAppCredentialRecord,
  OAuthErrorCode,
  GitHubAppErrorCode,
  GitHubOAuthAvailability,
  GitHubAppAvailability,
  ProviderAuthAvailability,
  GlobalAuthAvailability,
  CredentialValidity,
} from './git/contracts';
import {
  validateOAuthCredential,
  isOAuthExpired,
  isRefreshExpired,
  validateGitHubAppCredential,
  isInstallationTokenExpired,
  hasEmptyRepositorySelection,
} from './git/contracts';
import { canCreateAdditionalIdentity } from './TierLimits';

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: GitHubUser | null;
  token: string | null;
}

export type TokenValidity =
  | { ok: true; user: GitHubUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'missing_repo_scope' }
  | { ok: false; reason: 'missing_contents_permission' }
  | { ok: false; reason: 'saml' }
  | { ok: false; reason: 'no_repository_access' }
  | { ok: false; reason: 'network' };

export interface HostConnectionSummary {
  id: string;
  accountId: string;
  provider: GitHostProvider;
  hostLogin: string;
  hostUserId: number;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  instanceBaseUrl: string | null;
  addedAt: number;
}

export interface AccountSummary {
  account: StoredAccount;
  hosts: HostConnectionSummary[];
  activeHostId: string | null;
}

interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
}

interface GiteaLikeUser {
  id: number;
  login: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
}

function profileFromUser(user: GitHubUser) {
  return {
    login: user.login,
    name: user.name ?? user.login,
    email: user.email ?? '',
    avatarUrl: user.avatar_url,
  };
}

function userFromAccount(account: StoredAccount): GitHubUser {
  return {
    id: 0,
    login: account.login,
    name: account.name,
    email: account.email,
    avatar_url: account.avatarUrl,
  };
}

function toHostSummary(conn: HostConnection): HostConnectionSummary {
  return {
    id: conn.id,
    accountId: conn.accountId,
    provider: conn.provider,
    hostLogin: conn.hostLogin,
    hostUserId: conn.hostUserId,
    name: conn.name,
    email: conn.email,
    avatarUrl: conn.avatarUrl,
    instanceBaseUrl: conn.instanceBaseUrl,
    addedAt: conn.addedAt,
  };
}

/**
 * Best-effort conversion of a non-GitHub host's verify-time user payload into
 * a `GitHubUser` shape so legacy UI (avatar / name fields) keeps rendering.
 */
function userFromHost(
  provider: GitHostProvider,
  raw:
    | {
        id: number;
        login?: string;
        username?: string;
        name?: string;
        email?: string | null;
        avatar_url?: string | null;
      }
    | null,
): GitHubUser | null {
  if (!raw) return null;
  const login = raw.login ?? (raw as { username?: string }).username;
  if (!login) return null;
  return {
    id: raw.id ?? 0,
    login,
    name: raw.name ?? login,
    email: raw.email ?? '',
    avatar_url: raw.avatar_url ?? '',
  };
}

export interface ConnectHostInput {
  provider: GitHostProvider;
  token: string;
  instanceBaseUrl?: string | null;
  /** When supplied, attach to this existing account; otherwise create one. */
  accountId?: string;
}

export type ConnectHostResult =
  | { ok: true; account: StoredAccount; host: HostConnectionSummary }
  | { ok: false; reason: 'invalid' | 'missing_repo_scope' | 'missing_contents_permission' | 'saml' | 'no_repository_access' | 'network' | 'free_tier_identity_limit_reached' };

/**
 * Verifies a token against the chosen host's API. Returns the resolved
 * user on success and `null` on failure (invalid token OR network error).
 * Use `validateHostToken` for finer-grained failures.
 */
export async function validateHostToken(
  provider: GitHostProvider,
  token: string,
  instanceBaseUrl?: string | null,
): Promise<TokenValidity> {
  if (provider === 'github') {
    return validateGitHubToken(token);
  }
  if (provider === 'gitlab') {
    const user = await gitLabService.setToken(token, instanceBaseUrl ?? undefined);
    if (!user) return { ok: false, reason: 'invalid' };
    return { ok: true, user: userFromHost('gitlab', user as GitLabUser)! };
  }
  if (provider === 'gitea') {
    const user = await giteaHostService.setToken(token, instanceBaseUrl ?? undefined);
    if (!user) return { ok: false, reason: 'invalid' };
    return { ok: true, user: userFromHost('gitea', user as GiteaLikeUser)! };
  }
  if (provider === 'forgejo') {
    const user = await forgejoHostService.setToken(token, instanceBaseUrl ?? undefined);
    if (!user) return { ok: false, reason: 'invalid' };
    return { ok: true, user: userFromHost('forgejo', user as GiteaLikeUser)! };
  }
  return { ok: false, reason: 'invalid' };
}

export class AuthService {
  // ── Legacy single-account flow (kept for back-compat) ──────────────

  static async checkAuthState(): Promise<AuthState> {
    const summary = await this.getActiveSummary();
    if (!summary) return { isAuthenticated: false, user: null, token: null };
    const token = await AccountStorage.getActiveToken();
    if (!token) return { isAuthenticated: false, user: null, token: null };
    // Use the host's identity when available (handles self-hosted GitLab etc),
    // falling back to the account profile for legacy single-host installs.
    const host = summary.hosts.find((h) => h.id === summary.activeHostId) ?? summary.hosts[0];
    const user: GitHubUser = host
      ? {
          id: host.hostUserId,
          login: host.hostLogin,
          name: host.name ?? host.hostLogin,
          email: host.email ?? '',
          avatar_url: host.avatarUrl ?? '',
        }
      : userFromAccount(summary.account);
    return { isAuthenticated: true, user, token };
  }

  /**
   * @deprecated prefer `connectHost({ provider: 'github', token })`. Kept so
   * existing call sites compile unchanged.
   */
  static async setToken(token: string): Promise<AuthState> {
    const result = await this.connectHost({ provider: 'github', token });
    if (!result.ok) return { isAuthenticated: false, user: null, token: null };
    const summary = await this.getActiveSummary();
    const isAuth = !!summary;
    const activeToken = await AccountStorage.getActiveToken();
    const user = summary
      ? {
          id: result.host.hostUserId,
          login: result.host.hostLogin,
          name: result.host.name ?? result.host.hostLogin,
          email: result.host.email ?? '',
          avatar_url: result.host.avatarUrl ?? '',
        }
      : null;
    return { isAuthenticated: isAuth && !!activeToken, user, token: activeToken };
  }

  /**
   * @deprecated prefer `connectHost({ provider: 'github', token, accountId })`.
   * Adds a GitHub token without making it active.
   */
  static async addAccount(token: string): Promise<StoredAccount | null> {
    const result = await this.connectHost({ provider: 'github', token });
    if (!result.ok) return null;
    return result.account;
  }

  static async clearToken(): Promise<void> {
    // Disconnect the currently active host (legacy semantic: clear active).
    const activeHostId = await AccountStorage.getActiveHostId();
    if (activeHostId) {
      await AccountStorage.removeHostConnection(activeHostId);
    }
    const activeAccountId = await AccountStorage.getActiveAccountId();
    if (activeAccountId) {
      const account = (await AccountStorage.listAccounts()).find(
        (a) => a.id === activeAccountId,
      );
      if (account && account.hostIds.length === 0) {
        await AccountStorage.removeAccount(activeAccountId);
      }
    }
    await AccountStorage.deleteLegacy();
  }

  static async getToken(): Promise<string | null> {
    return AccountStorage.getActiveToken();
  }

  static async getTokenById(id: string): Promise<string | null> {
    return AccountStorage.getTokenById(id);
  }

  static async listAccounts(): Promise<StoredAccount[]> {
    return AccountStorage.listAccounts();
  }

  static async getActiveAccount(): Promise<StoredAccount | null> {
    return AccountStorage.getActiveAccount();
  }

  static async getActiveAccountId(): Promise<string | null> {
    return AccountStorage.getActiveAccountId();
  }

  /**
   * @deprecated kept for callers that pre-date multi-host. Use `switchToHost`
   * or `switchAccount`. Returns a synthetic AuthState derived from the active
   * host; underlying account is unchanged.
   */
  static async setActiveAccount(id: string): Promise<AuthState> {
    const accounts = await AccountStorage.listAccounts();
    const account = accounts.find((a) => a.id === id);
    if (!account || account.hostIds.length === 0) {
      return { isAuthenticated: false, user: null, token: null };
    }
    await AccountStorage.setActiveAccountId(id);
    await AccountStorage.setActiveHostId(account.hostIds[0]);
    const token = await AccountStorage.getActiveToken();
    return {
      isAuthenticated: !!token,
      user: account ? userFromAccount(account) : null,
      token,
    };
  }

  static async removeAccount(id: string): Promise<void> {
    await AccountStorage.removeAccount(id);
  }

  static async getUser(token: string): Promise<GitHubUser | null> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('[AuthService] Failed to get user:', error);
      return null;
    }
  }

  /**
   * Hits GET /user to check if a token is still accepted by GitHub.
   * Distinguishes auth failure (401/403) from network/server failure so we
   * don't wipe valid tokens just because the device is offline.
   */
  static async validateToken(token: string): Promise<TokenValidity> {
    return validateGitHubToken(token);
  }

  /**
   * Validates every stored account's GitHub token. Removes accounts whose
   * tokens are explicitly rejected (401/403). Network/server errors leave
   * accounts intact.
   *
   * Two account shapes are supported:
   *  - Multi-host: account has `hostIds[]`; we validate each GitHub host
   *    connection's token. If every host is bad, the account goes.
   *  - Legacy single-host: account has no host connections but does have a
   *    token persisted under the per-account key. We validate that token
   *    and remove the account on rejection — preserving the old behaviour.
   */
  static async validateAllAccounts(): Promise<{ removed: string[] }> {
    const accounts = await AccountStorage.listAccounts();
    const removed: string[] = [];
    for (const account of accounts) {
      const hosts = (await AccountStorage.listHostConnections()).filter(
        (h) => h.accountId === account.id,
      );
      if (hosts.length === 0) {
        // Legacy single-host account.
        const token = await AccountStorage.getTokenById(account.id);
        if (!token) {
          await AccountStorage.removeAccount(account.id);
          removed.push(account.id);
          continue;
        }
        const result = await validateGitHubToken(token);
        if (!result.ok && result.reason === 'invalid') {
          await AccountStorage.removeAccount(account.id);
          removed.push(account.id);
        }
        continue;
      }

      let anyHostsLeft = false;
      for (const host of hosts) {
        if (host.provider !== 'github') {
          // We don't currently revalidate non-GitHub tokens at boot; the
          // design treats them as user-managed and removes only on explicit
          // UX disconnect.
          anyHostsLeft = true;
          continue;
        }

        const appCredential = await AccountStorage.getGitHubAppCredential(host.id);
        if (appCredential) {
          if (isInstallationTokenExpired(appCredential)) {
            const renewal = await GitHubAppService.renewInstallationToken({ credential: appCredential });
            if (!renewal.ok) {
              anyHostsLeft = true;
              continue;
            }
          }
          anyHostsLeft = true;
          continue;
        }

        const oauthCredential = await AccountStorage.getOAuthCredential(host.id);
        if (oauthCredential) {
          anyHostsLeft = true;
          continue;
        }

        const token = await AccountStorage.getHostToken(host.id);
        if (!token) {
          await AccountStorage.removeHostConnection(host.id);
          continue;
        }

        const result = await validateGitHubToken(token);
        if (!result.ok && result.reason === 'invalid') {
          await AccountStorage.removeHostConnection(host.id);
        } else if (result.ok) {
          anyHostsLeft = true;
        }
      }
      if (!anyHostsLeft) {
        await AccountStorage.removeAccount(account.id);
        removed.push(account.id);
      }
    }
    return { removed };
  }

  static getAuthorizationHeader(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }

  // ── Multi-host flow ────────────────────────────────────────────────

  static async connectHost(input: ConnectHostInput): Promise<ConnectHostResult> {
    const verification = await validateHostToken(
      input.provider,
      input.token,
      input.instanceBaseUrl ?? null,
    );
    if (!verification.ok) return { ok: false, reason: verification.reason };
    const verified = verification.user;
    const instanceBaseUrl = input.instanceBaseUrl?.trim() || null;

    let account: StoredAccount | null = null;

    // Path A: accountId explicitly provided — find and use that account.
    if (input.accountId) {
      const all = await AccountStorage.listAccounts();
      account = all.find((a) => a.id === input.accountId) ?? null;
      if (!account) {
        // Explicit accountId that doesn't exist — treat as new identity attempt.
        if (!(await canCreateAdditionalIdentity('__unknown__', input.provider, instanceBaseUrl))) {
          return { ok: false, reason: 'free_tier_identity_limit_reached' };
        }
        // Account not found via explicit ID — do not create implicitly.
        return { ok: false, reason: 'invalid' };
      }
      // accountId provided and found — check host-level policy.
      if (!(await canCreateAdditionalIdentity(account.id, input.provider, instanceBaseUrl))) {
        return { ok: false, reason: 'free_tier_identity_limit_reached' };
      }
    } else {
      // Path B: no accountId — try login-matching.
      const all = await AccountStorage.listAccounts();
      account = all.find((a) => a.login === verified.login) ?? null;

      if (account) {
        // Login matched an existing account — check if target host is allowed.
        // If the host already exists it's an update (always allowed).
        // If it's a new host on this account, Free users with an existing host are blocked.
        if (!(await canCreateAdditionalIdentity(account.id, input.provider, instanceBaseUrl))) {
          return { ok: false, reason: 'free_tier_identity_limit_reached' };
        }
      } else {
        // Path C: no account matched — fresh identity.
        // canCreateAdditionalIdentity('__new__', ...) checks Pro bypass above
        // account-count gate, so Free gets blocked at 1 account and Pro is always allowed.
        if (!(await canCreateAdditionalIdentity('__new__', input.provider, instanceBaseUrl))) {
          return { ok: false, reason: 'free_tier_identity_limit_reached' };
        }
        account = await AccountStorage.addAccount(input.token, profileFromUser(verified));
      }
    }

    const host = await AccountStorage.upsertHostConnection({
      accountId: account.id,
      provider: input.provider,
      instanceBaseUrl,
      hostLogin: verified.login,
      hostUserId: verified.id,
      name: verified.name ?? verified.login,
      email: verified.email ?? null,
      avatarUrl: verified.avatar_url ?? null,
      token: input.token,
    });

    // If this is the first host on the account, or there's no active host,
    // make it active.
    const currentActiveHostId = await AccountStorage.getActiveHostId();
    if (!currentActiveHostId) {
      await AccountStorage.setActiveAccountId(account.id);
      await AccountStorage.setActiveHostId(host.id);
    }

    if (input.provider === 'gitea') {
      await giteaHostService.storeHostCredentials(
        host.id,
        input.token,
        instanceBaseUrl ?? giteaHostService.getBaseUrl(),
      );
    } else if (input.provider === 'forgejo') {
      await forgejoHostService.storeHostCredentials(
        host.id,
        input.token,
        instanceBaseUrl ?? forgejoHostService.getBaseUrl(),
      );
    }

    return { ok: true, account, host: toHostSummary(host) };
  }

  static async disconnectHost(hostId: string): Promise<void> {
    await AccountStorage.removeHostConnection(hostId);
  }

  static async removeCredential(
    hostId: string,
    kind: 'token' | 'oauth' | 'github_app' | 'ssh',
  ): Promise<{ hostRemoved: boolean }> {
    return AccountStorage.removeCredential(hostId, kind);
  }

  static async listAccountSummaries(): Promise<AccountSummary[]> {
    const accounts = await AccountStorage.listAccounts();
    const hosts = await AccountStorage.listHostConnections();
    const activeHostId = await AccountStorage.getActiveHostId();
    return accounts.map((account) => {
      const accountHosts = hosts
        .filter((h) => h.accountId === account.id)
        .map(toHostSummary);
      return {
        account,
        hosts: accountHosts,
        activeHostId: accountHosts.some((h) => h.id === activeHostId)
          ? activeHostId
          : accountHosts[0]?.id ?? null,
      };
    });
  }

  static async getActiveSummary(): Promise<AccountSummary | null> {
    const summaries = await this.listAccountSummaries();
    return summaries.find((s) => s.activeHostId) ?? summaries[0] ?? null;
  }

  static async switchToHost(
    hostId: string,
  ): Promise<{ ok: true; summary: AccountSummary } | { ok: false; reason: 'not-found' | 'no-token' }> {
    const hosts = await AccountStorage.listHostConnections();
    const host = hosts.find((h) => h.id === hostId);
    if (!host) return { ok: false, reason: 'not-found' };
    const token = await AccountStorage.getHostToken(host.id);
    if (!token) return { ok: false, reason: 'no-token' };
    await AccountStorage.setActiveAccountId(host.accountId);
    await AccountStorage.setActiveHostId(host.id);
    const summaries = await this.listAccountSummaries();
    const summary = summaries.find((s) => s.account.id === host.accountId);
    if (!summary) return { ok: false, reason: 'not-found' };
    return { ok: true, summary };
  }

  static async switchAccount(
    accountId: string,
  ): Promise<{ ok: true; summary: AccountSummary } | { ok: false; reason: 'no-hosts' | 'not-found' }> {
    const accounts = await AccountStorage.listAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { ok: false, reason: 'not-found' };
    if (account.hostIds.length === 0) return { ok: false, reason: 'no-hosts' };
    // Pick first host with a token; fall back to hostIds[0] even if no token
    // (caller can prompt re-auth).
    const hosts = await AccountStorage.listHostConnections();
    let chosen: HostConnection | null = null;
    for (const hostId of account.hostIds) {
      const host = hosts.find((h) => h.id === hostId);
      if (!host) continue;
      const token = await AccountStorage.getHostToken(host.id);
      if (token) {
        chosen = host;
        break;
      }
      if (!chosen) chosen = host;
    }
    if (!chosen) return { ok: false, reason: 'no-hosts' };
    await AccountStorage.setActiveAccountId(account.id);
    await AccountStorage.setActiveHostId(chosen.id);
    const summaries = await this.listAccountSummaries();
    const summary = summaries.find((s) => s.account.id === accountId);
    if (!summary) return { ok: false, reason: 'not-found' };
    return { ok: true, summary };
  }

  // ── GitHub OAuth credential management ─────────────────────────────────

  /**
   * Retrieve the stored OAuth credential for a GitHub host.
   * Returns null when no OAuth credential has been stored for this host.
   */
  static async getGitHubOAuthCredential(
    hostId: string,
  ): Promise<GitHubOAuthCredentialRecord | null> {
    return AccountStorage.getOAuthCredential(hostId);
  }

  /**
   * Validate an OAuth credential record's metadata.
   * Returns the record if valid, null if missing or invalid.
   * Does NOT check with GitHub — caller handles network validation.
   */
  static async validateGitHubOAuthCredential(
    cred: GitHubOAuthCredentialRecord,
  ): Promise<{ valid: true; record: GitHubOAuthCredentialRecord } | { valid: false; reason: string }> {
    const result = validateOAuthCredential(cred);
    if (!result.valid) return result;
    return { valid: true, record: cred };
  }

  /**
   * Remove the OAuth credential for a host.
   * Idempotent when no credential is stored.
   */
  static async removeGitHubOAuthCredential(hostId: string): Promise<void> {
    await AccountStorage.deleteOAuthCredential(hostId);
  }

  /**
   * Store a GitHub OAuth credential for a host.
   * Validates the record before storing; throws on invalid metadata.
   */
  static async setGitHubOAuthCredential(
    hostId: string,
    cred: GitHubOAuthCredentialRecord,
  ): Promise<void> {
    const validation = await this.validateGitHubOAuthCredential(cred);
    if (!validation.valid) {
      throw new Error(`Invalid OAuth credential: ${validation.reason}`);
    }
    await AccountStorage.setOAuthCredential(hostId, cred);
  }

  // ── GitHub App credential management ───────────────────────────────────

  /**
   * Retrieve the stored GitHub App installation credential for a host.
   * Returns null when no GitHub App credential has been stored for this host.
   */
  static async getGitHubAppCredential(
    hostId: string,
  ): Promise<GitHubAppCredentialRecord | null> {
    return AccountStorage.getGitHubAppCredential(hostId);
  }

  /**
   * Validate a GitHub App credential record's metadata.
   * Returns the record if valid, null if missing or invalid.
   * Rejects empty repository selections — caller must ensure at least one
   * repo is selected before storing.
   * Does NOT check with GitHub — caller handles network validation.
   */
  static async validateGitHubAppCredential(
    cred: GitHubAppCredentialRecord,
  ): Promise<{ valid: true; record: GitHubAppCredentialRecord } | { valid: false; reason: string }> {
    if (hasEmptyRepositorySelection(cred)) {
      return { valid: false, reason: 'empty_repository_selection' };
    }
    const result = validateGitHubAppCredential(cred);
    if (!result.valid) return result;
    return { valid: true, record: cred };
  }

  /**
   * Remove the GitHub App credential for a host.
   * Idempotent when no credential is stored.
   */
  static async removeGitHubAppCredential(hostId: string): Promise<void> {
    await AccountStorage.deleteGitHubAppCredential(hostId);
  }

  /**
   * Store a GitHub App installation credential for a host.
   * Validates the record (including non-empty repository selection) before storing.
   */
  static async setGitHubAppCredential(
    hostId: string,
    cred: GitHubAppCredentialRecord,
  ): Promise<void> {
    const validation = await this.validateGitHubAppCredential(cred);
    if (!validation.valid) {
      throw new Error(`Invalid GitHub App credential: ${validation.reason}`);
    }
    await AccountStorage.setGitHubAppCredential(hostId, cred);
  }

  // ── Feature-scoped availability ─────────────────────────────────────────

  /**
   * Compute per-provider availability state for GitHub OAuth and GitHub App.
   * Each provider's state is independent — one provider's failure does NOT
   * affect another provider's availability.
   *
   * Non-GitHub providers always return `isAvailable: true` when a token
   * exists (token/PAT auth is handled by the existing flow).
   */
  static async getProviderAuthAvailability(
    hostId: string,
    provider: GitHostProvider,
  ): Promise<ProviderAuthAvailability> {
    if (provider !== 'github') {
      const token = await AccountStorage.getHostToken(hostId);
      return { provider, isAvailable: !!token };
    }

    const [oauthCred, appCred] = await Promise.all([
      AccountStorage.getOAuthCredential(hostId),
      AccountStorage.getGitHubAppCredential(hostId),
    ]);

    const oauthAvailable: GitHubOAuthAvailability = oauthCred
      ? {
          available: !isOAuthExpired(oauthCred) && !isRefreshExpired(oauthCred),
          error: null,
          backendReachable: true,
        }
      : { available: false, error: null, backendReachable: false };

    const appAvailable: GitHubAppAvailability = appCred
      ? {
          available: !isInstallationTokenExpired(appCred),
          error: null,
          backendReachable: true,
        }
      : { available: false, error: null, backendReachable: false };

    const hasToken = !!(await AccountStorage.getHostToken(hostId));
    const isAvailable = hasToken || oauthAvailable.available || appAvailable.available;

    return {
      provider,
      isAvailable,
      oauth: oauthAvailable,
      githubApp: appAvailable,
    };
  }
}

const GITHUB_TOKEN_HEADER_NAMES = ['x-github-sso', 'x-accepted-github-permissions'] as const;
function captureGitHubTokenHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const name of GITHUB_TOKEN_HEADER_NAMES) {
    const value = headers.get(name);
    if (value !== null) captured[name] = value;
  }
  return captured;
}

function parseAcceptedPermissions(headerValue: string | null): {
  hasContents: boolean;
  hasContentsWrite: boolean;
  hasRepo: boolean;
} {
  if (!headerValue) return { hasContents: false, hasContentsWrite: false, hasRepo: false };
  const lower = headerValue.toLowerCase();
  return {
    hasContents: lower.includes('contents'),
    hasContentsWrite: /\bcontents\s*[:=]\s*write\b/i.test(headerValue),
    hasRepo: lower.includes('repo'),
  };
}

async function validateGitHubToken(
  token: string,
): Promise<TokenValidity> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (response.status === 401) {
      return { ok: false, reason: 'invalid' };
    }

    if (response.status === 403) {
      const captured = captureGitHubTokenHeaders(response.headers);
      const ssoHeader = captured['x-github-sso'];
      if (ssoHeader !== undefined) {
        return { ok: false, reason: 'saml' };
      }
      const perms = parseAcceptedPermissions(captured['x-accepted-github-permissions'] ?? null);
      if (!perms.hasContents && !perms.hasRepo) {
        return { ok: false, reason: 'missing_repo_scope' };
      }
      if (perms.hasContents && !perms.hasContentsWrite) {
        return { ok: false, reason: 'missing_contents_permission' };
      }
      return { ok: false, reason: 'no_repository_access' };
    }

    if (!response.ok) {
      return { ok: false, reason: 'network' };
    }
    const user = (await response.json()) as GitHubUser;
    return { ok: true, user };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export default AuthService;
