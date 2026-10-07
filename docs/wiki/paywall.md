# Paywall & Pro Tier

> Complete guide to GitNotēs Pro — RevenueCat integration, StoreKit 2, entitlements, feature gates, and analytics. See [Architecture](./architecture.md) for context.

## Pro Tier Features

GitNotēs has two tiers: **Free** and **Pro**.

| Feature | Free | Pro |
|---------|------|-----|
| Notes, todos, canvases | ✅ | ✅ |
| GitHub sync | ✅ | ✅ |
| Neumorphic UI | ❌ | ✅ |
| Retrofuturistic UI | ❌ | ✅ |
| Neo-Brutalist UI | ✅ | ✅ |
| Customizable accent color | ❌ | ✅ |
| Advanced AI (Claude 3.5, GPT-4o) | ❌ | ✅ |
| Multi-host (GitLab, Gitea) | ❌ | ✅ |
| Repositories | 1 | Unlimited |
| Account/provider/host identities | 1 | Unlimited |
| Canvas AI vision | Limited | ✅ |
| Priority support | ❌ | ✅ |

## RevenueCat Integration

**Package:** `react-native-purchases` (v10.7.1) wrapping RevenueCat SDK

**Entitlement ID:** `GitNotēs Pro`

**File:** `src/services/RevenueCatService.ts`

### Initialization

```typescript
// Called once on app start via proStore.initialize()
configureRevenueCat()
  .then(({ configured }) => {
    if (configured) {
      // RevenueCat is active — entitlements will be checked
    } else {
      // Placeholder API key — Pro features hidden
    }
  });
```

API keys are configured via environment variables:
- `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` — iOS RevenueCat key
- `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` — Android RevenueCat key

### StoreKit 2

On iOS, RevenueCat uses StoreKit 2 automatically:

```typescript
// RevenueCatService.ts:46
await Purchases.configure({
  apiKey,
  storeKitVersion: STOREKIT_VERSION.STOREKIT_2, // Force StoreKit 2
});
```

StoreKit 2 provides:
- Faster purchase confirmation
- Improved subscription status tracking
- Better offline purchase handling

### Package Types

Three subscription packages are offered:

```typescript
interface Packages {
  monthly: PurchasesPackage;    // $3.99/month
  yearly?: PurchasesPackage;   // $29.99/year (optional)
  lifetime?: PurchasesPackage;  // $39.99 one-time (optional)
  offerings: PurchasesOfferings;
}
```

Packages are loaded via `getPackages()` which queries RevenueCat's offerings endpoint and matches package identifiers.

### Key RevenueCatService Exports

| Function | Purpose |
|---------|---------|
| `configureRevenueCat()` | Initialize RevenueCat SDK |
| `getPackages()` | Load available subscription packages |
| `purchasePackage(pkg)` | Initiate purchase flow |
| `restorePurchases()` | Restore purchases from App Store |
| `getCustomerInfo()` | Fetch current entitlement status |
| `logInAppUser(id)` | Bind RevenueCat identity to app user ID (cross-device sync) |
| `logOutAppUser()` | Reset to anonymous identity |
| `trackPaywallImpression(offering)` | Track paywall view event |

---

## Pro Store (`src/stores/proStore.ts`)

The `proStore` is the central state manager for Pro tier.

### ProState

```typescript
interface ProState {
  status: 'loading' | 'pro' | 'free';
  entitlementActive: boolean;     // True if user has active Pro entitlement

  trialActive: boolean;           // True if in trial period
  trialEndsAt: number | null;   // Trial end timestamp
  entitlementExpiresAt: number | null;
  offeringsReady: boolean;
  monthlyPackage: PurchasesPackage | null;
  yearlyPackage: PurchasesPackage | null;
  lifetimePackage: PurchasesPackage | null;
  currentOffering: PurchasesOffering | null;
  isPurchasing: boolean;
  isRestoring: boolean;
  error: string | null;
  interstitialEligible: boolean;  // Show interstitial after trial ends
  configured: boolean;               // RevenueCat SDK initialized
}
```

### ProActions

| Action | Purpose |
|--------|---------|
| `initialize()` | Boot RevenueCat, resolve entitlement |
| `refresh()` | Re-fetch customer info after purchase/restore |
| `purchaseMonthly()` | Purchase monthly subscription |
| `purchaseYearly()` | Purchase annual subscription |
| `purchaseLifetime()` | Purchase one-time lifetime access |
| `restore()` | Restore purchases — checks App Store for existing entitlement |
| `loadOfferingsIfNeeded()` | Load subscription packages if not yet loaded |
| `markInterstitialShown()` | Mark that the paywall interstitial was shown |
| `bindAccount(appUserID)` | Bind RevenueCat account to GitNotēs account for cross-device Pro |
| `unbindAccount()` | Remove account binding |

