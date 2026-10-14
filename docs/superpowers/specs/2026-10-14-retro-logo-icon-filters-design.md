# Retro Logo Icon Filters

## Goal

Replace the current alternate-icon recolor treatment with a reusable, logo-first
pixel-art pipeline. Every icon continues to derive from `assets/logo.svg`, but
each variant receives a deliberate pixel grid, palette, and texture treatment
so the results read as retro editions of GitNotes rather than hue-swapped copies.

This work is isolated from PR #1781. Existing entitlement tiers and icon names
remain unchanged: Neon, Grayscale, and Gold are Pro icons; Terminal Mono, Amber
Terminal, and Monochrome Grid are referral icons.

## Design

### Source and rendering

- Keep `assets/logo.svg` as the only artwork source.
- Render the SVG through the existing `sharp` branding script.
- Downsample the logo to a configurable pixel grid, disable smoothing while
  scaling back to 1024x1024, then apply a curated palette.
- Preserve transparent alpha and existing safe-area/canvas sizing.
- Generate iOS icon, Android adaptive foreground, and Android monochrome assets
  for every alternate variant.

### Variant treatments

The output names and entitlement mapping stay stable, while the filter recipes
become visually distinct:

| Variant | Treatment |
| --- | --- |
| Neon | Fine pixel grid, high-contrast cyan/electric-violet palette |
| Grayscale | Coarse monochrome bitmap grid with ordered dithering |
| Gold | Warm amber/cream palette with CRT scanline texture |
| Terminal Mono | Chunky green terminal palette with hard pixel edges |
| Amber Terminal | Orange phosphor palette with scanlines and restrained glow |
| Monochrome Grid | Cool gray palette with visible ordered grid/dither |

The logo geometry remains recognizable in all variants. The differences come
from grid size, palette quantization, and texture, not from adding unrelated
symbols or hand-drawn replacement artwork.

### Pipeline boundaries

- Add small pure helpers for palette matching and deterministic ordered
  dithering so they can be unit tested without image fixtures.
- Keep the existing standard branding outputs and base alternate assets stable.
- Extend the existing generator's variant registry rather than adding a second
  asset-generation script.
- Generated PNGs are checked into the repository because Expo native config
  references concrete asset paths.

### Product behavior

- Do not change `AppIconName`, app.json icon names, reward keys, referral
  milestones, or Pro gating in this PR.
- Picker previews automatically use the regenerated assets at the same paths.
- Existing selected-icon storage remains compatible because names do not change.

## Verification

- Unit-test palette selection, grid quantization, and dithering determinism.
- Run branding generation and `--check` to validate dimensions, alpha, and all
  registered alternate assets.
- Run `yarn ts:check`, focused icon/reward tests, and the full Jest suite.
- Inspect generated icon contact sheets at 1x and native 1024px output to verify
  recognizable logo geometry and meaningful visual separation.
- Run focused ESLint and Prettier checks on changed source/tests.

## Scope exclusions

- No new entitlement tier or reward milestone changes.
- No new icon names or app.json registration entries.
- No changes to the Settings picker layout or paywall flow.
- No unrelated theme redesign.
