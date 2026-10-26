/**
 * PrivacyNoticeService tests.
 *
 * Run with:
 *   yarn jest __tests__/services/PrivacyNoticeService.test.ts --no-coverage --forceExit
 */

const AsyncStorage = require('@react-native-async-storage/async-storage');
const __resetStore = AsyncStorage.__resetStore;
const __getStore = AsyncStorage.__getStore;

import {
  CURRENT_POLICY_VERSION,
  PrivacyNoticeService,
} from '../../src/services/PrivacyNoticeService';

const STORAGE_KEY = '@gitnotes:privacy_notice';

describe('PrivacyNoticeService', () => {
  beforeEach(() => {
    __resetStore();
    jest.clearAllMocks();
  });

  test('shows the notice when nothing has been dismissed', async () => {
    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });

  test('hides the notice after the current version is dismissed', async () => {
    await PrivacyNoticeService.dismissNotice();

    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(false);
  });

  test('persists the dismissal on the device', async () => {
    await PrivacyNoticeService.dismissNotice();

    const stored = __getStore()[STORAGE_KEY];
    expect(stored).toBeDefined();
    expect(JSON.parse(stored).dismissedVersion).toBe(CURRENT_POLICY_VERSION);
  });

  test('shows the notice again when a newer policy version is published', async () => {
    await PrivacyNoticeService.dismissNotice();
    __getStore()[STORAGE_KEY] = JSON.stringify({
      dismissedVersion: '2020-01-01',
      dismissedAt: 0,
    });

    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });

  test('shows the notice when the stored value cannot be parsed', async () => {
    __getStore()[STORAGE_KEY] = 'not json';

    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });

  test('shows the notice when the stored value has no version', async () => {
    __getStore()[STORAGE_KEY] = JSON.stringify({ dismissedAt: 1 });

    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });

  test('keeps the notice visible when the storage read fails', async () => {
    AsyncStorage.default.getItem.mockRejectedValueOnce(new Error('storage unavailable'));

    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });

  test('keeps the dismissal unpersisted when the storage write fails', async () => {
    AsyncStorage.default.setItem.mockRejectedValueOnce(new Error('storage unavailable'));

    await PrivacyNoticeService.dismissNotice();

    expect(__getStore()[STORAGE_KEY]).toBeUndefined();
    expect(await PrivacyNoticeService.shouldShowNotice()).toBe(true);
  });
});
