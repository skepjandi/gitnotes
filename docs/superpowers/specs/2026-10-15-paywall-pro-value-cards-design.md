# Paywall Pro Value Cards Design

## Goal

Expand the paywall's feature grid so users can see more of the real Pro value behind the Lifetime purchase, specifically accent colors, Pro app icons, premium themes, multi-host sync, biometric lock, and unlimited repositories.

## Design

Append six cards to `PaywallFeatureGrid` after the existing ten cards:

1. **Accent Colors** — customizable accent color.
2. **Pro App Icons** — the Pro Neon, Grayscale, and Gold icon options.
3. **Premium Themes** — Neumorphic and Retrofuturistic styles.
4. **Multi-host Sync** — connect additional GitLab and Gitea hosts.
5. **Biometric Lock** — protect the app with Face ID or Touch ID.
6. **Unlimited Repositories** — remove the free-tier repository limit.

Use the existing flat responsive grid, `Surface`, Ionicons, theme colors, spacing tokens, and card sizing. Keep the first existing AI card as the full-width hero. Add `paywall.features.<id>.title` and `.description` translations in all six supported locales: English, Spanish, French, German, Japanese, and Korean.

## Boundaries

This is a presentation and localization change only. Do not modify RevenueCat offerings, plan order, pricing, purchase handlers, trial state, feature gates, referral rewards, or the existing Lifetime-primary hierarchy. Referral-earned app icons must not be described as Pro purchase benefits; the card refers only to the existing Pro icon options.

## Testing

Add focused `PaywallFeatureGrid` coverage that verifies all sixteen cards render and that each new card has an accessible label containing translated title and description content. Preserve the existing paywall purchase and restore tests.

## Non-Goals

- No new Pro entitlements or feature gates.
- No changes to app icon or theme behavior.
- No new layout system, section headers, badges, animations, or pricing copy.
- No changes to trial messaging or eligibility.
