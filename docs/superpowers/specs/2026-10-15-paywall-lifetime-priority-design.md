# Paywall Lifetime Priority Design

## Goal

Make the one-time lifetime purchase the clearest and most prominent purchase path on the paywall because lifetime sales are the primary commercial goal. Keep monthly and yearly subscriptions available as secondary options.

## Design

Update the existing `plans` array in `src/screens/PaywallScreen.tsx`:

1. Render Lifetime first.
2. Set Lifetime's button variant to `primary`.
3. Render Yearly and Monthly after Lifetime.
4. Keep Yearly and Monthly button variants as `secondary`.
5. Preserve each plan's existing title, price formatting, CTA label, icon, test ID, disabled state, and purchase handler.

Because `PaywallPlanGrid` renders plans in the order it receives them and delegates emphasis to the plan's button variant, this achieves the requested hierarchy without changing the component API or introducing a new visual pattern.

## Trial And Pricing Boundaries

Do not change RevenueCat offerings, product identifiers, purchase actions, trial state, trial eligibility, or pricing strings. The 14-day trial remains controlled by StoreKit/RevenueCat and the existing app behavior remains intact.

## Testing

Extend the paywall screen tests to verify that the Lifetime tile is rendered and that the plan data passed to the grid makes Lifetime primary while subscription plans remain secondary. Keep the existing restore-purchase tests unchanged.

## Non-Goals

- No new trial copy or trial eligibility logic.
- No pricing changes.
- No changes to `proStore`, RevenueCat integration, analytics, or feature presentation.
- No new badge, card type, animation, or paywall layout.
