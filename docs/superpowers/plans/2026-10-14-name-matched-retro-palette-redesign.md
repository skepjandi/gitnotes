# Name-Matched Retro Palette Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the five muddy retro palettes with bright, name-matched palettes while preserving Default and Grayscale exactly.

**Architecture:** Keep the existing `sharp` + `bitmapped` pipeline and generator paths. Change only the curated `PALETTES` values, add palette-contract tests, regenerate the five retro alternate directories, and verify reference assets remain unchanged.

**Tech Stack:** Node.js CommonJS, `sharp`, `bitmapped`, Jest, Prettier, generated PNG assets.

---

### Task 1: Update the curated palettes

**Files:**
- Modify: `scripts/retro-icon-filters.js:34-91`
- Test: `__tests__/utils/retro-icon-filters.test.ts`

- [ ] **Step 1: Add explicit name-matching palette assertions**

Add tests that flatten each preset palette and assert these signature colors are present:

```ts
expect(FILTER_PRESETS.neon.palette).toEqual(expect.arrayContaining([
  [0, 198, 255],
  [255, 42, 214],
]));
expect(FILTER_PRESETS.gold.palette).toEqual(expect.arrayContaining([
  [245, 183, 0],
  [255, 224, 105],
]));
expect(FILTER_PRESETS['terminal-mono'].palette).toEqual(expect.arrayContaining([
  [22, 255, 90],
  [190, 255, 145],
]));
expect(FILTER_PRESETS['amber-terminal'].palette).toEqual(expect.arrayContaining([
  [255, 138, 0],
  [255, 214, 92],
]));
expect(FILTER_PRESETS['monochrome-grid'].palette).toEqual(expect.arrayContaining([
  [155, 170, 184],
  [225, 232, 238],
]));
```

- [ ] **Step 2: Run the new assertions before implementation**

Run `yarn jest __tests__/utils/retro-icon-filters.test.ts --no-coverage --forceExit`.

Expected: the new palette assertions fail against the current muddy palette values.

- [ ] **Step 3: Replace the five hex palettes**

Use four colors per preset, ordered dark shadow, midtone, primary, highlight:

```js
neon: ['#0a1c5a', '#00c6ff', '#4afff0', '#ff2ad6'],
gold: ['#5c2d00', '#b86900', '#f5b700', '#ffe069'],
'terminal-mono': ['#003014', '#008a34', '#16ff5a', '#beff91'],
'amber-terminal': ['#541c00', '#be4800', '#ff8a00', '#ffd65c'],
'monochrome-grid': ['#232d37', '#556676', '#9baab8', '#e1e8ee'],
```

Keep block sizes, dithering, texture, and alpha behavior unchanged.

- [ ] **Step 4: Run primitive tests and format check**

Run `yarn jest __tests__/utils/retro-icon-filters.test.ts --no-coverage --forceExit` and `yarn format:check`.

Expected: all primitive tests pass and Prettier reports no changes.

- [ ] **Step 5: Commit the palette implementation and tests**

```bash
git add scripts/retro-icon-filters.js __tests__/utils/retro-icon-filters.test.ts
git commit -m "feat(icons): clarify retro palette colors"
```

### Task 2: Regenerate and verify the icon assets

**Files:**
- Modify: `assets/generated/alternate/neon/*.png`
- Modify: `assets/generated/alternate/gold/*.png`
- Modify: `assets/generated/alternate/terminal-mono/*.png`
- Modify: `assets/generated/alternate/amber-terminal/*.png`
- Modify: `assets/generated/alternate/monochrome-grid/*.png`

- [ ] **Step 1: Capture reference hashes**

Record SHA-256 hashes for top-level `icon.png`, `adaptive-icon.png`, `monochrome-icon.png` and alternate `base/` and `grayscale/` files.

- [ ] **Step 2: Regenerate the branding assets**

Run `yarn branding`.

Expected: only the five retro variant directories change.

- [ ] **Step 3: Validate output dimensions and palette signatures**

Run `yarn branding:check` and the generator tests. Inspect the generated `icon.png` files at 1024px and confirm Gold is visibly yellow/gold, Terminal Mono is green, Amber Terminal is orange, Neon is electric blue/cyan/magenta, and Monochrome Grid is cool gray.

- [ ] **Step 4: Verify unchanged reference variants**

Recompute the hashes from Step 1 and assert Base equals top-level defaults and Grayscale is unchanged.

- [ ] **Step 5: Commit the regenerated assets**

```bash
git add assets/generated/alternate
git commit -m "fix(icons): regenerate name-matched retro assets"
```

### Task 3: Run the full validation suite

**Files:** No additional source files.

- [ ] **Step 1: Run focused contract tests**

Run `yarn jest __tests__/utils/retro-icon-filters.test.ts __tests__/utils/generate-branding.test.ts __tests__/services/alternateIconAssets.test.ts __tests__/services/AppIconService.test.ts __tests__/components/settings/RewardCatalogModal.test.tsx --no-coverage --forceExit`.

Expected: all focused suites pass.

- [ ] **Step 2: Run repository checks**

Run `yarn ts:check`, `yarn format:check`, and `yarn jest --no-coverage --forceExit`.

Expected: TypeScript, formatting, and the full Jest suite pass.

- [ ] **Step 3: Inspect final diff and push**

Run `git diff --check origin/main...HEAD` and `git status --short`, then push the branch and confirm PR #1785 checks pass.
