/**
 * RewardEntitlementService.
 *
 * Manages referral reward entitlements — fetching unlock status from the Worker
 * API, caching it locally, and providing derived state for the UI.
 *
 * Security invariants:
 * - Unlocks are server-authoritative: the mobile app never grants entitlements,
 *   it only displays what the Worker confirmed.
 * - Identity proof construction is delegated to ReferralIdentityService.
 * - No client-side unlock mutations.
 *
 * The service maintains:
 * - Referral status cache (in-memory + AsyncStorage persistence)
 * - Derived unlock maps for themes and icons
 *
 * Architecture:
 * - `fetchStatus()` — calls Worker API, updates cache, returns full status
 * - `getStatus()` — returns cached status (undefined if not yet fetched)
 * - `isUnlocked(rewardKey)` — checks if a specific reward is unlocked
 * - `getUnlockedThemes()` — filters catalog to unlocked themes only
 * - `getUnlockedIcons()` — filters catalog to unlocked icons only
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { workerApi } from './workerApi';
import { ReferralIdentityService, getIdentityScope } from './ReferralIdentityService';
import {
  REFERRAL_REWARD_CATALOG,
  REFERRAL_MILESTONES,
  type ReferralMilestone,
  type ReferralRewardType,
  type ReferralMilestoneInfo,
} from '../types/worker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Referral reward entry enriched with unlock status from the server.
 */
export interface RewardEntry {
  milestone: ReferralMilestone;
  name: string;
  reward_type: ReferralRewardType;
  reward_key: string;
  unlocked: boolean;
}

/**
 * Full referral status with derived convenience fields.
 */
