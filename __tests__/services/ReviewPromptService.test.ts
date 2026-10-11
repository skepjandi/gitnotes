/**
 * ReviewPromptService TDD tests.
 *
 * Tests cover:
 * 1. 14-day first-launch threshold
 * 2. Eligibility OR: successfulSyncCount >= 3 OR notesCreatedCount >= 5
 * 3. 90-day cooldown between prompt attempts
 * 4. Maximum 3 dismiss attempts cap
 * 5. Persistence across reload (AsyncStorage)
 * 6. Suppression during onboarding / sync-in-flight / recent failure
 * 7. Safe event recording (never throws)
 *
 * Run with: yarn jest __tests__/services/ReviewPromptService.test.ts --no-coverage --forceExit
 */

// ── Mocks for external dependencies ───────────────────────────────────────────

const mockAppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) };

jest.mock('expo-store-review');
jest.mock('expo-constants', () => ({
  expoConfig: {
    ios: { appStoreUrl: 'https://apps.apple.com/app/gitnotes/id6764829004' },
    android: { playStoreUrl: 'https://play.google.com/store/apps/details?id=org.gitnotes.app' },
  },
}));
jest.mock('../../src/services/ForegroundSyncService');
jest.mock('../../src/services/OnboardingService');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
  get AppState() { return mockAppState; },
}));

// ── Import mock helpers from jest.setup.ts global mock ────────────────────────

const AsyncStorage = require('@react-native-async-storage/async-storage');
const __resetStore = AsyncStorage.__resetStore;
const __getStore = AsyncStorage.__getStore;

function clearAsyncStorageStore() {
  __resetStore();
}

// ── Import service (uses static imports, mocks above intercept) ───────────────

import {
  checkEligibility,
  recordSuccessfulSync,
  recordNoteCreated,
  attemptNativeReviewPrompt,
  recordDismiss,
  openStoreListing,
  getPersistedState,
  __resetForTest,
  __forceStateForTest,
  maybeRequestReviewPrompt,
  __recordAndMaybePrompt,
  initializeOnLaunch,
} from '../../src/services/ReviewPromptService';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

async function setFirstLaunch(daysAgo: number) {
  await __forceStateForTest({ firstLaunchAt: Date.now() - daysAgo * DAY_MS });
}

