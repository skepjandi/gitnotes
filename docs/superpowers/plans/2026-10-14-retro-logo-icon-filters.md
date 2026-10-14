# Retro Logo Icon Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the five non-default/non-grayscale GitNotes alternate icons from `assets/logo.svg` using library-backed pixel-art filters while preserving existing asset paths, icon names, and entitlement tiers.

**Architecture:** Keep `scripts/generate-branding.js` as the single asset entry point. Use `sharp` for SVG rasterization, nearest-neighbor scaling, alpha-safe compositing, scanline overlays, and PNG output; use `bitmapped` for logical-pixel reduction, curated palette mapping, and dithering. Default and Grayscale remain unchanged. The existing five variant directories are regenerated in place, so native registration and stored selections remain compatible.

**Tech Stack:** Node.js CommonJS build script, `sharp`, `bitmapped`, `@napi-rs/canvas` ImageData bridge, Jest, PNG asset validation.

---

### Task 1: Add the image-processing dependencies

**Files:**
- Modify: `package.json`
- Modify: `yarn.lock`

- [ ] **Step 1: Add the exact packages used by the generator**

Add `bitmapped` and `@napi-rs/canvas` to `devDependencies`. Keep the existing `sharp` dependency unchanged because it remains responsible for SVG rendering and final PNG output.

- [ ] **Step 2: Install and verify the package APIs**

Run:

```bash
yarn add --dev bitmapped @napi-rs/canvas
node -e "const { createCanvas } = require('@napi-rs/canvas'); console.log(typeof createCanvas)"
```

Expected: Yarn updates `package.json`/`yarn.lock`, and the command prints `function`.

- [ ] **Step 3: Commit the dependency change**

```bash
git add package.json yarn.lock
git commit -m "build(icons): add pixel filter dependencies"
```

### Task 2: Add tested retro filter primitives

**Files:**
- Create: `scripts/retro-icon-filters.js`
- Create: `__tests__/utils/retro-icon-filters.test.js`

- [ ] **Step 1: Write failing tests for deterministic filter behavior**

Cover these exported functions:

```js
const {
  FILTER_PRESETS,
  applyRetroFilter,
  createImageData,
  paletteToRgb,
} = require('../../scripts/retro-icon-filters');

test('paletteToRgb parses curated hex colors', () => {
  expect(paletteToRgb(['#000000', '#ffcc66'])).toEqual([[0, 0, 0], [255, 204, 102]]);
});

test('applyRetroFilter is deterministic and preserves transparent pixels', () => {
  const source = createImageData(4, 4, [40, 80, 180, 255]);
  source.data[3] = 0;
  const first = applyRetroFilter(source, FILTER_PRESETS['crt-amber']);
  const second = applyRetroFilter(source, FILTER_PRESETS['crt-amber']);
  expect(Array.from(first.data)).toEqual(Array.from(second.data));
  expect(first.data[3]).toBe(0);
});

test('every non-reference preset has a logical pixel size and palette', () => {
  for (const key of ['neon', 'gold', 'terminal-mono', 'amber-terminal', 'monochrome-grid']) {
    expect(FILTER_PRESETS[key].blockSize).toBeGreaterThan(1);
    expect(FILTER_PRESETS[key].palette.length).toBeGreaterThanOrEqual(4);
  }
});
```

Run:

```bash
yarn jest __tests__/utils/retro-icon-filters.test.js --no-coverage
```

Expected: FAIL because the module and exports do not exist yet.

- [ ] **Step 2: Implement the filter module**

Implement:

- `paletteToRgb(hexPalette)` for validated RGB palettes.
- `createImageData(width, height, fill)` for test fixtures and the canvas bridge.
- `FILTER_PRESETS` with distinct logical block sizes and palettes:
  - `neon`: 48px, cyan/violet/magenta arcade palette, Bayer dithering.
  - `gold`: 36px, amber/cream/brown palette, Atkinson dithering plus scanlines.
  - `terminal-mono`: 32px, green terminal palette, nearest palette mapping.
  - `amber-terminal`: 32px, orange phosphor palette, Atkinson dithering plus scanlines.
  - `monochrome-grid`: 40px, cool gray/blueprint palette, Bayer dithering plus grid texture.
