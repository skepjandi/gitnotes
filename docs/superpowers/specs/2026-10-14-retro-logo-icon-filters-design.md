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

### Filter stack

The generator will expose deterministic, composable filters instead of one
hard-coded recolor operation:

- **Pixel graphics**: downsample to a small logical canvas, then nearest-neighbor
  upscale to create hard-edged pixel blocks.
- **Posterize/palette quantization**: map each pixel to the nearest color in a
  deliberately small semantic palette.
- **Ordered dithering**: use a fixed Bayer matrix at palette boundaries to add
  controlled retro texture without random noise.
- **CRT scanlines**: modulate alternating pixel rows for phosphor-era variants.
- **Grid/halftone texture**: add a subtle repeating screen pattern where the
  variant calls for visible technical structure.
- **Glow/bloom**: apply a restrained colored halo before pixelation so neon and
  phosphor variants have depth without becoming blurred gradients.

Filters run in a documented order: render and crop the logo, add optional glow,
reduce to the logical pixel canvas, quantize with optional dithering, apply
optional scanline/grid texture, then nearest-neighbor upscale and generate the
native outputs.

### Variant treatments

The output names and entitlement mapping stay stable, while the filter recipes
become visually distinct:

| Variant | Treatment |
| --- | --- |
| Neon | Pixel graphics + posterize + cyan/electric-violet palette + restrained glow |
| Grayscale | Coarse pixel graphics + monochrome posterize + ordered dithering |
| Gold | Pixel graphics + warm amber/cream palette + CRT scanlines |
| Terminal Mono | Chunky pixel graphics + green palette + hard edges |
| Amber Terminal | Pixel graphics + orange phosphor palette + scanlines + glow |
| Monochrome Grid | Pixel graphics + cool gray palette + grid texture + dithering |

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
