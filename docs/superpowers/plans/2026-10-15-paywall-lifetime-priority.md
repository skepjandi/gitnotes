# Paywall Lifetime Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lifetime purchase the first and only primary offer on the existing paywall while keeping subscriptions and trial behavior unchanged.

**Architecture:** Keep `PaywallPlanGrid` as the presentational renderer. Update only the `plans` construction in `PaywallScreen.tsx`, preserving each existing handler, product price, CTA, icon, and disabled state while changing order and button variants. Extend the existing screen test with focused assertions for the resulting plan order and variants.

**Tech Stack:** React Native, TypeScript, Jest, `@testing-library/react-native`, Zustand selectors, NativeWind/UI primitives.

---

### Task 1: Add regression coverage for offer hierarchy

**Files:**
- Modify: `__tests__/screens/PaywallScreen.test.tsx`
- Test target: `src/screens/PaywallScreen.tsx`

- [ ] **Step 1: Expand the test store mock with package fixtures**

Use simple product objects with identifiers and price strings for monthly, yearly, and lifetime packages so all three plan tiles render. Keep the mock purchase methods as no-op Jest functions and preserve the existing restore test setup.

```ts
const packageFor = (identifier: string, priceString: string) => ({
  product: { identifier, priceString },
});
```

Set the mocked store values to:

```ts
monthlyPackage: packageFor('monthly', '$0.99'),
yearlyPackage: packageFor('yearly', '$9.99'),
lifetimePackage: packageFor('lifetime', '$19.99'),
```

- [ ] **Step 2: Add a test asserting Lifetime is rendered first and primary**

Render `PaywallScreen`, wait for `paywall.plan.lifetime`, then inspect the rendered plan grid's children in order. Assert the first three plan test IDs are `paywall.plan.lifetime`, `paywall.plan.yearly`, and `paywall.plan.monthly`; assert all three CTA buttons exist. The primary/secondary style contract is observable through the button styles passed by `PaywallPlanGrid`, so use the rendered button background/border styles to assert Lifetime has the primary style and the subscription buttons have bordered secondary styles.

- [ ] **Step 3: Run the focused test before implementation**

Run:

```bash
yarn jest __tests__/screens/PaywallScreen.test.tsx --no-coverage --forceExit
```

Expected: the existing restore tests pass and the new hierarchy test fails because the current screen still orders Monthly first and marks it primary.

### Task 2: Reorder paywall plans and variants

**Files:**
- Modify: `src/screens/PaywallScreen.tsx:117-155`

- [ ] **Step 1: Make Lifetime the first plan and primary variant**

Build the `plans` array with the existing Lifetime data first:

```ts
const plans: PlanTileData[] = [];
if (lifetimePackage) {
  plans.push({
    id: 'lifetime',
    title: t('paywall.lifetime.title'),
    priceLine: lifetimePrice ? t('paywall.lifetime.cta', { price: lifetimePrice }) : null,
    ctaLabel: t('paywall.action.buy'),
    ctaTestID: 'paywall.lifetime.cta',
    variant: 'primary',
    disabled: busy || !lifetimePrice,
    onPress: handleLifetime,
    icon: 'infinite',
  });
}
```

- [ ] **Step 2: Append Yearly and Monthly as secondary plans**

Preserve the existing conditional availability and data, but append Yearly before Monthly and set both `variant` values to `'secondary'`. Do not change product identifiers, price translation keys, CTA labels, handlers, icons, disabled conditions, or RevenueCat/store code.

- [ ] **Step 3: Run the focused hierarchy test**

Run:

```bash
yarn jest __tests__/screens/PaywallScreen.test.tsx --no-coverage --forceExit
```

Expected: all paywall screen tests pass.

### Task 3: Verify the completed change

**Files:**
- Verify: `src/screens/PaywallScreen.tsx`
- Verify: `__tests__/screens/PaywallScreen.test.tsx`
- Verify: `docs/superpowers/specs/2026-10-15-paywall-lifetime-priority-design.md`

- [ ] **Step 1: Run language diagnostics on changed TypeScript files**

Run `lsp_diagnostics` for `src/screens/PaywallScreen.tsx` and `__tests__/screens/PaywallScreen.test.tsx`. Expected: no errors.

- [ ] **Step 2: Run the full required checks**

Run each command from the worktree:

```bash
yarn ts:check
yarn eslint . --ext .ts,.tsx
```

Expected: all commands exit with status 0. Report unrelated pre-existing failures separately if encountered.

- [ ] **Step 3: Review the diff for scope and trial safety**

Run:

```bash
```

Confirm the diff changes only plan order/variants and matching regression coverage; no trial, pricing, RevenueCat, or store logic is modified.
