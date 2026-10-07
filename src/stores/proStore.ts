import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import {
  configureRevenueCat,
  getCustomerInfo,
  getPackages,
  logInAppUser,
  logOutAppUser,
  onCustomerInfoUpdate,
  purchasePackage as purchasePackageWith,
  restorePurchases,
} from '../services/RevenueCatService';
import * as PaywallAnalytics from '../services/PaywallAnalytics';
import { AuthService } from '../services/AuthService';
import type { HostConnectionSummary } from '../services/AuthService';

let _isDevice: boolean | null = null;
let _customerInfoCleanup: (() => void) | null = null;

function isSimulator(): boolean {
  if (_isDevice === null) {
    try { _isDevice = require('expo-device').isDevice; } catch { _isDevice = true; }
  }
  return _isDevice === false;
}
/** Dev-only override: forces Pro gate open on iOS/Android simulator so QA can test paid features without IAP.
 *
 * NOT a payment bypass — RevenueCat calls (initialize/refresh/purchase/restore) run unchanged.
 * Only the derived gate (`selectIsPro` + `status`) is forced to `true` / `'pro'` in this path.
 *
 * Gate: `__DEV__ && ((Platform.OS === 'ios' && isSimulator()) || Platform.OS === 'android') && EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR !== 'false'`
 * - `__DEV__`: compiled out in production builds.
 * - `Platform.OS === 'ios' && isSimulator()`: iOS simulator only.
 * - `Platform.OS === 'android'`: all Android (simulator + device in dev).
 * - `EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR !== 'false'`: defaults true, set to 'false' to test paywalls.
 */
export const DEV_FORCE_PRO =
  __DEV__ &&
  ((Platform.OS === 'ios' && isSimulator()) || Platform.OS === 'android') &&
  process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR !== 'false';

/** Dev-only override: keeps the Pro gate closed on iOS Simulator for paywall QA.
 *
 * RevenueCat state and calls remain unchanged; only the derived gate and status
 * are forced to Free in this path.
 */
export const DEV_FORCE_FREE =
  __DEV__ &&
  Platform.OS === 'ios' &&
  isSimulator() &&
  process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR === 'false';

const TRIAL_WAS_ACTIVE_KEY = '@gitnotes:trial_was_active';
const TRIAL_EXPIRED_AT_KEY = '@gitnotes:trial_expired_at';
const INTERSTITIAL_SHOWN_KEY = '@gitnotes:interstitial_offer_shown';
const INTERSTITIAL_DELAY = 3 * 24 * 60 * 60 * 1000;

export const PRO_ENTITLEMENT_ID = 'GitNotēs Pro';

export type ProStatus = 'loading' | 'pro' | 'free';

export type RestoreOutcome = 'restored' | 'nothing' | 'cancelled' | 'error';

interface ProState {
  status: ProStatus;
  entitlementActive: boolean;
  trialActive: boolean;
  trialEndsAt: number | null;
  entitlementExpiresAt: number | null;
  offeringsReady: boolean;
  monthlyPackage: PurchasesPackage | null;
  yearlyPackage: PurchasesPackage | null;
  lifetimePackage: PurchasesPackage | null;
  currentOffering: PurchasesOffering | null;
  isPurchasing: boolean;
  isRestoring: boolean;
  error: string | null;
  interstitialEligible: boolean;
  configured: boolean;
}

interface ProActions {
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  purchaseMonthly: () => Promise<void>;
  purchaseYearly: () => Promise<void>;
  purchaseLifetime: () => Promise<void>;
  restore: () => Promise<RestoreOutcome>;
  loadOfferingsIfNeeded: () => Promise<void>;
  markInterstitialShown: () => Promise<void>;
  bindAccount: (appUserID: string) => Promise<void>;
  unbindAccount: () => Promise<void>;
}

export const selectIsPro = (state: ProState): boolean =>
  DEV_FORCE_PRO || (!DEV_FORCE_FREE && state.entitlementActive);

export function statusForEntitlement(entitlementActive: boolean): ProStatus {
  if (DEV_FORCE_PRO) return 'pro';
  if (DEV_FORCE_FREE) return 'free';
  return entitlementActive ? 'pro' : 'free';
}

interface CustomerInfoLike {
  entitlements?: {
    active?: Record<
      string,
      { isActive?: boolean; periodType?: string; expiresDate?: string | null }
    >;
  };
  originalApplicationVersion?: string | null;
}

