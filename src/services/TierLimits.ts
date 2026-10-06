import { AccountStorage, makeHostId } from './AccountStorage';
import type { GitHostProvider } from './git/GitHost';
import { StorageService } from './StorageService';
import { selectIsPro, useProStore } from '../stores/proStore';

/**
 * Free-tier caps. The UI add-flows (SettingsScreen / SettingsContent) refuse
 * to add a repo or account beyond these for non-Pro users. Android Auto
 * Backup restores the AsyncStorage DB directly, which can resurrect an
 * over-limit set of repos/accounts without ever passing through those flows
 * (#1233). Enforcing the same caps at load time closes that hole.
 */
export const FREE_TIER_MAX_REPOS = 1;
export const FREE_TIER_MAX_ACCOUNTS = 1;

function isPro(): boolean {
  return selectIsPro(useProStore.getState());
}

/**
 * Predicate: may the current user attach this credential to the target host,
 * or does this represent a new host identity?
 *
 * Host identity = accountId + provider + instanceBaseUrl.
 * Same host = updating credentials on an existing host (always allowed).
 * New host = creating a new host on an existing account (Free limited to one host total).
 * Fresh account = no accountId exists yet; Free is limited to one account total.
 *
 * This seam is consumed by AuthService.connectHost() and by UI/callback
 * entry points to ensure a consistent policy without making AccountStorage
 * entitlement-aware.
 *
 * Note: this does NOT check credential-count caps — Free users may attach
 * any number of supported credential kinds (PAT/OAuth/GitHub App/SSH) to
 * their existing host.
 */
export async function canCreateAdditionalIdentity(
  accountId: string,
  provider: GitHostProvider,
  instanceBaseUrl: string | null,
): Promise<boolean> {
  // Pro: always allowed (no identity cap).
  if (isPro()) return true;

  // Fresh account case (no accountId yet): Free limited to one account.
  if (accountId === '__new__') {
    const accounts = await AccountStorage.listAccounts();
    return accounts.length < FREE_TIER_MAX_ACCOUNTS;
  }

  const hosts = await AccountStorage.listHostConnections();
  const existingOnAccount = hosts.filter((h) => h.accountId === accountId);

  // Same host already exists — this is a credential update, always allowed.
  const targetHostId = makeHostId(accountId, provider, instanceBaseUrl);
  if (existingOnAccount.some((h) => h.id === targetHostId)) return true;

  // New host on an existing account — Free users are limited to one host.
  if (existingOnAccount.length > 0) return false;

  // No hosts on this account yet — first host is always allowed.
  return true;
}

/**
 * Enforce the free-tier repo/account caps against data restored from a device
 * backup. Must run AFTER the Pro entitlement has resolved (see
 * `useProStore.initialize`) and BEFORE the stores surface restored data, so an
 * over-limit backup is truncated instead of displayed.
 *
 * No-op for Pro users. Truncation is persisted so it survives
 * a reload.
 */
export async function enforceTierLimits(): Promise<void> {
  if (isPro()) return;
  await enforceRepoCap();
  await enforceAccountCap();
}

async function enforceRepoCap(): Promise<void> {
  const repos = await StorageService.getSavedRepositories();
  if (repos.length <= FREE_TIER_MAX_REPOS) return;
  // Repos are stored in add order (oldest first). Keep the most recently
  // added, which is the set the user is most likely still using.
  await StorageService.saveRepositories(repos.slice(repos.length - FREE_TIER_MAX_REPOS));
}

async function enforceAccountCap(): Promise<void> {
  const accounts = await AccountStorage.listAccounts();
  if (accounts.length <= FREE_TIER_MAX_ACCOUNTS) return;
  // Keep the most recently added account; drop the rest. `removeAccount`
  // cleans up each account's token and host connections and re-homes the
  // active pointers, so a restored over-limit set is actually removed rather
  // than merely hidden.
  const keepIds = new Set(
    accounts
      .slice()
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, FREE_TIER_MAX_ACCOUNTS)
      .map((a) => a.id),
  );
  for (const account of accounts) {
    if (!keepIds.has(account.id)) {
      await AccountStorage.removeAccount(account.id);
    }
  }
}