export interface ReferralStatus {
  has_pending_code: boolean;
  pending_code: string | null;
  pending_expires_at: number | null;
  progress: number;
  catalog_version: number;
  unlocked_milestones: ReadonlyArray<ReferralMilestone>;
  rewards: ReadonlyArray<RewardEntry>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFERRAL_STATUS_CACHE_PREFIX = '@gitnotes:referral_status_cache:';

/** Cache TTL: 5 minutes. Prevents stale reads while staying responsive. */
const REFERRAL_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedStatus {
  status: ReferralStatus;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory cache (persisted across re-renders)
// ---------------------------------------------------------------------------

let _cachedStatus: ReferralStatus | undefined = undefined;

let _currentScopeId: string | undefined = undefined;

/**
 * Generation counter incremented on every identity transition.
 * Each fetch/hydration captures its generation at scope-lookup time and bails
 * before any mutation if the current generation no longer matches.
 */
let _generation: number = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive RewardEntry array from milestone info + unlocked set.
 */
function deriveRewards(milestones: ReadonlyArray<ReferralMilestoneInfo>): ReadonlyArray<RewardEntry> {
  const unlockedSet = new Set(milestones.filter((m) => m.unlocked).map((m) => m.milestone));
  return milestones.map((m) => ({
    milestone: m.milestone,
    name: m.name,
    reward_type: m.reward_type,
    reward_key: m.reward_key,
    unlocked: unlockedSet.has(m.milestone),
  }));
}

function cacheKeyForScope(scopeId: string): string {
  return `${REFERRAL_STATUS_CACHE_PREFIX}${scopeId}`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Fetch current referral status from the Worker API.
 *
 * Uses ReferralIdentityService to construct the identity proof header.
 * Updates the in-memory cache and persists to AsyncStorage on success.
 *
 * @returns ReferralStatus on success, throws WorkerApiError on failure.
 */
export async function fetchStatus(): Promise<ReferralStatus> {
  const requestGen = _generation;
  const scope = await getIdentityScope();

  if (requestGen !== _generation) {
    return { has_pending_code: false, pending_code: null, pending_expires_at: null, progress: 0, catalog_version: 1, unlocked_milestones: [], rewards: [] };
  }

  const scopeId = scope.kind === 'github' ? scope.accountId : scope.installationId;
  _currentScopeId = scopeId;

  const identityProof = await ReferralIdentityService.getIdentityProof();
  const response = await workerApi.referrals.status(identityProof);

  if (requestGen !== _generation || _currentScopeId !== scopeId) {
    return _cachedStatus ?? { has_pending_code: false, pending_code: null, pending_expires_at: null, progress: 0, catalog_version: 1, unlocked_milestones: [], rewards: [] };
  }

  const status: ReferralStatus = {
    has_pending_code: response.has_pending_code,
    pending_code: response.pending_code,
    pending_expires_at: response.pending_expires_at,
    progress: response.progress,
    catalog_version: response.catalog_version,
    unlocked_milestones: response.unlocked_milestones,
    rewards: deriveRewards(response.milestones),
  };

  if (requestGen !== _generation) {
    return _cachedStatus ?? status;
  }
  _cachedStatus = status;

  if (requestGen !== _generation) {
    return status;
  }
  const cachePayload: CachedStatus = { status, fetchedAt: Date.now() };
  await AsyncStorage.setItem(cacheKeyForScope(scopeId), JSON.stringify(cachePayload));

  return status;
}

/**
 * Return cached referral status, or undefined if not yet fetched.
 *
 * Does NOT attempt to refresh from the server.
 * Use `fetchStatus()` to force a server call.
 */
export function getStatus(): ReferralStatus | undefined {
  return _cachedStatus;
}

/**
 * Load cached status from AsyncStorage into memory.
 *
 * Called on app startup to restore last-known state before a fresh fetch.
 * Returns the cached status if valid (not expired), undefined otherwise.
 */
export async function hydrateCache(): Promise<ReferralStatus | undefined> {
  try {
    const requestGen = _generation;
    const scope = await getIdentityScope();

    if (requestGen !== _generation) {
      return undefined;
    }

    const scopeId = scope.kind === 'github' ? scope.accountId : scope.installationId;
    _currentScopeId = scopeId;

    const raw = await AsyncStorage.getItem(cacheKeyForScope(scopeId));
    if (!raw) return undefined;

    const cached: CachedStatus = JSON.parse(raw) as CachedStatus;

    if (Date.now() - cached.fetchedAt > REFERRAL_STATUS_CACHE_TTL_MS) {
      await AsyncStorage.removeItem(cacheKeyForScope(scopeId));
      return undefined;
    }

    if (requestGen !== _generation) {
      return undefined;
    }
    _cachedStatus = cached.status;
    return cached.status;
  } catch {
    return undefined;
  }
}

/**
 * Reset in-memory cache only — does NOT delete AsyncStorage.
 *
 * Used during account transitions to clear stale in-memory state while
 * preserving each identity's persisted Worker-confirmed cache for offline
 * switch-back. Compare `clearCache()` which also wipes AsyncStorage and
 * is reserved for explicit logout/identity reset.
 */
export function resetMemory(): void {
  _generation += 1;
  _cachedStatus = undefined;
  _currentScopeId = undefined;
}

/**
 * Clear the in-memory and persisted cache.
 *
 * Call this on account logout or identity reset so a fresh user
 * doesn't inherit the previous install's referral status.
 */
export async function clearCache(): Promise<void> {
  const scopeId = _currentScopeId;
  _cachedStatus = undefined;
  _currentScopeId = undefined;
  if (scopeId) {
    await AsyncStorage.removeItem(cacheKeyForScope(scopeId));
  }
}

// ---------------------------------------------------------------------------
// Derived queries
// ---------------------------------------------------------------------------

/**
 * Check if a specific reward key is unlocked.
 *
 * Returns false if status has not been fetched (cache miss).
 */
export function isUnlocked(rewardKey: string): boolean {
  if (!_cachedStatus) return false;
  const entry = _cachedStatus.rewards.find((r) => r.reward_key === rewardKey);
  return entry?.unlocked ?? false;
}

/**
 * Check if a specific milestone is unlocked.
 */
export function isMilestoneUnlocked(milestone: ReferralMilestone): boolean {
  if (!_cachedStatus) return false;
  return _cachedStatus.unlocked_milestones.includes(milestone);
}

/**
 * Get the current referral progress (number of successful referrals).
 */
export function getProgress(): number {
  return _cachedStatus?.progress ?? 0;
}

/**
 * Return all unlocked themes from the catalog.
 */
export function getUnlockedThemes(): ReadonlyArray<RewardEntry> {
  if (!_cachedStatus) return [];
  return _cachedStatus.rewards.filter((r) => r.reward_type === 'theme' && r.unlocked);
}

/**
 * Return all unlocked icons from the catalog.
 */
export function getUnlockedIcons(): ReadonlyArray<RewardEntry> {
  if (!_cachedStatus) return [];
  return _cachedStatus.rewards.filter((r) => r.reward_type === 'icon' && r.unlocked);
}

/**
 * Return the next locked milestone and its required progress.
 * Returns null if all milestones are unlocked.
 */
export function getNextMilestone(): { milestone: ReferralMilestone; required: number; name: string } | null {
  if (!_cachedStatus) return null;

  const sortedMilestones = [...REFERRAL_MILESTONES].sort((a, b) => a - b);
  for (const milestone of sortedMilestones) {
    if (!_cachedStatus.unlocked_milestones.includes(milestone)) {
      const catalogEntry = REFERRAL_REWARD_CATALOG.find((c) => c.milestone === milestone);
      return {
        milestone,
        required: milestone,
        name: catalogEntry?.name ?? 'Unknown',
      };
    }
  }
  return null;
}

/**
 * Return all rewards (themes and icons) with their unlock status.
 */
export function getAllRewards(): ReadonlyArray<RewardEntry> {
  return _cachedStatus?.rewards ?? [...REFERRAL_REWARD_CATALOG].map((c) => ({
    milestone: c.milestone,
    name: c.name,
    reward_type: c.reward_type,
    reward_key: c.reward_key,
    unlocked: false,
  }));
}

/**
 * Get a specific reward entry by its key.
 */
export function getReward(rewardKey: string): RewardEntry | undefined {
  return _cachedStatus?.rewards.find((r) => r.reward_key === rewardKey);
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------

/**
 * Format progress as "X / Y" string.
 */
export function formatProgress(): string {
  const current = getProgress();
  const total = REFERRAL_MILESTONES[REFERRAL_MILESTONES.length - 1] ?? 20;
  return `${current} / ${total}`;
}

/**
 * Return the progress percentage (0-100).
 */
export function getProgressPercent(): number {
  if (!_cachedStatus) return 0;
  const total = REFERRAL_MILESTONES[REFERRAL_MILESTONES.length - 1] ?? 20;
  return Math.min(100, Math.round((_cachedStatus.progress / total) * 100));
}

// ---------------------------------------------------------------------------
// Service export
// ---------------------------------------------------------------------------

export const RewardEntitlementService = {
  fetchStatus,
  getStatus,
  hydrateCache,
  clearCache,
  resetMemory,
  isUnlocked,
  isMilestoneUnlocked,
  getProgress,
  getUnlockedThemes,
  getUnlockedIcons,
  getNextMilestone,
  getAllRewards,
  getReward,
  formatProgress,
  getProgressPercent,
};

export default RewardEntitlementService;
