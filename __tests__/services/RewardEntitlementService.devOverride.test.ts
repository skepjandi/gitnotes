import AsyncStorage from '@react-native-async-storage/async-storage';

const mockReferralsStatus = jest.fn();
const mockGetIdentityScope = jest.fn();
const mockGetIdentityProof = jest.fn();

jest.mock('../../src/services/workerApi', () => ({
  workerApi: {
    referrals: {
      status: (...args: unknown[]) => mockReferralsStatus(...args),
    },
  },
}));

jest.mock('../../src/services/ReferralIdentityService', () => ({
  ReferralIdentityService: {
    getIdentityProof: () => mockGetIdentityProof(),
  },
  getIdentityScope: () => mockGetIdentityScope(),
}));

import { REFERRAL_REWARD_CATALOG } from '../../src/types/worker';
import { RewardEntitlementService } from '../../src/services/RewardEntitlementService';

const originalOverride = process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS;
let persistedValue: string | null = null;

function serverStatus(progress: number) {
  return {
    has_pending_code: false,
    pending_code: null,
    pending_expires_at: null,
    progress,
    catalog_version: 1,
    unlocked_milestones: [],
    milestones: REFERRAL_REWARD_CATALOG.map((reward) => ({ ...reward, unlocked: false })),
  };
}

beforeEach(() => {
  mockReferralsStatus.mockReset();
  mockGetIdentityScope.mockResolvedValue({ kind: 'github', accountId: 'test-account', installationId: 'test-installation' });
  mockGetIdentityProof.mockResolvedValue({});
  mockReferralsStatus.mockResolvedValue(serverStatus(0));
  persistedValue = null;
  AsyncStorage.getItem = jest.fn().mockImplementation(async () => persistedValue);
  AsyncStorage.setItem = jest.fn().mockImplementation(async (_key: string, value: string) => {
    persistedValue = value;
  });
  delete process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS;
  RewardEntitlementService.resetMemory();
});

afterAll(() => {
  if (originalOverride === undefined) {
    delete process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS;
  } else {
    process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS = originalOverride;
  }
});

describe('development referral progress override', () => {
  it('unlocks the full catalog at 20 referrals', async () => {
    process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS = '20';

    const status = await RewardEntitlementService.fetchStatus();

    expect(status.progress).toBe(20);
    expect(status.unlocked_milestones).toEqual([1, 3, 5, 10, 15, 20]);
    expect(status.rewards.every((reward) => reward.unlocked)).toBe(true);
  });

  it('unlocks only milestones reached by the override', async () => {
    process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS = '5';

    const status = await RewardEntitlementService.fetchStatus();

    expect(status.progress).toBe(5);
    expect(status.unlocked_milestones).toEqual([1, 3, 5]);
    expect(status.rewards.filter((reward) => reward.unlocked).map((reward) => reward.milestone)).toEqual([1, 3, 5]);
  });

  it('ignores invalid override values', async () => {
    process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS = '-1.5';
    mockReferralsStatus.mockResolvedValue(serverStatus(2));

    const status = await RewardEntitlementService.fetchStatus();

    expect(status.progress).toBe(2);
    expect(status.unlocked_milestones).toEqual([]);
  });

  it('uses server progress when the override is unset', async () => {
    mockReferralsStatus.mockResolvedValue(serverStatus(7));

    const status = await RewardEntitlementService.fetchStatus();

    expect(status.progress).toBe(7);
    expect(status.rewards.every((reward) => !reward.unlocked)).toBe(true);
  });

  it('does not persist synthetic progress across hydration', async () => {
    process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS = '20';
    mockReferralsStatus.mockResolvedValue(serverStatus(2));

    const overridden = await RewardEntitlementService.fetchStatus();
    expect(overridden.progress).toBe(20);
    expect(JSON.parse(persistedValue ?? '{}').status.progress).toBe(2);

    RewardEntitlementService.resetMemory();
    const hydratedWithOverride = await RewardEntitlementService.hydrateCache();
    expect(hydratedWithOverride?.progress).toBe(20);

    delete process.env.EXPO_PUBLIC_DEV_REFERRAL_PROGRESS;
    RewardEntitlementService.resetMemory();
    const hydratedWithoutOverride = await RewardEntitlementService.hydrateCache();
    expect(hydratedWithoutOverride?.progress).toBe(2);
  });
});