async function setLastPrompt(daysAgo: number) {
  await __forceStateForTest({ lastPromptAt: Date.now() - daysAgo * DAY_MS });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ReviewPromptService', () => {
  beforeEach(async () => {
    clearAsyncStorageStore();

    const StoreReview = require('expo-store-review');
    StoreReview.isAvailableAsync.mockReset().mockResolvedValue(true);
    StoreReview.hasAction.mockReset().mockResolvedValue(true);
    StoreReview.requestReview.mockReset().mockResolvedValue(undefined);

    const { Linking } = require('react-native');
    Linking.canOpenURL.mockReset().mockResolvedValue(true);
    Linking.openURL.mockReset().mockResolvedValue(undefined);

    const OnboardingServiceModule = require('../../src/services/OnboardingService');
    OnboardingServiceModule.OnboardingService.isOnboardingCompleted.mockReset().mockResolvedValue(true);

    const FGSModule = require('../../src/services/ForegroundSyncService');
    FGSModule.isForegroundSyncInFlight.mockReset().mockReturnValue(false);
    FGSModule.getForegroundSyncHealth.mockReset().mockReturnValue({ status: 'ok', consecutiveFailures: 0 });

    await __resetForTest();
  });

  // ── 14-day first-launch threshold ─────────────────────────────────────────

  describe('14-day first-launch threshold', () => {
    it('not eligible on day 13', async () => {
      await setFirstLaunch(13);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'too_recent' });
    });

    it('eligible on day 14', async () => {
      await setFirstLaunch(14);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('eligible on day 100', async () => {
      await setFirstLaunch(100);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });
  });

  // ── Eligibility OR ───────────────────────────────────────────────────────

  describe('eligibility OR: successfulSyncCount >= 3 OR notesCreatedCount >= 5', () => {
    it('eligible with 3 syncs (no notes)', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 3, notesCreatedCount: 0 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('eligible with 5 notes (no syncs)', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 0, notesCreatedCount: 5 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('eligible with 2 syncs and 4 notes', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 2, notesCreatedCount: 4 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'not_enough_usage' });
    });

    it('not eligible with 2 syncs and 4 notes', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 2, notesCreatedCount: 4 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'not_enough_usage' });
    });

    it('not eligible with 0 syncs and 0 notes', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 0, notesCreatedCount: 0 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'not_enough_usage' });
    });
  });

  // ── 90-day cooldown ──────────────────────────────────────────────────────

  describe('90-day cooldown between prompt attempts', () => {
    it('not eligible 89 days after last prompt', async () => {
      await setFirstLaunch(200);
      await setLastPrompt(89);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'cooldown_active' });
    });

    it('eligible 90 days after last prompt', async () => {
      await setFirstLaunch(200);
      await setLastPrompt(90);
      await __forceStateForTest({ successfulSyncCount: 3 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('eligible when lastPromptAt is null (never prompted)', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 3, lastPromptAt: null });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });
  });

  // ── Max dismiss attempts ─────────────────────────────────────────────────

  describe('max dismiss attempts cap', () => {
    it('eligible with 0 dismiss attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 0 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('eligible with 2 dismiss attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 2 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('not eligible with 3 dismiss attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 3 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'max_dismiss_attempts' });
    });

    it('not eligible with 4 dismiss attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 4 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'max_dismiss_attempts' });
    });
  });

  // ── Suppression ─────────────────────────────────────────────────────────

  describe('suppression during onboarding / sync / failure', () => {
    it('suppressed during onboarding', async () => {
      require('../../src/services/OnboardingService').OnboardingService.isOnboardingCompleted.mockResolvedValue(false);
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'onboarding_incomplete' });
    });

    it('suppressed when sync is in flight', async () => {
      require('../../src/services/ForegroundSyncService').isForegroundSyncInFlight.mockReturnValue(true);
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'sync_in_flight' });
    });

    it('suppressed after recent failure', async () => {
      require('../../src/services/ForegroundSyncService').getForegroundSyncHealth.mockReturnValue({ status: 'failed', consecutiveFailures: 1 });
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'recent_failure' });
    });

    it('suppressed after recent timeout', async () => {
      require('../../src/services/ForegroundSyncService').getForegroundSyncHealth.mockReturnValue({ status: 'timedout', consecutiveFailures: 1 });
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'recent_failure' });
    });

    it('NOT suppressed when sync status is ok', async () => {
      require('../../src/services/ForegroundSyncService').getForegroundSyncHealth.mockReturnValue({ status: 'ok', consecutiveFailures: 0 });
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });
  });

  // ── Event recorders ─────────────────────────────────────────────────────

  describe('event recorders never throw', () => {
    it('recordSuccessfulSync does not throw', async () => {
      await expect(recordSuccessfulSync()).resolves.not.toThrow();
    });

    it('recordNoteCreated does not throw', async () => {
      await expect(recordNoteCreated()).resolves.not.toThrow();
    });

    it('recordDismiss does not throw', async () => {
      await expect(recordDismiss()).resolves.not.toThrow();
    });
  });

  // ── Counter increments ─────────────────────────────────────────────────────

  describe('counter increments', () => {
    it('recordSuccessfulSync increments sync count', async () => {
      await __forceStateForTest({ successfulSyncCount: 0 });
      await recordSuccessfulSync();
      const state = getPersistedState();
      expect(state.successfulSyncCount).toBe(1);
    });

    it('recordSuccessfulSync increments multiple times', async () => {
      await __forceStateForTest({ successfulSyncCount: 0 });
      await recordSuccessfulSync();
      await recordSuccessfulSync();
      const state = getPersistedState();
      expect(state.successfulSyncCount).toBe(2);
    });

    it('recordNoteCreated increments note count', async () => {
      await __forceStateForTest({ notesCreatedCount: 0 });
      await recordNoteCreated();
      const state = getPersistedState();
      expect(state.notesCreatedCount).toBe(1);
    });

    it('recordNoteCreated increments multiple times', async () => {
      await __forceStateForTest({ notesCreatedCount: 0 });
      await recordNoteCreated();
      await recordNoteCreated();
      const state = getPersistedState();
      expect(state.notesCreatedCount).toBe(2);
    });
  });

  // ── Persistence ─────────────────────────────────────────────────────────

  describe('persistence across reload', () => {
    it('persists successfulSyncCount to AsyncStorage', async () => {
      await __forceStateForTest({ successfulSyncCount: 0 });
      await recordSuccessfulSync();
      const store = __getStore();
      const stored = store['@gitnotes:review_prompt_state'];
      expect(JSON.parse(stored)).toMatchObject({ successfulSyncCount: 1 });
    });

    it('loads state from AsyncStorage on next check', async () => {
      // Reset service state first so loadState() will re-read from AsyncStorage
      await __resetForTest();
      const store = __getStore();
      store['@gitnotes:review_prompt_state'] = JSON.stringify({
        firstLaunchAt: Date.now() - 30 * DAY_MS,
        successfulSyncCount: 5,
        notesCreatedCount: 12,
        lastPromptAt: null,
        dismissAttempts: 0,
        dismissedAt: null,
        attemptsCount: 0,
      });
      const result = await checkEligibility();
      expect(result).toMatchObject({ successfulSyncCount: 5, notesCreatedCount: 12 });
    });

    it('sets firstLaunchAt on first load when no state exists', async () => {
      const state = getPersistedState();
      expect(state.firstLaunchAt).toBeDefined();
      expect(typeof state.firstLaunchAt).toBe('number');
    });

    it('recordDismiss increments dismissAttempts and sets dismissedAt', async () => {
      await __forceStateForTest({ dismissAttempts: 0, dismissedAt: null });
      await recordDismiss();
      const state = getPersistedState();
      expect(state.dismissAttempts).toBe(1);
      expect(state.dismissedAt).toBeDefined();
    });
  });

  // ── attemptNativeReviewPrompt ───────────────────────────────────────────

  describe('attemptNativeReviewPrompt', () => {
    it('returns false when isAvailableAsync is false', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(false);
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(false);
    });

    it('returns false when hasAction is false', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(false);
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(false);
    });

    it('calls requestReview and returns true when available', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockResolvedValue(undefined);
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(true);
      expect(require('expo-store-review').requestReview).toHaveBeenCalled();
    });

    it('updates lastPromptAt after successful native call', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockResolvedValue(undefined);
      await __forceStateForTest({ lastPromptAt: null });
      await attemptNativeReviewPrompt();
      const state = getPersistedState();
      expect(state.lastPromptAt).not.toBeNull();
    });

    it('returns false when requestReview throws', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockRejectedValue(new Error('native error'));
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(false);
    });
  });

  // ── openStoreListing ────────────────────────────────────────────────────

  describe('openStoreListing', () => {
    it('returns true and calls Linking.openURL with configured URL', async () => {
      require('react-native').Linking.canOpenURL.mockResolvedValue(true);
      const result = await openStoreListing();
      expect(result).toBe(true);
      expect(require('react-native').Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/gitnotes/id6764829004');
    });

    it('returns false when canOpenURL is false', async () => {
      require('react-native').Linking.canOpenURL.mockResolvedValue(false);
      const result = await openStoreListing();
      expect(result).toBe(false);
      expect(require('react-native').Linking.openURL).not.toHaveBeenCalled();
    });

    it('returns false when Linking.openURL throws', async () => {
      const { Linking } = require('react-native');
      Linking.canOpenURL.mockResolvedValue(true);
      Linking.openURL.mockRejectedValue(new Error('cannot open'));
      const result = await openStoreListing();
      expect(result).toBe(false);
    });
  });

  // ── Full pipeline ───────────────────────────────────────────────────────

  describe('full eligibility pipeline — all gates stacked', () => {
    it('fully eligible: 14+ days, 3 syncs, 90-day cooldown, 0 dismisses', async () => {
      await setFirstLaunch(30);
      await setLastPrompt(95);
      await __forceStateForTest({
        successfulSyncCount: 3,
        notesCreatedCount: 0,
        dismissAttempts: 0,
        lastPromptAt: Date.now() - 95 * DAY_MS,
      });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible' });
    });

    it('dismissing 3 times permanently suppresses', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 3 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'max_dismiss_attempts' });
    });

    it('all conditions met but onboarding incomplete suppresses', async () => {
      require('../../src/services/OnboardingService').OnboardingService.isOnboardingCompleted.mockResolvedValue(false);
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, dismissAttempts: 0 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'onboarding_incomplete' });
    });
  });

  // ── Max total native attempts ─────────────────────────────────────────────

  describe('max total native prompt attempts cap', () => {
    it('eligible with 0 attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 0 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible', attemptsCount: 0 });
    });

    it('eligible with 2 attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 2 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: true, reason: 'eligible', attemptsCount: 2 });
    });

    it('not eligible with 3 attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 3 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'max_attempts' });
    });

    it('not eligible with 4 attempts', async () => {
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 4 });
      const result = await checkEligibility();
      expect(result).toMatchObject({ eligible: false, reason: 'max_attempts' });
    });
  });

  // ── attemptNativeReviewPrompt increments attemptsCount ─────────────────────

  describe('attemptNativeReviewPrompt increments attemptsCount', () => {
    it('increments attemptsCount after successful native call', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockResolvedValue(undefined);
      await __forceStateForTest({ attemptsCount: 0, lastPromptAt: null });
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(true);
      const state = getPersistedState();
      expect(state.attemptsCount).toBe(1);
    });

    it('does not increment when isAvailableAsync returns false', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(false);
      await __forceStateForTest({ attemptsCount: 0 });
      await attemptNativeReviewPrompt();
      const state = getPersistedState();
      expect(state.attemptsCount).toBe(0);
    });

    it('does not increment when hasAction returns false', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(false);
      await __forceStateForTest({ attemptsCount: 0 });
      await attemptNativeReviewPrompt();
      const state = getPersistedState();
      expect(state.attemptsCount).toBe(0);
    });

    it('increments even when requestReview throws (hard cap — counts the attempt, not the outcome)', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockRejectedValue(new Error('native error'));
      await __forceStateForTest({ attemptsCount: 0 });
      const result = await attemptNativeReviewPrompt();
      expect(result).toBe(false);
      const state = getPersistedState();
      expect(state.attemptsCount).toBe(1);
    });

    it('accumulates across multiple calls', async () => {
      require('expo-store-review').isAvailableAsync.mockResolvedValue(true);
      require('expo-store-review').hasAction.mockResolvedValue(true);
      require('expo-store-review').requestReview.mockResolvedValue(undefined);
      await __forceStateForTest({ attemptsCount: 0, lastPromptAt: null });
      await attemptNativeReviewPrompt();
      await new Promise(r => setTimeout(r, 0));
      await attemptNativeReviewPrompt();
      const state = getPersistedState();
      // Single-flight lock: only the first call succeeds; second returns false immediately
      expect(state.attemptsCount).toBe(1);
    });
  });

  // ── initializeOnLaunch ───────────────────────────────────────────────────────

  describe('initializeOnLaunch', () => {
    it('sets firstLaunchAt when no state exists', async () => {
      await __resetForTest();
      // Simulate no persisted state — loadState will record firstLaunchAt
      await initializeOnLaunch();
      const state = getPersistedState();
      expect(state.firstLaunchAt).toBeDefined();
      expect(typeof state.firstLaunchAt).toBe('number');
    });

    it('is idempotent — does not overwrite existing firstLaunchAt', async () => {
      await __forceStateForTest({ firstLaunchAt: 1000000000000 });
      const before = (getPersistedState()).firstLaunchAt;
      await initializeOnLaunch();
      const after = (getPersistedState()).firstLaunchAt;
      expect(after).toBe(before);
    });
  });

  // ── maybeRequestReviewPrompt ───────────────────────────────────────────────

  describe('maybeRequestReviewPrompt', () => {
    it('returns early when app is not in foreground', async () => {
      const prev = mockAppState.currentState;
      mockAppState.currentState = 'background';
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 0 });
      await maybeRequestReviewPrompt();
      mockAppState.currentState = prev;
      expect(require('expo-store-review').requestReview).not.toHaveBeenCalled();
    });

    it('calls requestReview when eligible and in foreground via maybeRequestReviewPrompt', async () => {
      mockAppState.currentState = 'active';
      const storeReview = require('expo-store-review');
      storeReview.isAvailableAsync.mockResolvedValue(true);
      storeReview.hasAction.mockResolvedValue(true);
      storeReview.requestReview.mockResolvedValue(undefined);
      await setFirstLaunch(30);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 0, lastPromptAt: null });
      await maybeRequestReviewPrompt();
      expect(storeReview.requestReview).toHaveBeenCalled();
    });

    it('does not call attemptNativeReviewPrompt when not eligible', async () => {
      const prev = mockAppState.currentState;
      mockAppState.currentState = 'active';
      await setFirstLaunch(13);
      await __forceStateForTest({ successfulSyncCount: 10, attemptsCount: 0 });
      await maybeRequestReviewPrompt();
      mockAppState.currentState = prev;
      expect(require('expo-store-review').requestReview).not.toHaveBeenCalled();
    });
  });

  describe('__recordAndMaybePrompt', () => {
    it('increments sync count and calls requestReview when usage threshold is met', async () => {
      mockAppState.currentState = 'active';
      const storeReview = require('expo-store-review');
      storeReview.isAvailableAsync.mockResolvedValue(true);
      storeReview.hasAction.mockResolvedValue(true);
      storeReview.requestReview.mockResolvedValue(undefined);
      await setFirstLaunch(30);
      // Start with 2 syncs — below the threshold of 3
      await __forceStateForTest({ successfulSyncCount: 2, attemptsCount: 0, lastPromptAt: null });
      await __recordAndMaybePrompt('sync');
      const state = getPersistedState();
      expect(state.successfulSyncCount).toBe(3);
      expect(storeReview.requestReview).toHaveBeenCalled();
    });

    it('increments note count and calls requestReview when usage threshold is met', async () => {
      mockAppState.currentState = 'active';
      const storeReview = require('expo-store-review');
      storeReview.isAvailableAsync.mockResolvedValue(true);
      storeReview.hasAction.mockResolvedValue(true);
      storeReview.requestReview.mockResolvedValue(undefined);
      await setFirstLaunch(30);
      // Start with 4 notes — below the threshold of 5
      await __forceStateForTest({ notesCreatedCount: 4, attemptsCount: 0, lastPromptAt: null });
      await __recordAndMaybePrompt('note');
      const state = getPersistedState();
      expect(state.notesCreatedCount).toBe(5);
      expect(storeReview.requestReview).toHaveBeenCalled();
    });

    it('persists counter before eligibility check — threshold met after increment', async () => {
      mockAppState.currentState = 'active';
      const storeReview = require('expo-store-review');
      storeReview.isAvailableAsync.mockResolvedValue(true);
      storeReview.hasAction.mockResolvedValue(true);
      storeReview.requestReview.mockResolvedValue(undefined);
      await setFirstLaunch(30);
      // successfulSyncCount = 2, notesCreatedCount = 4 — neither threshold met alone
      await __forceStateForTest({ successfulSyncCount: 2, notesCreatedCount: 4, attemptsCount: 0, lastPromptAt: null });
      await __recordAndMaybePrompt('sync');
      // After sync increment: successfulSyncCount = 3 >= threshold → eligible → requestReview called
      expect(storeReview.requestReview).toHaveBeenCalled();
    });
  });
});
