# Referral Share Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GitNotēs user generate a server-authoritative referral URL from Referral Rewards and share it through the native share sheet.

**Architecture:** Keep referral identity and API orchestration in `ReferralService`. The existing `RewardCatalogModal` owns the user action and calls React Native's `Share.share` with the URL returned by the service. Recipient deep-link handling remains unchanged.

**Tech Stack:** TypeScript, React Native, Expo, Jest, `@testing-library/react-native`.

---

### Task 1: Add service-level referral creation

**Files:**
- Modify: `src/services/ReferralService.ts`
- Test: `__tests__/services/ReferralService.test.ts`

- [ ] Add `createReferral()` that awaits `ReferralIdentityService.getIdentityProof()` and calls `workerApi.referrals.create({}, proof)`, returning the typed `ReferralCreateResponse`.
- [ ] Export `createReferral` through the `ReferralService` object.
- [ ] Add tests for forwarding the identity proof and returning `{ code, share_url, expires_at }`; keep API errors propagating so the UI can show a retry state.
- [ ] Run `yarn jest __tests__/services/ReferralService.test.ts --no-coverage --forceExit` and expect all tests to pass.

### Task 2: Add native referral sharing UI

**Files:**
- Modify: `src/components/settings/RewardCatalogModal.tsx`
- Test: `__tests__/components/settings/RewardCatalogModal.test.tsx`

- [ ] Import React Native `Share` and `ReferralService`.
- [ ] Add `sharing` and `shareError` state, plus a `handleShareReferral` callback that calls `ReferralService.createReferral()` and then `Share.share({ message: result.share_url })`.
- [ ] Add an accessible, testable “Share Referral Link” action near the progress section. Disable it while generating and show an activity indicator during the request.
- [ ] Render an inline retryable error message if link creation fails. Do not show an error when the user dismisses the native share sheet.
- [ ] Add modal tests for the action, loading/disabled state, successful native share invocation, and service failure message.
- [ ] Run `yarn jest __tests__/components/settings/RewardCatalogModal.test.tsx --no-coverage --forceExit` and expect all tests to pass.

### Task 3: Validate the feature

**Files:**
- No additional files.

- [ ] Run `yarn ts:check` from the worktree and expect exit 0.
- [ ] Run `yarn eslint src/services/ReferralService.ts src/components/settings/RewardCatalogModal.tsx __tests__/services/ReferralService.test.ts __tests__/components/settings/RewardCatalogModal.test.ts` and expect zero errors.
- [ ] Run `yarn jest --no-coverage --forceExit` and record any pre-existing failures separately.
- [ ] Inspect the diff for scope, secrets, and accessibility labels.

### Task 4: Commit and open the PR

**Files:**
- The files changed by Tasks 1-2.

- [ ] Commit the design/spec documentation separately from the implementation using the repository's conventional commit style.
- [ ] Commit the service plus its test together, then the modal plus its test together.
- [ ] Push `feat/referral-share-link` and open a PR targeting `main` with a concise summary and verification results.