- `applyRetroFilter(imageData, preset)` using `bitmapped` processing and deterministic alpha handling.
- A scanline/grid overlay step that modifies only opaque pixels and never changes dimensions.

Keep the implementation independent of the branding script so it can be unit-tested without reading files.

- [ ] **Step 3: Run the primitive tests**

Run:

```bash
yarn jest __tests__/utils/retro-icon-filters.test.js --no-coverage
```

Expected: PASS.

- [ ] **Step 4: Commit the tested filter primitives**

```bash
git add scripts/retro-icon-filters.js __tests__/utils/retro-icon-filters.test.js
git commit -m "feat(icons): add logo retro filter primitives"
```

### Task 3: Integrate filters into branding generation

**Files:**
- Modify: `scripts/generate-branding.js`
- Modify: `__tests__/utils/generate-branding.test.ts`

- [ ] **Step 1: Add generator integration coverage**

Extend the existing generator tests to verify that the filter registry has:

- `base` and `grayscale` reference variants that keep their current path behavior.
- `neon`, `gold`, `terminal-mono`, `amber-terminal`, and `monochrome-grid` retro presets.
- All six alternate output names remain `icon.png`, `adaptive-icon.png`, and `monochrome-icon.png`.

- [ ] **Step 2: Integrate the filter module without changing output paths**

Update `generate-branding.js` to:

1. Keep the current high-quality base/default generation unchanged.
2. Copy the current `base` outputs unchanged.
3. Copy the current `grayscale` outputs unchanged.
4. Render each non-reference variant from `assets/logo.svg` into a raw ImageData buffer.
5. Pass the raw image through `applyRetroFilter` at its configured logical size.
6. Upscale with `sharp.kernel.nearest`, preserve alpha, and write the existing variant filenames.
7. Apply the existing monochrome output conversion after the retro filter so Android themed masks remain valid.
8. Include all existing alternate directories in `VARIANTS` and `checkAllVariants()`.

Do not modify `app.json`, `AppIconService.ts`, reward keys, or entitlement code.

- [ ] **Step 3: Regenerate assets**

Run:

```bash
yarn branding
yarn branding:check
```

Expected: all top-level and alternate PNGs are generated, all are 1024x1024 with alpha, and the check exits 0.

- [ ] **Step 4: Commit generator and generated assets**

```bash
git add scripts/generate-branding.js __tests__/utils/generate-branding.test.ts assets/generated/alternate
git commit -m "feat(icons): regenerate alternate icons with retro filters"
```

### Task 4: Validate the full icon contract

**Files:**
- Modify: `__tests__/services/alternateIconAssets.test.ts` only if the existing coverage does not discover all six variant directories.

- [ ] **Step 1: Run focused tests**

```bash
yarn jest __tests__/services/alternateIconAssets.test.ts __tests__/services/AppIconService.test.ts __tests__/components/settings/RewardCatalogModal.test.tsx --no-coverage --forceExit
```

Expected: all suites pass; existing icon names and reward behavior remain unchanged.

- [ ] **Step 2: Run project verification**

```bash
```

Expected: TypeScript passes and the changed files have no new lint or formatting errors.

- [ ] **Step 3: Inspect generated contact sheet output**

Use the generated PNGs to compare the five changed variants at 1024px and confirm:

- the GitNotes logo remains recognizable;
- Default and Grayscale are unchanged;
- the five redesigned variants differ by pixel scale, palette, and texture;
- transparent corners and native safe areas remain intact.

### Task 5: Open the separate pull request

**Files:**
- No source files.

- [ ] **Step 1: Review branch state and diff**

```bash
```

Confirm PR #1781 is not an ancestor target for this branch's new work.

- [ ] **Step 2: Push the isolated branch**

```bash
```

- [ ] **Step 3: Create the PR**

```bash
  --title "feat(icons): add retro logo filter variants" \
  --body "## Summary
  - keep logo.svg as the source artwork
  - apply library-backed pixelation, palette, dithering, scanline, and grid filters
  - preserve Default, Grayscale, icon names, and entitlement tiers

  ## Verification
  - yarn branding:check
  - focused icon/reward tests
  - yarn ts:check"
```

Expected: a new PR containing only the retro asset pipeline and generated icon changes.
