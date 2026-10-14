# Name-Matched Retro Palette Redesign

## Goal

Make the five non-reference alternate icons visually match their names at the
small app-icon picker size, based on the approved browser comparison:

- Neon: electric blue/cyan with magenta pixel accents.
- Gold: unmistakable rich gold/yellow with warm ochre shadowing.
- Terminal Mono: phosphor green with a darker green shadow.
- Amber Terminal: orange/amber phosphor with burnt-orange shadowing.
- Monochrome Grid: cool grayscale with a restrained grid texture.

Default and Grayscale remain unchanged byte-for-byte.

## Design

Keep the existing `sharp` rasterization, `bitmapped` pixelation/dithering, and
nearest-neighbor upscale pipeline. Change only the curated preset palettes so
the source logo's dominant surfaces resolve to explicit name-matched colors.
Use four colors per palette: dark shadow, midtone, primary, and highlight.
Keep the existing texture assignments and alpha handling. Regenerate the five
alternate directories from the untouched `assets/logo.svg`.

## Validation

- Every changed icon remains 1024x1024 PNG with alpha.
- Base files still match top-level defaults byte-for-byte.
- Grayscale files remain unchanged.
- Each retro preset contains at least one clearly name-matched primary color.
- Focused filter/generator/icon tests, `yarn branding:check`, `yarn ts:check`,
  and repository formatting checks pass.
