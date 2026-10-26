# Store Privacy Declaration Checklist

Operational checklist for the App Store Connect **App Privacy** questionnaire and the
Google Play **Data safety** form. It records what the app actually sends, so the
submitted declarations match the shipped behaviour.

> This file is a source-controlled checklist, not a console automation. Nothing here
> changes App Store Connect or Play Console settings: a human operator performs every
> console step and records the evidence at the bottom.

## 1. Data flows to declare

| Flow | What is sent | Identifier | Recipient | Retention | Opt-out |
|------|--------------|------------|-----------|-----------|---------|
| EAS Observe diagnostics (only in builds shipping telemetry) | Startup performance, device and network state at startup, startup network activity counts, update and navigation timings, iOS memory warnings, JavaScript errors and native crashes with error message and stack trace | Pseudonymous, install-scoped identifier; legal classification requires operator review | Expo (EAS Observe), which processes data as a service provider | Deleted after 90 days; deletion runs in monthly batches so a record can remain for up to 120 days | Off before SDK import means no SDK import. After import, opt-out disables future EAS dispatch but cannot unload the SDK or remove its local error handler until process exit |
| Usage counters (only in builds shipping telemetry) | `app_open` once per successful app start, `git_host_action` once per successful user-initiated Git-host operation with one host from a fixed set (GitHub, GitLab, Gitea, Forgejo, other) | None. No identifier is attached | GitNotēs Worker; Cloudflare processes requests and hosts aggregate counters as a service provider | Daily aggregate counters bucketed in UTC, retained for 13 months. No event log, no per-user record | Settings switch stops future submissions; it does not delete recorded aggregates |

Neither flow carries note content, repository names or URLs, account identifiers,
tokens, exact hostnames, location, or free-form extra fields.
App code does not intentionally attach note, repository, account, or
authentication data to telemetry. Automatically captured error messages and
stacks may nevertheless contain sensitive values embedded by app code.

## 2. Pre-submission checks

- [ ] The Settings telemetry control is present, labelled, and states that it covers both diagnostics and usage counters.
- [ ] With telemetry off, no diagnostics dispatch and no counter submission happens, verified on a real device.
- [ ] Before declaring either flow live, verify the submitted platform build actually includes telemetry; otherwise describe it as a planned/release-gated flow.
- [ ] Operator has reviewed platform-specific data categories, linked-to-identity/tracking classifications, legal treatment of the pseudonymous install identifier, and third-party transfer/sharing classifications. Do not prefill these answers without platform/legal review.
- [ ] Verify the Cloudflare WAF rate-limit rule is configured and active before production intake. This is a prerequisite and is not verified by this checklist. Cloudflare may process source IP for its edge rule; Worker application code does not read or persist IP.
- [ ] The public privacy policy at `https://gitnotes.org/privacy` matches the flows in section 1. Re-run `node scripts/privacy-disclosure-assertions.mjs` in the landing repository after every policy edit.
- [ ] The in-app notice for this material policy change is versioned and dismissible (`PrivacyNoticeService`).
- [ ] A reviewer can reach the opt-out from the release notes of the submitted build.

## 3. App Store Connect (App Privacy)

Declare every data type that is collected, whether or not it is linked to identity:

- [ ] **Diagnostics → Crash Data**: classify JavaScript errors and native crashes, including error message and stack trace, based on the current platform definitions and legal review. Record linked-to-identity, tracking, and purpose classifications; do not assume “No”.
- [ ] **Diagnostics → Performance Data**: classify startup/render/interactive timings, startup network activity counts, device and network state under the current platform definitions and legal review. Record linked-to-identity, tracking, and purpose classifications; do not assume “No”.
- [ ] **Identifiers → Device ID**: classify the EAS Observe pseudonymous installation identifier under current platform definitions and legal review. Record linked-to-identity, tracking, and purpose classifications; do not assume “No”. Note its install-scoped, reinstall-reset nature.
- [ ] **Usage Data → Product Interaction**: classify `app_open` and `git_host_action` counters under current platform definitions and legal review. Record linked-to-identity, tracking, and purpose classifications; do not assume “No”. Note that counts are client-reported/unverified and cells below 20 events are withheld.
- [ ] Verify **Data Not Used to Track You** against actual shipped behavior and applicable platform definitions; do not preselect it without review.
- [ ] Review whether Expo and Cloudflare processing constitutes third-party transfer/sharing under each platform's current definitions and applicable law; record the reasoning.
- [ ] Confirm the opt-out is described in the notes field: turning it off stops future collection and dispatch, and does not erase counters that were already recorded.

## 4. Google Play (Data safety)

- [ ] **Crash logs** — collected, encrypted in transit, purpose: App Functionality / Diagnostics. Decide and record whether the Expo transfer counts as sharing with a third party, and justify that answer in the notes field.
- [ ] **App activity** — collected: the two aggregate event types only. Purpose: Analytics. The submission must not describe the counters as unique users.
- [ ] **Device or other IDs** — if shipped, classify the pseudonymous install-scoped identifier using current Play definitions and legal review. Do not prefill linked-to-identity or sharing answers.
- [ ] Record the retention statement: diagnostics are deleted after 90 days, up to 120 days in monthly deletion batches; aggregate counters are retained for 13 months.
- [ ] Confirm the Play declaration does not describe any per-user record, because none exists.

## 5. Claims that must not appear

- [ ] No statement that the app collects no analytics, no identifiers, or no device identifiers. Both flows collect data.
- [ ] No statement that turning telemetry off deletes previously recorded counters or retracts already published totals.
- [ ] No statement that the app receives no error data. Unhandled JavaScript errors are captured automatically once the diagnostics SDK loads.
- [ ] No categorical statement that the install-scoped identifier is or is not personal data/PII without operator legal review.
- [ ] No statement that Expo or Cloudflare receive no data; both process the disclosed data as service providers, and third-party transfer classification must be reviewed.
- [ ] No statement that the Cloudflare WAF rule is active without verifying production configuration.
- [ ] No statement that the published statistics count users or unique users. They count client-reported events.

## 6. Evidence to keep with the release

- [ ] Screenshot or export of the completed App Privacy questionnaire.
- [ ] Screenshot or export of the completed Play Data safety form.
- [ ] Screenshot of the Settings telemetry control in the submitted build.
- [ ] Output of `node scripts/privacy-disclosure-assertions.mjs` for the policy revision that shipped.
- [ ] Date, build number, and the operator who completed each console step.
