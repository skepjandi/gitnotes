import type { GitRepository } from '../GitService';
import type { GitHostProvider } from './GitHost';

/**
 * Reference to a host connection (one token) that is being removed.
 * `id` matches `HostConnection.id` / `ActiveGitHost.hostId`; `provider` is
 * the host's provider so legacy (unstamped) repos can be matched by provider.
 */
export interface RemovedHostRef {
  id: string;
  provider: GitHostProvider;
}

export interface RemainingCredentialAccess {
  hasHostWideCredential: boolean;
  appRepositories: ReadonlyArray<{ owner: string; repo: string }>;
}

export function reposAffectedByRemovedCredential(
  repositories: GitRepository[],
  hostId: string,
  remaining: RemainingCredentialAccess,
): GitRepository[] {
  if (remaining.hasHostWideCredential) return [];

  const selected = new Set(
    remaining.appRepositories.map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()),
  );

  return repositories.filter((repo) => {
    if (repo.hostId !== hostId) return false;
    if (selected.has((repo.full_name ?? repo.path).toLowerCase())) return false;
    return true;
  });
}

/**
 * Returns the subset of `repositories` that should be removed when the given
 * hosts are removed. Pure: no mutation, returns a filtered array.
 *
 * A repo is affected when EITHER:
 *  a) it was stamped with a `hostId` that is in the set of removed host ids; OR
 *  b) it is a legacy (unstamped) repo whose `provider` (default 'github')
 *     matches a removed host's provider AND that provider is used by no other
 *     remaining account (`providerAccountCount.get(provider) ?? 0 <= 1`).
 *     The `<= 1` guard keeps legacy repos in place on multi-account installs
 *     where another account still uses the same provider.
 */
export function reposAffectedByRemovedHosts(
  repositories: GitRepository[],
  removedHosts: RemovedHostRef[],
  providerAccountCount: ReadonlyMap<GitHostProvider, number>,
): GitRepository[] {
  const removedIds = new Set(removedHosts.map((h) => h.id));
  const removedProviders = new Set(removedHosts.map((h) => h.provider));

  return repositories.filter((repo) => {
    if (repo.hostId) {
      return removedIds.has(repo.hostId);
    }
    const provider = repo.provider ?? 'github';
    if (!removedProviders.has(provider)) return false;
    return (providerAccountCount.get(provider) ?? 0) <= 1;
  });
}

/**
 * Counts how many accounts have at least one host with each provider.
 *
 * Iterates the account summaries; per summary, collects its unique host
 * providers into a Set, then increments the map once per unique provider.
 * Multiple hosts on the same provider within one account count as one account.
 */
export function buildProviderAccountCount(
  accountSummaries: Array<{ hosts: Array<{ provider: GitHostProvider }> }>,
): Map<GitHostProvider, number> {
  const counts = new Map<GitHostProvider, number>();
  for (const summary of accountSummaries) {
    const uniqueProviders = new Set<GitHostProvider>();
    for (const host of summary.hosts) {
      uniqueProviders.add(host.provider);
    }
    for (const provider of uniqueProviders) {
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
  }
  return counts;
}
