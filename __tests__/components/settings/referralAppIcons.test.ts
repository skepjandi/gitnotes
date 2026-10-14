import {
  isReferralAppIconUnlocked,
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
});