function rcAppUserIdFor(host: HostConnectionSummary | null): string | null {
  if (!host) return null;
  return `gitnotes:${host.provider}:${host.hostUserId}`;
}

function deriveTrialInfo(customerInfo: CustomerInfoLike | null): {
  entitlementActive: boolean;
  trialActive: boolean;
  trialEndsAt: number | null;
  entitlementExpiresAt: number | null;
} {
  const entitlement = customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
  const entitlementActive = Boolean(entitlement?.isActive);
  const trialActive = entitlementActive && entitlement?.periodType === 'TRIAL';
  const expiresMs = entitlement?.expiresDate ? Date.parse(entitlement.expiresDate) : NaN;
  return {
    entitlementActive,
    trialActive,
    trialEndsAt: trialActive && Number.isFinite(expiresMs) ? expiresMs : null,
    entitlementExpiresAt: entitlementActive && Number.isFinite(expiresMs) ? expiresMs : null,
  };
}

async function readStored(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

async function evaluateInterstitial(
  entitlementActive: boolean,
  set: (partial: Partial<ProState>) => void,
): Promise<void> {
  if (entitlementActive) {
    await AsyncStorage.setItem(TRIAL_WAS_ACTIVE_KEY, 'true');
    return;
  }
  const wasActive = (await readStored(TRIAL_WAS_ACTIVE_KEY)) === 'true';
  if (!wasActive) return;
  const expiredAtRaw = await readStored(TRIAL_EXPIRED_AT_KEY);
  const expiredAt = expiredAtRaw ? Number.parseInt(expiredAtRaw, 10) : NaN;
  if (!Number.isFinite(expiredAt)) {
    await AsyncStorage.setItem(TRIAL_EXPIRED_AT_KEY, String(Date.now()));
    return;
  }
  const shown = (await readStored(INTERSTITIAL_SHOWN_KEY)) === 'true';
  if (!shown && Date.now() >= expiredAt + INTERSTITIAL_DELAY) {
    set({ interstitialEligible: true });
  }
}

export const useProStore = create<ProState & ProActions>()((set, get) => ({
  status: 'loading',
  entitlementActive: false,
  trialActive: false,
  trialEndsAt: null,
  entitlementExpiresAt: null,
  offeringsReady: false,
  monthlyPackage: null,
  yearlyPackage: null,
  lifetimePackage: null,
  currentOffering: null,
  isPurchasing: false,
  isRestoring: false,
  error: null,
  interstitialEligible: false,
  configured: false,

  initialize: async () => {
    let customerInfo: CustomerInfoLike | null = null;
    let rcError: string | null = null;

    let appUserID: string | null = null;
    try {
      const activeSummary = await AuthService.getActiveSummary();
      const activeHost = activeSummary?.hosts.find((h) => h.id === activeSummary.activeHostId)
        ?? activeSummary?.hosts[0]
        ?? null;
      appUserID = rcAppUserIdFor(activeHost);
    } catch {
      // AuthService unavailable — configure anonymously
    }

    try {
      const { configured } = await configureRevenueCat(appUserID);
      set({ configured });
      if (configured) {
        customerInfo = await getCustomerInfo();
        _customerInfoCleanup?.();
        _customerInfoCleanup = onCustomerInfoUpdate(async (info) => {
          const derived = deriveTrialInfo(info);
          set(() => ({
            ...derived,
            status: statusForEntitlement(derived.entitlementActive),
          }));
          await evaluateInterstitial(derived.entitlementActive, set);
        });
      }
    } catch (error) {
      rcError = error instanceof Error ? error.message : 'Failed to initialize RevenueCat';
    }

    try {
      const derived = deriveTrialInfo(customerInfo);
      set({
        ...derived,
        status: statusForEntitlement(derived.entitlementActive),
        ...(rcError ? { error: rcError } : {}),
      });
      await evaluateInterstitial(derived.entitlementActive, set);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to initialize Pro store' });
    }
  },

  refresh: async () => {
    try {
      const customerInfo = await getCustomerInfo();
      const derived = deriveTrialInfo(customerInfo);
      set(() => ({
        ...derived,
        status: statusForEntitlement(derived.entitlementActive),
        error: null,
      }));
      await evaluateInterstitial(derived.entitlementActive, set);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to refresh Pro' });
    }
  },

  purchaseMonthly: async () => {
    const pkg = get().monthlyPackage;
    if (!pkg) return;
    set({ isPurchasing: true, error: null });
    PaywallAnalytics.trackPurchaseAttempt(pkg.product.identifier);
    const result = await purchasePackageWith(pkg);
    PaywallAnalytics.trackPurchaseOutcome(result.kind);
    set({ isPurchasing: false });
    if (result.kind === 'purchased') {
      await get().refresh();
    } else if (result.kind === 'error') {
      set({ error: result.message });
    } else {
      set({ error: null });
    }
  },

  purchaseYearly: async () => {
    const pkg = get().yearlyPackage;
    if (!pkg) return;
    set({ isPurchasing: true, error: null });
    PaywallAnalytics.trackPurchaseAttempt(pkg.product.identifier);
    const result = await purchasePackageWith(pkg);
    PaywallAnalytics.trackPurchaseOutcome(result.kind);
    set({ isPurchasing: false });
    if (result.kind === 'purchased') {
      await get().refresh();
    } else if (result.kind === 'error') {
      set({ error: result.message });
    } else {
      set({ error: null });
    }
  },

  purchaseLifetime: async () => {
    const pkg = get().lifetimePackage;
    if (!pkg) return;
    set({ isPurchasing: true, error: null });
    PaywallAnalytics.trackPurchaseAttempt(pkg.product.identifier);
    const result = await purchasePackageWith(pkg);
    PaywallAnalytics.trackPurchaseOutcome(result.kind);
    set({ isPurchasing: false });
    if (result.kind === 'purchased') {
      await get().refresh();
    } else if (result.kind === 'error') {
      set({ error: result.message });
    } else {
      set({ error: null });
    }
  },

  restore: async () => {
    set({ isRestoring: true, error: null });
    PaywallAnalytics.trackRestoreTap();
    try {
      const result = await restorePurchases();
      if (result.kind === 'error') {
        set({ isRestoring: false, error: result.message });
        PaywallAnalytics.trackRestoreOutcome('error');
        return 'error';
      }
      if (result.kind === 'cancelled') {
        set({ isRestoring: false });
        PaywallAnalytics.trackRestoreOutcome('cancelled');
        return 'cancelled';
      }
      const proActive = Boolean(
        result.customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID]?.isActive,
      );
      if (!proActive) {
        set({ isRestoring: false });
        PaywallAnalytics.trackRestoreOutcome('nothing');
        return 'nothing';
      }
      await get().refresh();
      set({ isRestoring: false });
      PaywallAnalytics.trackRestoreOutcome('restored');
      return 'restored';
    } catch (error) {
      set({
        isRestoring: false,
        error: error instanceof Error ? error.message : 'Failed to restore purchases',
      });
      PaywallAnalytics.trackRestoreOutcome('error');
      return 'error';
    }
  },

  loadOfferingsIfNeeded: async () => {
    if (get().offeringsReady) return;
    try {
      const packages = await getPackages();
      if (!packages) {
        set({ offeringsReady: false, error: 'No offerings available from RevenueCat' });
        return;
      }
      set({
        monthlyPackage: packages.monthly ?? null,
        yearlyPackage: packages.yearly ?? null,
        lifetimePackage: packages.lifetime ?? null,
        currentOffering: packages.offerings?.current ?? null,
        offeringsReady: true,
        error: null,
      });
    } catch (error) {
      set({
        offeringsReady: false,
        error: error instanceof Error ? error.message : 'Failed to load offerings',
      });
    }
  },

  markInterstitialShown: async () => {
    await AsyncStorage.setItem(INTERSTITIAL_SHOWN_KEY, 'true');
    set({ interstitialEligible: false });
  },

  bindAccount: async (appUserID) => {
    if (!get().configured) return;
    const customerInfo = await logInAppUser(appUserID);
    if (!customerInfo) return;
    const derived = deriveTrialInfo(customerInfo);
    set(() => ({
      ...derived,
      status: statusForEntitlement(derived.entitlementActive),
    }));
  },

  unbindAccount: async () => {
    if (!get().configured) return;
    await logOutAppUser();
    set({
      entitlementActive: false,
      trialActive: false,
      trialEndsAt: null,
      entitlementExpiresAt: null,
      status: statusForEntitlement(false),
    });
  },
}));
