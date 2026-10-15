import {
  isAppIconOptionUnlocked,
  isReferralAppIconUnlocked,
  getAppIconPreviewAsset,
  PRO_APP_ICON_OPTIONS,
  REFERRAL_APP_ICON_OPTIONS,
} from '../../../src/components/settings/referralAppIcons';

describe('referral app icon options', () => {
  it('defines the three referral icon names and milestones', () => {
    expect(REFERRAL_APP_ICON_OPTIONS.map((option) => [option.name, option.milestone])).toEqual([
      ['TerminalMono', 1],
      ['AmberTerminal', 5],
      ['MonochromeGrid', 15],
    ]);
  });

  it('gates each icon by referral progress', () => {
    expect(isReferralAppIconUnlocked(REFERRAL_APP_ICON_OPTIONS[0], 0)).toBe(false);
    expect(isReferralAppIconUnlocked(REFERRAL_APP_ICON_OPTIONS[0], 1)).toBe(true);
    expect(isReferralAppIconUnlocked(REFERRAL_APP_ICON_OPTIONS[1], 4)).toBe(false);
    expect(isReferralAppIconUnlocked(REFERRAL_APP_ICON_OPTIONS[2], 15)).toBe(true);
  });

  it('requires Pro for standard alternate icons', () => {
    expect(PRO_APP_ICON_OPTIONS).toHaveLength(3);
    expect(isAppIconOptionUnlocked(PRO_APP_ICON_OPTIONS[0], false, 20)).toBe(false);
    expect(isAppIconOptionUnlocked(PRO_APP_ICON_OPTIONS[0], true, 0)).toBe(true);
    expect(isAppIconOptionUnlocked(REFERRAL_APP_ICON_OPTIONS[0], false, 0)).toBe(false);
    expect(isAppIconOptionUnlocked(REFERRAL_APP_ICON_OPTIONS[0], false, 1)).toBe(true);
  });

  it('resolves the default preview asset from the repository root', () => {
    expect(getAppIconPreviewAsset(null, true)).toBeTruthy();
    expect(getAppIconPreviewAsset(null, false)).toBeTruthy();
  });
});
