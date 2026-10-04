import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { GitHubService } from '../services/GitHubService';
import { gitLabService } from '../services/git/GitLabService';
import {
  giteaHostService,
  forgejoHostService,
} from '../services/git/gitHostFactory';
import {
  GIT_HOST_API_BASES,
  GIT_HOST_LABELS,
  type GitHostProvider,
  type GitHostUser,
} from '../services/git/GitHost';
import type { GiteaLikeUser } from '../services/git/GiteaLikeHostService';

export type HostAuthStatus = 'unknown' | 'ready';

export interface HostAuthState {
  provider: GitHostProvider;
  label: string;
  user: GitHostUser | null;
  isAuthenticated: boolean;
  baseUrl: string;
}

export interface HostAuthContextValue {
  hosts: Record<GitHostProvider, HostAuthState>;
  status: HostAuthStatus;
  refresh: () => Promise<void>;
  setToken: (
    provider: GitHostProvider,
    token: string,
    baseUrl?: string,
  ) => Promise<GitHostUser | null>;
  clearToken: (provider: GitHostProvider) => Promise<void>;
  setBaseUrl: (provider: GitHostProvider, baseUrl: string) => Promise<void>;
  /**
   * Connect a GitHub OAuth credential for a host.
   * The OAuth credential must have been stored via `AccountStorage.setOAuthCredential`.
   * Registers the OAuth access token with the native Git engine for clone/fetch/push.
   *
   * Returns the OAuth credential record on success.
   */
  connectGitHubOAuth: (hostId: string) => Promise<import('../services/git/contracts').GitHubOAuthCredentialRecord | null>;
  /**
   * Disconnect the GitHub OAuth credential for a host.
   * Removes the credential from AccountStorage and clears native Git registration.
   */
  disconnectGitHubOAuth: (hostId: string) => Promise<void>;
  /**
   * Connect a GitHub App installation credential for a host.
   * The App credential must have been stored via `AccountStorage.setGitHubAppCredential`.
   * Registers the App installation token with the native Git engine for clone/fetch/push.
   *
   * Returns the App credential record on success.
   */
  connectGitHubApp: (hostId: string) => Promise<import('../services/git/contracts').GitHubAppCredentialRecord | null>;
  /**
   * Disconnect the GitHub App installation credential for a host.
   * Removes the credential from AccountStorage and clears native Git registration.
   */
  disconnectGitHubApp: (hostId: string) => Promise<void>;
  /**
   * Renew the GitHub App installation token for a host.
   * Uses the stored renewal grant to get a fresh installation token.
   * Re-registers the new token with the native Git engine.
   *
   * Returns the renewed App credential record on success.
   */
  renewGitHubAppToken: (hostId: string) => Promise<import('../services/git/contracts').GitHubAppCredentialRecord | null>;
}

const HOST_ORDER: GitHostProvider[] = ['github', 'gitlab', 'gitea', 'forgejo'];

const HostAuthContext = createContext<HostAuthContextValue | undefined>(undefined);

function giteaUserToHostUser(
  _provider: GitHostProvider,
  user: GiteaLikeUser | null,
): GitHostUser | null {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.full_name ?? null,
    avatarUrl: user.avatar_url ?? null,
  };
}

function snapshotGitHub(): HostAuthState {
  const u = GitHubService.getUser();
  return {
    provider: 'github',
    label: GIT_HOST_LABELS.github,
    user: u
      ? {
          id: u.id,
          login: u.login,
          name: u.name ?? null,
          avatarUrl: u.avatar_url ?? null,
        }
      : null,
    isAuthenticated: GitHubService.isAuthenticated(),
    baseUrl: GIT_HOST_API_BASES.github,
  };
}

async function snapshotGitLab(): Promise<HostAuthState> {
  const u = await gitLabService.getUser();
  return {
    provider: 'gitlab',
    label: GIT_HOST_LABELS.gitlab,
    user: u
      ? {
          id: u.id,
          login: u.username,
          name: u.name,
          avatarUrl: u.avatar_url ?? null,
        }
      : null,
    isAuthenticated: gitLabService.isAuthenticated(),
    baseUrl: gitLabService.getBaseUrl(),
  };
}