### Simulator Pro/Free Overrides

In development (`__DEV__`), the `EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR` variable controls QA access:

- On iOS Simulator, the default (unset or any value other than `'false'`) forces Pro open without real IAP.
- On iOS Simulator, setting it to `'false'` forces the derived Pro gate and status to Free so paywalls can be tested even when RevenueCat reports an entitlement.
- On Android in development, the default forces Pro open; setting it to `'false'` disables that Pro bypass and uses the real entitlement.
- Physical iOS devices and production builds always use the real entitlement.

```typescript
export const DEV_FORCE_PRO =
  __DEV__ &&
  ((Platform.OS === 'ios' && isSimulator()) || Platform.OS === 'android') &&
  process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR !== 'false';

export const DEV_FORCE_FREE =
  __DEV__ &&
  Platform.OS === 'ios' &&
  isSimulator() &&
  process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR === 'false';
```

The Pro-bypass gate is `__DEV__ && (iOS simulator || Android) && env !== 'false'`.
The Free-for-paywall-QA gate is `__DEV__ && iOS simulator && env === 'false'`.

> **Note:** These overrides do NOT bypass or alter RevenueCat calls. The SDK still initializes and makes API calls; only the derived gate and status are overridden.

---

## Feature Gates

### `useProGate()`

**File:** `src/hooks/useProGate.ts`

```typescript
// Safe to call anywhere (does NOT use navigation)
export function useProStatus() {
  const isPro = useProStore(selectIsPro);
  const status = useProStore(s => s.status);
  return { isPro, status, loading: status === 'loading' };
}

// Opens paywall if non-Pro user tries to access Pro feature
export function useProGate() {
  const { isPro, status, loading } = useProStatus();
  const openPaywall = useCallback(() => navigation.navigate('Paywall'), []);
  return { isPro, status, loading, openPaywall };
}
```

### `useProScreenGuard(screen: string)`

**File:** `src/hooks/useProScreenGuard.ts`

Redirects away from a Pro-only screen if the user is not Pro.

---



## Tier Limits

**File:** `src/services/TierLimits.ts`

Enforces feature limits per tier — repo count, identity count, canvas AI usage limits, etc.

**Identity vs credentials distinction:** An identity is an exact account + provider + host combination (e.g., `github.com` with user `alice`). Free users get one identity; Pro users get unlimited. Within a single identity, Free users can register multiple credential types (PAT, OAuth, GitHub App, SSH) on the same host without any credential-count cap. Adding a second account, provider, or host requires Pro.

---

## Paywall Analytics

**File:** `src/services/PaywallAnalytics.ts`

Tracks RevenueCat events:

| Event | Trigger |
|-------|---------|
| `paywall_impression` | Paywall screen mounts |
| `purchase_attempt` | User taps buy button |
| `purchase_success` | Purchase completes |
| `purchase_cancelled` | User cancels purchase |
| `purchase_error` | Purchase fails |
| `restore_tap` | User taps Restore |
| `restore_success` | Restore finds entitlement |
| `restore_nothing` | Restore finds no purchases |

---

## Paywall Screen

**File:** `src/screens/PaywallScreen.tsx`

Full-screen purchase UI:
- Feature comparison table (Free vs Pro)
- `PaywallPlanGrid` — plan cards (monthly/yearly/lifetime)
- `PaywallFeatureGrid` — feature checklist
- Restore purchases button
- Close button (if presented as modal)

---

## Interstitial Paywall

When a free user who previously had a trial reaches the end of their trial:

1. `proStore.initialize()` detects that a trial was previously active but has now ended, and 3+ days have passed since expiration
2. Sets `interstitialEligible = true` in `ProState`
3. `AppNavigator` detects this flag and navigates to `PaywallScreen` automatically (one-shot)

`markInterstitialShown()` is called after the interstitial is displayed — it sets `interstitialEligible = false` via `AsyncStorage` to prevent repeat showing.

---

## See Also

- [Services](./services.md) — RevenueCatService, TierLimits, PaywallAnalytics
- [Stores](./stores.md) — proStore
- [Hooks](./hooks.md) — useProGate, useProScreenGuard
- [Screens](./screens.md) — PaywallScreen
