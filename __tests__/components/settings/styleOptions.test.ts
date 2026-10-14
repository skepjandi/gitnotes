import {
  DEFAULT_STYLE_OPTIONS,
  PRO_STYLE_OPTIONS,
  REFERRAL_STYLE_OPTIONS,
} from '../../../src/components/settings/styleOptions';
import { RewardEntitlementService } from '../../../src/services/RewardEntitlementService';

describe('styleOptions', () => {
  describe('DEFAULT_STYLE_OPTIONS', () => {
    it('contains two free style options', () => {
      expect(DEFAULT_STYLE_OPTIONS).toHaveLength(2);
    });

    it('defines basic (flat) and neo-brutalist as free', () => {
      const names = DEFAULT_STYLE_OPTIONS.map((o) => o.name);
      expect(names).toContain('flat');
      expect(names).toContain('neo-brutalist');
    });

    it('all default options have entitlement=default', () => {
      DEFAULT_STYLE_OPTIONS.forEach((option) => {
        expect(option.entitlement).toBe('default');
      });
    });
  });

  describe('PRO_STYLE_OPTIONS', () => {
    it('contains two pro style options', () => {
      expect(PRO_STYLE_OPTIONS).toHaveLength(2);
    });

    it('defines neumorphic and retrofuturistic as pro-locked', () => {
      const names = PRO_STYLE_OPTIONS.map((o) => o.name);
      expect(names).toContain('neumorphic');
      expect(names).toContain('retrofuturistic');
    });

    it('all pro options have entitlement=pro', () => {
      PRO_STYLE_OPTIONS.forEach((option) => {
        expect(option.entitlement).toBe('pro');
      });
    });
  });

  describe('REFERRAL_STYLE_OPTIONS', () => {
    it('contains three referral style options', () => {
      expect(REFERRAL_STYLE_OPTIONS).toHaveLength(3);
    });

    it('defines terminal-mono, crt-green, and developer-desk with correct milestones', () => {
      const byName = Object.fromEntries(REFERRAL_STYLE_OPTIONS.map((o) => [o.name, o]));
      expect(byName['terminal-mono']).toMatchObject({ milestone: 3, rewardKey: 'terminal-mono-theme' });
      expect(byName['crt-green']).toMatchObject({ milestone: 10, rewardKey: 'crt-green-theme' });
      expect(byName['developer-desk']).toMatchObject({ milestone: 20, rewardKey: 'developer-desk-theme' });
    });

    it('all referral options have entitlement=referral', () => {
      REFERRAL_STYLE_OPTIONS.forEach((option) => {
        expect(option.entitlement).toBe('referral');
      });
    });

    it('reward keys match Worker referral catalog theme entries', () => {
      const rewardKeys = REFERRAL_STYLE_OPTIONS.map((o) => o.rewardKey);
      expect(rewardKeys).toContain('terminal-mono-theme');
      expect(rewardKeys).toContain('crt-green-theme');
      expect(rewardKeys).toContain('developer-desk-theme');
    });
  });

  describe('SettingsContent integration — RewardEntitlementService.isUnlocked gating', () => {
    it('referral styles use RewardEntitlementService.isUnlocked as source of truth', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(false);
      const option = REFERRAL_STYLE_OPTIONS[0];
      expect(RewardEntitlementService.isUnlocked(option.rewardKey)).toBe(false);
    });

    it('referral style unlocks when RewardEntitlementService confirms', () => {
      jest.spyOn(RewardEntitlementService, 'isUnlocked').mockReturnValue(true);
      const option = REFERRAL_STYLE_OPTIONS[0];
      expect(RewardEntitlementService.isUnlocked(option.rewardKey)).toBe(true);
    });
  });
});
