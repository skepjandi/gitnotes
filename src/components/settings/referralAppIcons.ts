import type { AppIconName } from '../../services/AppIconService';

type AppIconOptionBase = {
  name: Exclude<AppIconName, null>;
  label: string;
  assetSlug: 'neon' | 'grayscale' | 'gold' | 'terminal-mono' | 'amber-terminal' | 'monochrome-grid';
};

export type ProAppIconOption = AppIconOptionBase & {
  entitlement: 'pro';
};

export type ReferralAppIconOption = AppIconOptionBase & {
  entitlement: 'referral';
  milestone: number;
  rewardKey: string;
};

export const PRO_APP_ICON_OPTIONS: readonly ProAppIconOption[] = [
  { name: 'Neon', label: 'Neon', assetSlug: 'neon', entitlement: 'pro' },
  { name: 'Grayscale', label: 'Grayscale', assetSlug: 'grayscale', entitlement: 'pro' },
  { name: 'Gold', label: 'Gold', assetSlug: 'gold', entitlement: 'pro' },
];

export const REFERRAL_APP_ICON_OPTIONS: readonly ReferralAppIconOption[] = [
  { name: 'TerminalMono', milestone: 1, rewardKey: 'terminal-mono-icon', label: 'Terminal Mono', assetSlug: 'terminal-mono', entitlement: 'referral' },
  { name: 'AmberTerminal', milestone: 5, rewardKey: 'amber-terminal-icon', label: 'Amber Terminal', assetSlug: 'amber-terminal', entitlement: 'referral' },
  { name: 'MonochromeGrid', milestone: 15, rewardKey: 'monochrome-grid-icon', label: 'Monochrome Grid', assetSlug: 'monochrome-grid', entitlement: 'referral' },
];

export function isReferralAppIconUnlocked(option: ReferralAppIconOption, progress: number): boolean {
  return progress >= option.milestone;
}

export function isAppIconOptionUnlocked(option: ProAppIconOption | ReferralAppIconOption, isPro: boolean, progress: number): boolean {
  return option.entitlement === 'pro' ? isPro : isReferralAppIconUnlocked(option, progress);
}

export function getAppIconPreviewAsset(iconName: AppIconName | null, isDark: boolean) {
  if (iconName === null) {
    return isDark
      ? require('../../../assets/generated/icon-dark.png')
      : require('../../../assets/generated/icon-light.png');
  }
  switch (iconName) {
    case 'Neon':
      return isDark
        ? require('../../../assets/generated/alternate/neon-dark/icon.png')
        : require('../../../assets/generated/alternate/neon-light/icon.png');
    case 'Grayscale':
      return isDark
        ? require('../../../assets/generated/alternate/grayscale-dark/icon.png')
        : require('../../../assets/generated/alternate/grayscale-light/icon.png');
    case 'Gold':
      return isDark
        ? require('../../../assets/generated/alternate/gold-dark/icon.png')
        : require('../../../assets/generated/alternate/gold-light/icon.png');
    case 'TerminalMono':
      return isDark
        ? require('../../../assets/generated/alternate/terminal-mono-dark/icon.png')
        : require('../../../assets/generated/alternate/terminal-mono-light/icon.png');
    case 'AmberTerminal':
      return isDark
        ? require('../../../assets/generated/alternate/amber-terminal-dark/icon.png')
        : require('../../../assets/generated/alternate/amber-terminal-light/icon.png');
    case 'MonochromeGrid':
      return isDark
        ? require('../../../assets/generated/alternate/monochrome-grid-dark/icon.png')
        : require('../../../assets/generated/alternate/monochrome-grid-light/icon.png');
    default:
      return isDark
        ? require('../../../assets/generated/icon-dark.png')
        : require('../../../assets/generated/icon-light.png');
  }
}
