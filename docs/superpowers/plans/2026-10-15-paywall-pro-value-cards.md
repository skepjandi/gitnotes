# Paywall Pro Value Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six accurate Pro value cards to the paywall while preserving the existing Lifetime-primary offer hierarchy and all purchase/trial behavior.

**Architecture:** Extend the existing `FEATURE_META` list in `PaywallFeatureGrid` with six small cards; the existing responsive wrapping grid will handle layout. Add matching `paywall.features.<id>.title` and `.description` entries to each supported locale. Add a focused component test that renders the real grid and checks the full card inventory and accessibility labels.

**Tech Stack:** React Native, TypeScript, Ionicons, NativeWind/UI `Surface`, react-i18next, Jest, `@testing-library/react-native`.

---

### Task 1: Add failing feature-grid regression coverage

**Files:**
- Create: `__tests__/components/paywall/PaywallFeatureGrid.test.tsx`
- Test: `src/components/paywall/PaywallFeatureGrid.tsx`

- [ ] **Step 1: Create the test harness with theme, translation, and window mocks**

Mock `useTranslation` to return the key string, mock `useTheme` with the existing paywall color shape, mock `useWindowDimensions` to a phone width, and render the real `PaywallFeatureGrid` rather than mocking it. Mock `Surface` only if necessary to expose `testID`, `accessibilityLabel`, and children without requiring native elevation implementation.

- [ ] **Step 2: Assert the complete sixteen-card inventory**

Use `getByTestId` for the ten existing IDs plus these six new IDs:

```ts
const newFeatureIds = [
  'accentColor',
  'proAppIcons',
  'premiumThemes',
  'multiHost',
  'biometricLock',
  'unlimitedRepos',
];
```

Assert each new card's `accessibilityLabel` contains both `paywall.features.<id>.title` and `paywall.features.<id>.description`. Assert `getAllByTestId(/^paywall\.feature\./)` returns sixteen cards.

- [ ] **Step 3: Run the new test before implementation**

Run:

```bash
yarn jest __tests__/components/paywall/PaywallFeatureGrid.test.tsx --no-coverage --forceExit
```

Expected: the test fails because the six new card IDs do not yet exist.

### Task 2: Add the six feature definitions

**Files:**
- Modify: `src/components/paywall/PaywallFeatureGrid.tsx:18-79`

- [ ] **Step 1: Append the six supported feature metadata entries**

Append entries after `multiAccount` so the existing `aiChat` hero remains unchanged:

```ts
{
  id: 'accentColor',
  titleKey: 'paywall.features.accentColor.title',
  descKey: 'paywall.features.accentColor.description',
  icon: 'color-palette',
},
{
  id: 'proAppIcons',
  titleKey: 'paywall.features.proAppIcons.title',
  descKey: 'paywall.features.proAppIcons.description',
  icon: 'image',
},
{
  id: 'premiumThemes',
  titleKey: 'paywall.features.premiumThemes.title',
  descKey: 'paywall.features.premiumThemes.description',
  icon: 'color-fill',
},
{
  id: 'multiHost',
  titleKey: 'paywall.features.multiHost.title',
  descKey: 'paywall.features.multiHost.description',
  icon: 'git-network',
},
{
  id: 'biometricLock',
  titleKey: 'paywall.features.biometricLock.title',
  descKey: 'paywall.features.biometricLock.description',
  icon: 'finger-print',
},
{
  id: 'unlimitedRepos',
  titleKey: 'paywall.features.unlimitedRepos.title',
  descKey: 'paywall.features.unlimitedRepos.description',
  icon: 'folder-open',
},
```

Use only Ionicons names available in the current `Ionicons.glyphMap` type and do not change card dimensions, ordering of existing cards, or the hero rule.

- [ ] **Step 2: Run the focused test after metadata changes**

Run the same Jest command from Task 1. It should still fail until translations and rendering assertions are wired, then use the failure to identify missing keys only.

### Task 3: Add localized copy in all supported locales

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/fr.json`
- Modify: `src/i18n/de.json`
- Modify: `src/i18n/ja.json`
- Modify: `src/i18n/ko.json`

- [ ] **Step 1: Add six title/description pairs under `paywall.features` in every locale**

Add these keys in the same nested shape as the existing cards. English copy must communicate the verified capabilities without implying referral rewards or included AI credits:

```json
"accentColor": { "title": "Accent colors", "description": "Make GitNotēs yours with a custom accent color" },
"proAppIcons": { "title": "Pro app icons", "description": "Choose from exclusive Neon, Grayscale, and Gold icons" },
"premiumThemes": { "title": "Premium themes", "description": "Switch between Neumorphic and Retrofuturistic styles" },
"multiHost": { "title": "Multi-host sync", "description": "Connect GitLab, Gitea, and more alongside GitHub" },
"biometricLock": { "title": "Biometric lock", "description": "Protect your notes with Face ID or Touch ID" },
"unlimitedRepos": { "title": "Unlimited repositories", "description": "Add as many repositories as your workflow needs" }
```

Translate the same meaning naturally in Spanish, French, German, Japanese, and Korean. Do not add pricing, trial claims, or unsupported referral icon names.

- [ ] **Step 2: Check JSON formatting and key parity**

Run a small Node check from the repo root that parses all six locale JSON files and asserts every new `paywall.features.<id>.title` and `.description` path exists and is a non-empty string. Run Prettier check on all six locale files.

### Task 4: Run focused and full verification

**Files:**
- Verify: `src/components/paywall/PaywallFeatureGrid.tsx`
- Verify: `__tests__/components/paywall/PaywallFeatureGrid.test.tsx`
- Verify: `src/i18n/{en,es,fr,de,ja,ko}.json`
- Preserve: `src/screens/PaywallScreen.tsx` Lifetime-primary diff

- [ ] **Step 1: Run focused tests and diagnostics**

Run the feature-grid test, `lsp_diagnostics` on the changed TypeScript files, and `git diff --check`. Expected: focused tests pass and no production TypeScript diagnostics appear.

- [ ] **Step 2: Run repository checks**

Run:

```bash
yarn ts:check
```

Expected: TypeScript and tests pass, ESLint has 0 errors, and changed files are formatted. Existing unrelated warnings or Jest open-handle warnings should be reported, not folded into this change.

- [ ] **Step 3: Review scope and preserve prior work**

Inspect `git diff` and confirm the expansion only changes feature metadata, localized card copy, the new focused test, and approved documentation. Confirm the earlier `PaywallScreen.tsx` Lifetime-first change remains intact and no RevenueCat, proStore, trial, pricing, analytics, or referral reward code changed.
