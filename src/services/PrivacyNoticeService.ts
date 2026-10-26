/**
 * PrivacyNoticeService.ts
 *
 * Tracks which material privacy-policy version the user has already seen so
 * the in-app notice appears once per version and the dismissal survives
 * restarts.
 *
 * Rules:
 * - The notice shows while the persisted dismissal version differs from the
 *   current policy version.
 * - A failed read leaves the notice visible, so a storage problem can never
 *   hide a material policy change.
 * - A failed write leaves the notice visible on the next launch.
 * - The dismissal is stored on the device and never leaves it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@gitnotes:privacy_notice';

/** Version of the material policy change this build discloses. */
export const CURRENT_POLICY_VERSION = '2026-10-24';

export interface PrivacyNoticeState {
  /** Policy version the user dismissed, or null when nothing was dismissed. */
  dismissedVersion: string | null;
  /** Wall-clock ms timestamp of the dismissal. */
  dismissedAt: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class PrivacyNoticeService {
  /**
   * Policy version the user dismissed, or null when nothing was dismissed or
   * the stored value cannot be read.
   */
  static async getDismissedVersion(): Promise<string | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;

      const version = parsed.dismissedVersion;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  }

  /** True while the user has not dismissed the current policy version. */
  static async shouldShowNotice(): Promise<boolean> {
    const dismissedVersion = await PrivacyNoticeService.getDismissedVersion();
    return dismissedVersion !== CURRENT_POLICY_VERSION;
  }

  /** Persists the dismissal of the current policy version on the device. */
  static async dismissNotice(): Promise<void> {
    try {
      const state: PrivacyNoticeState = {
        dismissedVersion: CURRENT_POLICY_VERSION,
        dismissedAt: Date.now(),
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A failed write leaves the notice visible on the next launch.
    }
  }
}
