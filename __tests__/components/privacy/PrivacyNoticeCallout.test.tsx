/**
 * PrivacyNoticeCallout tests.
 *
 * Verifies the next-launch notice for material privacy-policy changes: it is
 * visible when the current policy version was not dismissed, it disappears and
 * persists the dismissal, and it stays hidden on the next launch.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { PrivacyNoticeCallout } from '../../../src/components/privacy/PrivacyNoticeCallout';
import { CURRENT_POLICY_VERSION } from '../../../src/services/PrivacyNoticeService';

const AsyncStorage = require('@react-native-async-storage/async-storage');
const __resetStore = AsyncStorage.__resetStore;
const __getStore = AsyncStorage.__getStore;

const STORAGE_KEY = '@gitnotes:privacy_notice';

describe('PrivacyNoticeCallout', () => {
  beforeEach(() => {
    __resetStore();
  });

  test('shows the notice on the next launch when the policy version was not dismissed', async () => {
    const { getByTestId } = render(<PrivacyNoticeCallout />);

    await waitFor(() => expect(getByTestId('privacy-notice-callout')).toBeTruthy());
  });

  test('dismisses the notice and persists the dismissal on the device', async () => {
    const { getByTestId, queryByTestId } = render(<PrivacyNoticeCallout />);

    await waitFor(() => expect(getByTestId('privacy-notice-callout')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('privacy-notice-dismiss'));
    });

    expect(queryByTestId('privacy-notice-callout')).toBeNull();
    expect(JSON.parse(__getStore()[STORAGE_KEY]).dismissedVersion).toBe(CURRENT_POLICY_VERSION);
  });

  test('stays hidden on the next launch after the dismissal', async () => {
    const first = render(<PrivacyNoticeCallout />);
    await waitFor(() => expect(first.getByTestId('privacy-notice-callout')).toBeTruthy());
    await act(async () => {
      fireEvent.press(first.getByTestId('privacy-notice-dismiss'));
    });

    const second = render(<PrivacyNoticeCallout />);

    await waitFor(() => expect(second.queryByTestId('privacy-notice-callout')).toBeNull());
  });
});
