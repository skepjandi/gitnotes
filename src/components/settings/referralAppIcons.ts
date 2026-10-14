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
