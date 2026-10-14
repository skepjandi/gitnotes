import type { AppIconName } from '../../services/AppIconService';

export type ReferralAppIconOption = {
  name: Exclude<AppIconName, null>;
  milestone: number;
  rewardKey: string;
  label: string;
  assetSlug: 'terminal-mono' | 'amber-terminal' | 'monochrome-grid';
};

export const REFERRAL_APP_ICON_OPTIONS: readonly ReferralAppIconOption[] = [
  { name: 'TerminalMono', milestone: 1, rewardKey: 'terminal-mono-icon', label: 'Terminal Mono', assetSlug: 'terminal-mono' },
  { name: 'AmberTerminal', milestone: 5, rewardKey: 'amber-terminal-icon', label: 'Amber Terminal', assetSlug: 'amber-terminal' },
  { name: 'MonochromeGrid', milestone: 15, rewardKey: 'monochrome-grid-icon', label: 'Monochrome Grid', assetSlug: 'monochrome-grid' },
];

export function isReferralAppIconUnlocked(option: ReferralAppIconOption, progress: number): boolean {
  return progress >= option.milestone;
}
