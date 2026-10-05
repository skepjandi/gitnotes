import { AuthService } from '../AuthService';
import {
  GIT_HOST_API_BASES,
  type GitHostFullService,
  type GitHostProvider,
} from './GitHost';
import { GitHubHostService } from './GitHubHostService';
import { GiteaLikeHostService } from './GiteaLikeHostService';
import { GitLabService } from './GitLabService';
import {
  gitHubHostService,
  gitLabService,
  giteaHostService,
  forgejoHostService,
} from './gitHostFactory';

export { GIT_HOST_API_BASES };

export interface ActiveGitHost {
  provider: GitHostProvider;
  baseUrl: string;
  token: string;
  host: GitHostFullService;
  /** Host connection id this active host was resolved from. */
  hostId: string;
  /** Self-hosted instance base URL. `null` for SaaS defaults (github.com / gitlab.com / gitea.com / codeberg.org). */
  instanceBaseUrl: string | null;
}

/** Scratch cache so two callers in the same tick don't re-instantiate services. */
let cache: { key: string; value: ActiveGitHost } | null = null;

const cacheKey = (
  provider: GitHostProvider,
  baseUrl: string | null,
  tokenHash: string,
) => `${provider}|${baseUrl ?? ''}|${tokenHash}`;

const tokenHash = (token: string): string => {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return h.toString(36);
};

/**
 * Returns the currently-active git host service, token, and base URL.
 *
 * For SaaS providers (github.com / gitlab.com / gitea.com / codeberg.org) the
 * matching singleton from `gitHostFactory` is returned. For self-hosted
 * instances a transient service is constructed on the fly so we don't leak
 * state between switches.
 */
export async function getActiveGitHost(): Promise<ActiveGitHost | null> {
  const summary = await AuthService.getActiveSummary();
  if (!summary) return null;
  const hostSummary =
    summary.hosts.find((h) => h.id === summary.activeHostId) ?? summary.hosts[0];
  if (!hostSummary) return null;

  const { default: AccountStorage } = await import('../AccountStorage');
  const token = await AccountStorage.getHostToken(hostSummary.id);
  if (!token) return null;

  const baseUrl = hostSummary.instanceBaseUrl ?? GIT_HOST_API_BASES[hostSummary.provider];

  const key = cacheKey(hostSummary.provider, baseUrl, tokenHash(token));
  if (cache && cache.key === key) return cache.value;

  const host = resolveHostService(hostSummary.provider, baseUrl);
  const value: ActiveGitHost = {
    provider: hostSummary.provider,
    baseUrl,
    token,
    host,
    hostId: hostSummary.id,
    instanceBaseUrl: hostSummary.instanceBaseUrl,
  };
  cache = { key, value };
  return value;
}

export function clearActiveGitHostCache(): void {
  cache = null;
}

function resolveHostService(
  provider: GitHostProvider,
  baseUrl: string,
): GitHostFullService {
  const isDefault = baseUrl === GIT_HOST_API_BASES[provider];
  if (isDefault) {
    switch (provider) {
      case 'github':
        return gitHubHostService;
      case 'gitlab':
        return gitLabService;
      case 'gitea':
        return giteaHostService;
      case 'forgejo':
        return forgejoHostService;
    }
  }

  switch (provider) {
    case 'github':
      // No self-hosted GitHub Enterprise support yet — fall back to SaaS.
      return gitHubHostService;
    case 'gitlab':
      return makeGitLabService(baseUrl);
    case 'gitea':
    case 'forgejo':
      return new GiteaLikeHostService(provider, baseUrl);
  }
}

export const __testing = { GitHubHostService };

export { resolveHostService };

function makeGitLabService(baseUrl: string): GitHostFullService {
  const service = new GitLabService();
  service.setBaseUrl(baseUrl);
  return service;
}
