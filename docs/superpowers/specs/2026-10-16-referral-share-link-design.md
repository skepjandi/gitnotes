# Referral Share Link Design

## Goal

Make the existing Referral Rewards modal a complete referrer entry point. A user can request a server-generated referral URL and share it with the native platform share sheet.

## Design

- Add `ReferralService.createReferral()` as the single service-level operation for creating a referral. It obtains the existing identity proof and calls `workerApi.referrals.create({}, proof)`.
- Keep the server response authoritative. The UI uses the returned `share_url` and does not construct or persist referral codes locally.
- Add a share action to `RewardCatalogModal`. On press it requests a link, then calls React Native's `Share.share({ message: shareUrl })`.
- While the request is active, disable the action and show a spinner. If creation fails, show an inline error and a retry action. Sharing cancellation is not treated as an error.
- Keep the existing recipient flow unchanged: incoming `https://gitnotes.org/r/<code>` and `gitnotes://r/<code>` links continue through `ReferralService.captureReferralUrl()`.

## Testing

- Add service coverage proving referral creation forwards the identity proof and returns the worker response.
- Add modal coverage for the share action's loading, success, and failure states using mocked service/API and native `Share` behavior.
- Run targeted Jest tests, TypeScript checking, ESLint, and the full test suite before opening the PR.