async function snapshotGiteaLike(provider: 'gitea' | 'forgejo'): Promise<HostAuthState> {
  const svc = provider === 'gitea' ? giteaHostService : forgejoHostService;
  const user = await svc.getUser();
  return {
    provider,
    label: GIT_HOST_LABELS[provider],
    user: giteaUserToHostUser(provider, user),
    isAuthenticated: svc.isAuthenticated(),
    baseUrl: svc.getBaseUrl(),
  };
}

async function snapshotAll(): Promise<Record<GitHostProvider, HostAuthState>> {
  const [github, gitlab, gitea, forgejo] = await Promise.all([
    snapshotGitHub(),
    snapshotGitLab(),
    snapshotGiteaLike('gitea'),
    snapshotGiteaLike('forgejo'),
  ]);
  return { github, gitlab, gitea, forgejo };
}

interface HostAuthProviderProps {
  children: ReactNode;
}

export function HostAuthProvider({ children }: HostAuthProviderProps) {
  const [hosts, setHosts] = useState<Record<GitHostProvider, HostAuthState>>(
    () => ({
      github: snapshotGitHub(),
      gitlab: {
        provider: 'gitlab',
        label: GIT_HOST_LABELS.gitlab,
        user: null,
        isAuthenticated: gitLabService.isAuthenticated(),
        baseUrl: gitLabService.getBaseUrl(),
      },
      gitea: {
        provider: 'gitea',
        label: GIT_HOST_LABELS.gitea,
        user: null,
        isAuthenticated: giteaHostService.isAuthenticated(),
        baseUrl: giteaHostService.getBaseUrl(),
      },
      forgejo: {
        provider: 'forgejo',
        label: GIT_HOST_LABELS.forgejo,
        user: null,
        isAuthenticated: forgejoHostService.isAuthenticated(),
        baseUrl: forgejoHostService.getBaseUrl(),
      },
    }),
  );
  const [status, setStatus] = useState<HostAuthStatus>('unknown');

  const refresh = useCallback(async () => {
    setHosts(await snapshotAll());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          GitHubService.initialize(),
          gitLabService.initialize(),
          giteaHostService.initialize(),
          forgejoHostService.initialize(),
        ]);
      } catch (err) {
        console.warn('[HostAuthContext] initialize failed:', err);
      }
      if (!cancelled) {
        setHosts(await snapshotAll());
        setStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setToken = useCallback(
    async (
      provider: GitHostProvider,
      token: string,
      baseUrl?: string,
    ): Promise<GitHostUser | null> => {
      let user: GitHostUser | null = null;
      if (provider === 'github') {
        const gh = await GitHubService.setToken(token);
        user = gh
          ? {
              id: gh.id,
              login: gh.login,
              name: gh.name ?? null,
              avatarUrl: gh.avatar_url ?? null,
            }
          : null;
      } else if (provider === 'gitlab') {
        const gl = await gitLabService.setToken(token, baseUrl);
        user = gl
          ? {
              id: gl.id,
              login: gl.username,
              name: gl.name,
              avatarUrl: gl.avatar_url ?? null,
            }
          : null;
      } else if (provider === 'gitea' || provider === 'forgejo') {
        const svc = provider === 'gitea' ? giteaHostService : forgejoHostService;
        const gl = await svc.setToken(token, baseUrl);
        user = giteaUserToHostUser(provider, gl);
      }
      await refresh();
      return user;
    },
    [refresh],
  );

  const clearToken = useCallback(
    async (provider: GitHostProvider): Promise<void> => {
      if (provider === 'github') {
        await GitHubService.clearToken();
      } else if (provider === 'gitlab') {
        await gitLabService.clearToken();
      } else if (provider === 'gitea') {
        await giteaHostService.clearToken();
      } else if (provider === 'forgejo') {
        await forgejoHostService.clearToken();
      }
      await refresh();
    },
    [refresh],
  );

  const setBaseUrl = useCallback(
    async (provider: GitHostProvider, baseUrl: string): Promise<void> => {
      if (provider === 'gitlab') {
        gitLabService.setBaseUrl(baseUrl);
        await gitLabService.initialize();
      } else if (provider === 'gitea') {
        giteaHostService.setBaseUrl(baseUrl);
        await giteaHostService.initialize();
      } else if (provider === 'forgejo') {
        forgejoHostService.setBaseUrl(baseUrl);
        await forgejoHostService.initialize();
      }
      await refresh();
    },
    [refresh],
  );

  const connectGitHubOAuth = useCallback(
    async (hostId: string) => {
      const { AccountStorage } = await import('../services/AccountStorage');
      const cred = await AccountStorage.getOAuthCredential(hostId);
      if (!cred) return null;
      const { registerGitHubOAuthCredential } = await import('../services/git/NativeCredentialBridge');
      // OAuth tokens are user-level — register against a wildcard repo key so any
      // repo lookup on this host picks up the OAuth credential.
      const wildcardRepoId = `${hostId}:oauth-all-repos`;
      await registerGitHubOAuthCredential(wildcardRepoId, hostId, cred.accessToken);
      return cred;
    },
    [],
  );

  const disconnectGitHubOAuth = useCallback(
    async (hostId: string) => {
      const { AuthService } = await import('../services/AuthService');
      const { hostRemoved } = await AuthService.removeCredential(hostId, 'oauth');
      if (hostRemoved) {
        const { clearHostCredentials } = await import('../services/git/NativeCredentialBridge');
        await clearHostCredentials(hostId);
      } else {
        const { clearCredentialKindForHost } = await import('../services/git/NativeCredentialBridge');
        await clearCredentialKindForHost(hostId, 'oauth');
      }
    },
    [],
  );

  const connectGitHubApp = useCallback(
    async (hostId: string) => {
      const { AccountStorage } = await import('../services/AccountStorage');
      const cred = await AccountStorage.getGitHubAppCredential(hostId);
      if (!cred) return null;
      const { registerGitHubAppCredential } = await import('../services/git/NativeCredentialBridge');
      for (const repo of cred.selectedRepositories) {
        const repoId = `${repo.owner}/${repo.repo}`;
        await registerGitHubAppCredential(repoId, hostId, cred.token);
      }
      return cred;
    },
    [],
  );

  const disconnectGitHubApp = useCallback(
    async (hostId: string) => {
      const { AuthService } = await import('../services/AuthService');
      const { hostRemoved } = await AuthService.removeCredential(hostId, 'github_app');
      if (hostRemoved) {
        const { clearHostCredentials } = await import('../services/git/NativeCredentialBridge');
        await clearHostCredentials(hostId);
      } else {
        const { clearCredentialKindForHost } = await import('../services/git/NativeCredentialBridge');
        await clearCredentialKindForHost(hostId, 'github_app');
      }
    },
    [],
  );

  const renewGitHubAppToken = useCallback(
    async (hostId: string) => {
      const { AccountStorage } = await import('../services/AccountStorage');
      const { GitHubAppService } = await import('../services/GitHubAppService');
      const cred = await AccountStorage.getGitHubAppCredential(hostId);
      if (!cred) return null;
      const result = await GitHubAppService.renewInstallationToken({ credential: cred });
      if (!result.ok) return null;
      const renewed = result.credential;
      await AccountStorage.setGitHubAppCredential(hostId, renewed);
      const { registerGitHubAppCredential } = await import('../services/git/NativeCredentialBridge');
      for (const repo of renewed.selectedRepositories) {
        const repoId = `${repo.owner}/${repo.repo}`;
        await registerGitHubAppCredential(repoId, hostId, renewed.token);
      }
      return renewed;
    },
    [],
  );

  const value = useMemo<HostAuthContextValue>(
    () => ({
      hosts,
      status,
      refresh,
      setToken,
      clearToken,
      setBaseUrl,
      connectGitHubOAuth,
      disconnectGitHubOAuth,
      connectGitHubApp,
      disconnectGitHubApp,
      renewGitHubAppToken,
    }),
    [hosts, status, refresh, setToken, clearToken, setBaseUrl, connectGitHubOAuth, disconnectGitHubOAuth, connectGitHubApp, disconnectGitHubApp, renewGitHubAppToken],
  );

  return (
    <HostAuthContext.Provider value={value}>{children}</HostAuthContext.Provider>
  );
}

export function useHostAuth(): HostAuthContextValue {
  const ctx = useContext(HostAuthContext);
  if (!ctx) {
    throw new Error('useHostAuth must be used within a HostAuthProvider');
  }
  return ctx;
}

export function useHostAuthFor(provider: GitHostProvider): HostAuthState {
  const { hosts } = useHostAuth();
  return hosts[provider];
}

export function useHostProvidersOrder(): readonly GitHostProvider[] {
  return HOST_ORDER;
}

export default HostAuthContext;