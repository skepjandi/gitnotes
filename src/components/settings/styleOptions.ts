/**
 * Style options data for the theme picker in SettingsContent.
 *
 * Mirrors the pattern established by referralAppIcons.ts.
 *
 * Theme grouping:
 *   Default (free)          — Basic (flat), Neo-Brutalist
 *   Pro (paywall)           — Neumorphic, Retrofuturistic
 *   Referral Rewards        — Terminal Mono (milestone 3), CRT Green (milestone 10), Developer Desk (milestone 20)
 *
 * Entitlement model:
 *   Default styles  — free for all users
 *   Pro styles     — Pro only (paywall for free users)
 *   Referral styles — server-authoritative unlock via RewardEntitlementService.isUnlocked(rewardKey)
 */

import type { ThemeStyle } from '../../theme/tokens';

type StyleOptionBase = {
  name: ThemeStyle;
  /** Human-readable testID matching the original hardcoded values in SettingsContent tests */
  testID: string;
  labelKey: string;
};

export type DefaultStyleOption = StyleOptionBase & {
  entitlement: 'default';
};

export type ProStyleOption = StyleOptionBase & {
  entitlement: 'pro';
};

export type ReferralStyleOption = StyleOptionBase & {
  entitlement: 'referral';
  milestone: number;
  rewardKey: string;
};

export type StyleOption = DefaultStyleOption | ProStyleOption | ReferralStyleOption;

export const DEFAULT_STYLE_OPTIONS: readonly DefaultStyleOption[] = [
  { name: 'flat', testID: 'settings.option.style.basic', labelKey: 'settings.style.basic', entitlement: 'default' },
  { name: 'neo-brutalist', testID: 'settings.option.style.neo-brutalist', labelKey: 'settings.style.neoBrutalist', entitlement: 'default' },
] as const;

export const PRO_STYLE_OPTIONS: readonly ProStyleOption[] = [
  { name: 'neumorphic', testID: 'settings.option.style.neumorphic', labelKey: 'settings.style.neumorphic', entitlement: 'pro' },
  { name: 'retrofuturistic', testID: 'settings.option.style.retrofuturistic', labelKey: 'settings.style.retrofuturistic', entitlement: 'pro' },
] as const;

export const REFERRAL_STYLE_OPTIONS: readonly ReferralStyleOption[] = [
  { name: 'terminal-mono', testID: 'settings.option.style.terminal-mono', labelKey: 'settings.style.terminalMono', milestone: 3, rewardKey: 'terminal-mono-theme', entitlement: 'referral' },
  { name: 'crt-green', testID: 'settings.option.style.crt-green', labelKey: 'settings.style.crtGreen', milestone: 10, rewardKey: 'crt-green-theme', entitlement: 'referral' },
  { name: 'developer-desk', testID: 'settings.option.style.developer-desk', labelKey: 'settings.style.developerDesk', milestone: 20, rewardKey: 'developer-desk-theme', entitlement: 'referral' },
] as const;
