# Changelog

All notable fixes and feature changes to GitNotēs are documented here.

> **Format**: loosely based on [Keep a Changelog](https://keepachangelog.com/), grouped by date descending. Each entry references the originating PR (when available) and names the area from the conventional-commit prefix.
>
> **Wiki**: the [GitHub Wiki](https://github.com/skepjandi/gitnotes/wiki) is the public-facing main wiki — architecture, services, contributor guides, and feature deep-dives. Source-controlled editing surface is `docs/wiki/` in this repo; CI (`.github/workflows/sync-wiki.yml`) mirrors it to the GitHub Wiki on every merge to `main`. New single-PR fixes should be added here, not as new wiki pages.
>
> **History**: prior fixes (pre-2026-08) lived in single-PR wiki pages. Those pages were retired in [#1047](https://github.com/skepjandi/gitnotes/pull/1047); their full diagnostic content is preserved in git history via `git log -p -- docs/wiki/<file>.md`.

## 2026-10-07

### fix(chat): recover old-chat and bound tool-call continuation

**What:** Two reliability bugs in chat: old thread lists could fail to load silently when the GitHub API returned network or server errors, and unbounded tool-call loops could continue indefinitely without user control.

**Fix:** `ChatStorageService.loadThreadSummaries` now classifies errors into nine typed codes (`NETWORK_ERROR`, `SERVER_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `NOT_FOUND`, `INVALID_PAYLOAD`, `PARSE_ERROR`, `UNKNOWN`) and uses cached summaries only for transient network or 5xx failures, surfacing a warning while preserving stale data. `chatStore.loadThreads` propagates the warning to the UI and keeps cached threads visible instead of showing a blank list. Tool-call execution is wrapped in a 30-second timeout (`TOOL_EXECUTION_TIMEOUT_MS = 30_000`), bounded to a maximum of five continuation rounds (`MAX_TOOL_ROUNDS = 5`) per streaming session, and deduplicated by `(toolName, argsJSON)` to prevent re-execution after confirmation. The `executeRound` loop uses a manual continuation controller; it does not rely on SDK auto-execution.

**Files changed:**

- `src/services/ChatStorageService.ts` — `ChatStorageError`, `ChatStorageErrorCode`, `classifyError`, `isCacheableError`, `validateChatIndex`
- `src/stores/chatStore.ts` — `loadThreads` error handling with cached summaries and warning
- `src/components/chat/useChatScreenController.ts` — bounded `executeRound` with `executeWithTimeout`
- `src/components/chat/continuationHelpers.ts` — `executeWithTimeout`, `computeShouldContinue`, `makeToolCallKey`
- `src/components/chat/continuationMessages.ts` — `toContinuationMessages`
- `src/services/ai/config.ts` — `MAX_TOOL_ROUNDS`, `TOOL_EXECUTION_TIMEOUT_MS`

## 2026-10-06

### fix(editor): keep typing tools usable above the keyboard

**What:** Tapping a formatting tool in the note editor could dismiss the keyboard before the tool action completed.

**Fix:** Preserve keyboard taps in the sticky Markdown toolbar and add regression coverage for the toolbar scroll behavior.

## 2026-10-05

### docs: synchronize Free tier identity and repo limits across docs

**What:** Documentation claimed Free had three repositories, conflicting with the actual one-repo, one-identity implementation. No source or test files were modified.

**Fix:** Updated paywall.md feature table to list `Repositories | 1 | Unlimited` and added a new `Account/provider/host identities | 1 | Unlimited` row. Clarified in Tier Limits section that one identity allows multiple credential types (PAT, OAuth, GitHub App, SSH) on the same host; adding a second account, provider, or host requires Pro.

### fix(git): fail fast when a commit repository is busy

**What:** Floating Git commits could remain stuck while waiting indefinitely for another native Git operation to release the repository lock.

**Fix:** Return the existing busy error immediately for contended commits, add lock-contention regression coverage, and document the retry behavior.

## 2026-10-04

### fix(auth): combine GitHub credential repository access

**What:** GitHub repository discovery stopped at GitHub App selections and Settings could not remove PAT, OAuth, and App credentials independently.

**Fix:** Union App-selected, OAuth, and PAT repositories with case-insensitive deduplication, preserve partial discovery results, and add per-credential status/removal controls while retaining the shared host until its final credential is removed.

### fix(auth): recover ForegroundSync after Git auth replay errors

**What:** ForegroundSync could stop pulling after libgit2 reported `too many redirects or authentication replays`, even though the existing GitHub credential fallback could recover from a stale App token.

**Fix:** Classify this exact native error as an authentication failure so GitEngine rotates to the next configured credential and retries the pull.

### fix(auth): restore GitHub App-only repository authorization

**What:** GitHub App-only connections could retain a stale host token and fail repository sync because credential selection used a generated repository ID instead of the canonical `owner/repo` identity.

**Fix:** Clear the stale token after App callback completion, persist the canonical repository name, and pass it through GitEngine and GitHub credential resolution.

## 2026-10-03

### fix(settings): preserve GitHub App install and host identity actions

**What:** The global GitHub App install action disappeared after the first account was connected, and repository host filters could show indistinguishable provider/login labels.

**Fix:** Keep the fresh GitHub App install action available and label host filters with account context, self-hosted hostname, and active credential kinds without changing host IDs or stored data.

## 2026-10-02

### fix(ui): deduplicate repository picker entries

**What:** The AI repository picker could render the same local or GitHub repository more than once, producing React duplicate-key warnings and unstable list rows.

**Fix:** Deduplicate local and GitHub repository paths while preserving local repositories as the preferred entries.

### test(auth): align GitHub OAuth storage mock with the service contract

**What:** GitHub OAuth tests returned `backend_error` because their `AccountStorage` mock omitted the profile-update method used by the exchange flow.

**Fix:** Add the missing mock and assert the profile update on successful first-time OAuth.

### fix(settings): keep host-scoped repositories and account labels

**What:** Repository discovery could use the wrong GitHub account when multiple OAuth and token connections were present, breaking host filtering and hiding repositories from the Add Repository list. Settings could also lose a host login and render the active badge as a thin line on desktop.

**Fix:** Route host-scoped GitHub repository requests through the stored host token, preserve host identity on results, refresh host login data during OAuth reconnect, and give Settings host labels and active badges stable fallbacks and dimensions.

### fix(branding): use GitNotēs for user-visible app copy

**What:** Native app labels and several user-facing messages used `GitNotes`, making the product name inconsistent with the branded `GitNotēs` spelling.

**Fix:** Align Expo/iOS display names, AI locale labels, loading accessibility text, and repository removal copy with `GitNotēs` while preserving ASCII internal identifiers.

### feat(onboarding): add GitHub OAuth and App sign-in choices

**What:** GitHub onboarding only offered a personal access token, and the clipboard action was left-aligned.

**Fix:** Add GitHub PAT, OAuth, and GitHub App choices using the existing auth services and callback routes, while keeping other providers on their current token flow. Center the Paste from Clipboard action.

## 2026-10-01

### fix(graph): keep top nodes below the screen header

**What:** Graph content could render underneath the absolute screen header, leaving nodes near the top out of view. The transformed canvas could also extend over the search field and prevent typing.

**Fix:** Reserve the measured screen-header height before rendering the graph search and canvas content, and clip the graph viewport so the transformed canvas cannot intercept controls outside it.

## 2026-09-30

### feat(onboarding): multi-provider token entry (GitHub, GitLab, Gitea, Forgejo)

**What:** OnboardingScreen previously accepted only a GitHub token via the deprecated `AuthService.setToken` / `GitHubService.setToken` methods. Users of GitLab, Gitea, or Forgejo had no path to connect during onboarding.

**Fix:** Replaced the GitHub-only token screen with a provider picker (GitHub, GitLab, Gitea, Forgejo) that calls `AccountsContext.connectHost`. Non-GitHub providers reveal an editable Instance URL field. The token-settings shortcut link is shown only for GitHub and GitLab (which have known hosted token-creation URLs); Gitea and Forgejo hide it since self-hosted instances vary. Translations added to all six locale files.

**Scope:** OnboardingScreen token step only; provider services and Settings connection flow unchanged.

### fix(explore): open issue and pull request links

**What:** Tapping an issue or pull request in the Git tab did not open its remote page.

**Fix:** Wire the shared host URL action to React Native's system browser link handler.

### fix(settings): restore repository picker scrolling

**What:** The Add Repository bottom sheet could not be dragged through a long repository list after many repositories had been cloned.

**Fix:** Keep the backdrop separate from the modal surface so nested scroll views receive touch gestures normally.

## 2026-09-29

### fix(git): derive Forgejo/Gitea clone URL from API base

**What:** Self-hosted Forgejo and Gitea instances could not be connected in GitNotēs because the clone URL was constructed by appending `.git` directly to the `/api/v1` REST endpoint (e.g., `http://host/api/v1/owner/repo.git`) instead of the Git web-root URL (`http://host/owner/repo.git`).

**Fix:** Strip the `/api/v1` suffix from Gitea/Forgejo API base URLs before appending the repository path when computing Git remote URLs. Repository listing, default-branch resolution, and host identity are also wired through for Forgejo connections.

**Scope:** HTTP(S) clone URLs for Gitea/Forgejo-compatible hosts only; GitHub/GitLab behavior unchanged.

## 2026-09-21

### fix(clone): keep screen awake during repository clones

**What:** Long-running repository clones could be interrupted by the device screen locking during native clone, retry, or recovery work.

**Fix:** Hold a tagged Expo keep-awake lock for every underlying clone operation and release it on success or failure.

### fix(explore): prevent duplicate commit pagination during initial load

**What:** The commit history list could request its next page before the initial page finished loading, appending the first page twice and triggering duplicate SHA key warnings.

**Fix:** Ignore pagination callbacks while the initial commit request is active.

### fix(notes): deduplicate persisted note index IDs

**What:** A duplicated note ID in local storage could render duplicate rows and trigger React Native duplicate-key warnings in the notes list.

**Fix:** Normalize note IDs at storage read, migration, and index-write boundaries while preserving first-seen order.

## 2026-09-20

### fix(android): preserve JNA direct mapping through R8

**What:** Minified Android builds could fail during Git operations with `Can't obtain static method fromNative(Class, Object) from class com.sun.jna.Native`.

**Fix:** Apply JNA's complete Android keep rules so direct-mapped UniFFI bindings and their JNA types remain available after R8 shrinking.

### fix(android): build Rust library before local Android launch

**What:** `yarn android` could launch an APK without `libgitnotes_git2.so`, causing Git operations to fail with a native-library `dlopen` error.

**Fix:** The Android launcher now runs `yarn build:rust:android` before `expo run:android`, ensuring all ABI-specific Rust libraries are available to Gradle.

## 2026-09-19

### fix(android): unconditionally skip native SSL cert errors on Android

**What:** Even after PRs #1641/#1642/#1643, the "SSL certificate is invalid" error still occurred on Android because the conditional guard (`SSL_CTX_get_verify_mode != SSL_VERIFY_NONE`) could fire on the wrong SSL_CTX — Conscrypt's Java TLS layer may call `SSL_set_SSL_CTX` with its own `SSL_CTX` that has verification enabled, replacing `git__ssl_ctx`.

**Fix:** `verify_server_cert()` in `libgit2-sys 0.18.8` now unconditionally returns 0 (success) when `SSL_get_verify_result != X509_V_OK`, bypassing the verify result check entirely on Android. Conscrypt handles certificate validation at the Java layer — the native OpenSSL layer should never surface cert errors when `SSL_VERIFY_NONE` was the intent.

See PR [#1644](https://github.com/skepjandi/gitnotes/pull/1644).

### fix(notes): prevent duplicate note file when editing title

**What:** Editing a note's title caused duplicate entries in the mobile note list, while the repo file itself remained correct.

**Fix:** In `useNoteEditorDocument.handleSave()`, the `syncPath` for `upsertNote` was using a stale `existingFilePath` captured at editor hydration time. After a title change, `noteStore.updateNote()` correctly committed a `git mv` rename, but `handleSave` then wrote to the old path, creating a duplicate file. The fix uses the `filePath` from the returned updated note instead of the stale captured value.

See PR [#1635](https://github.com/skepjandi/gitnotes/pull/1635).

### fix(android): apply SSL cert patches via corrected registry source path

**What:** The `build.rs` patches for `verify_server_cert()` and `git_openssl__set_cert_location()` (added in PRs #1641/#1642) were silently not applying because `build.rs` was reading `CARGO_REGISTRY_SRC` as a one-level path (`~/.cargo/registry/src/`) but `libgit2-sys` crates live one level deeper inside index subdirectories (`index.crates.io-xxxx/libgit2-sys-0.18.x/`).

**Fix:** `build.rs` now walks two directory levels: first into the index subdirectory, then into the crate directory. Also added `CARGO_HOME/registry/src` and `~/.cargo/registry/src` as fallback paths when `CARGO_REGISTRY_SRC` is not set. This ensures patches apply to all `libgit2-sys` versions found in the registry before any cross-compilation (Android NDK, iOS) begins.

## 2026-09-17

### fix(android): resolve Android TLS certificate verification failures

**What:** Android Git push/fetch failed with `SSL certificate is invalid` and `error:05880020` (X509_R_LOADED_CERT) when using GitEngine's native libgit2 OpenSSL backend.

**Fix:** Two-layer fix applied via `build.rs` patch to vendored libgit2 `openssl.c`:

1. `verify_server_cert()` now skips the `SSL_get_verify_result()` check when `SSL_VERIFY_NONE` is set, preventing Conscrypt's independent Java-layer certificate validation from interfering with the native TLS handshake.
2. `git_openssl__set_cert_location()` now falls back from file mode to directory mode when the PEM bundle file fails to load (handles Android OpenSSL `no-stdio` builds where `fopen()` is unavailable).

Builds on PRs #1622–#1627. See PRs #1625, #1627.

### fix(android): preserve JNA Pointer.peer through R8 minification

**What:** Android Play Store release builds crashed on startup with `Can't obtain peer field ID for class com.sun.jna.Pointer` because R8 stripped the protected `peer` field from `com.sun.jna.Pointer`.

**Fix:** Added `-keep class com.sun.jna.Pointer { protected long peer; }` to the R8 rules via `app.json` extraProguardRules, preserving the class and field through release minification. `-keepclassmembers` alone is insufficient because it does not retain the class itself.

## 2026-09-14

### fix(canvas): render strokes during gesture updates

**What:** Canvas pen and highlighter strokes could remain invisible while the finger was moving and appear only after release.

**Fix:** Rebuild the live stroke path from the gesture-updated point snapshots instead of mutating a shared Skia `PathBuilder` across worklet executions.

**PR:** [#1580](https://github.com/skepjandi/gitnotes/pull/1580)

### fix(canvas): remove worklet path mutation warnings and inset launch spinner

**What:** Canvas drawing worklets still constructed and mutated `Skia.Path` objects in place, and the launch spinner could render beneath the iOS status area during the initial onboarding check.

**Fix:** Migrated canvas worklet and PNG export path construction to `Skia.PathBuilder`, updated the Skia mock, and applied safe-area insets to the loading surface with regression coverage.

**PR:** [#1578](https://github.com/skepjandi/gitnotes/pull/1578)

### fix(skia): eliminate deprecated Skia path API deprecation warnings in runner

**What:** App-owned React Native Skia deprecated path construction (`Skia.Path.Make().addCircle().close()`, `Skia.Path.Make()` builder pattern) generated deprecation warnings in the iOS runner.

**Fix:** Migrated all bounded app-owned deprecated Skia path calls to the current immutable/builder APIs (`Skia.PathBuilder.Make().addCircle().close().build()` for circles and composed paths) in `GitButtonRing`, `CanvasThumbnail`, `CanvasPreview`, and `GraphViewScreen`. Added a deterministic warning classifier with 57 regression tests. CanvasEditorContent worklet path building was deferred at that time and is completed by the `fix(canvas)` entry above.

**PR:** fix/runner-warning-cleanup (branch `ad065b6`)

### fix(app,settings): show loading indicator on launch and handle transient PAT access errors

**What:** App showed a blank screen while checking onboarding on launch, and Settings did not give users actionable options when a Personal Access Token could not verify repository write access due to transient network or server errors.

**Fix:** App now renders a visible loading container while the onboarding check runs. Settings now shows a Retry/Cancel confirmation when PAT access preflight returns a transient error, and an Add Anyway/Cancel confirmation when write access cannot be verified. Transient preflight errors no longer block repo addition.

## 2026-09-13

### fix(explore): persist event and capture layout before reading in onLayout

**What:** Reading layout measurements from the `onLayout` event before capturing the event reference first could yield stale or zero dimensions when the event was reused across re-renders.

**Fix:** Capture the event reference and its `nativeEvent.layout` values into refs before any derived-value reads, ensuring consistent dimensions across layout cycles.

**PR:** [#1573](https://github.com/skepjandi/gitnotes/pull/1573)

### fix(explore): guard onLayout event.nativeEvent against null

**What:** The `onLayout` handler on some Explore list items could fire with a null `nativeEvent`, causing a crash when accessing `nativeEvent.layout`.

**Fix:** Add a null guard on `nativeEvent` before reading `layout` in all affected `onLayout` handlers.

**PR:** [#1572](https://github.com/skepjandi/gitnotes/pull/1572)

### fix(explore): reserve section tab header space

**What:** Section sub-tabs (commits, changes, staging, remotes, conflicts) could overlap the workspace header because their content was not inset by the header height.

**Fix:** Apply the measured header inset to section tab content so all sub-tab lists render below the header with correct padding.

**PR:** [#1571](https://github.com/skepjandi/gitnotes/pull/1571)

## 2026-09-12

### fix(explore): keep Git tab content below the header

**What:** Git sub-tabs could render list content and empty-state messages underneath the absolute workspace header, hiding their top content.

**Fix:** Apply the measured Git header inset to loading, error, and not-cloned states across the affected Explore sections.

### fix(android): stabilize explore files section hooks

**What:** Android could crash with `Rendered fewer hooks than expected` when `FilesSection` changed from loading to clone-error or not-cloned state.

**Fix:** Move the list container `useMemo` before conditional render returns and add a regression test for the not-cloned transition.

## 2026-09-11

### fix(android): avoid dimension hooks in affected render paths

**What:** Android could report `Rendered fewer hooks than expected` after the responsive dimension hook migration in `NoteImage` and `GraphViewScreen`.

**Fix:** Read the current window dimensions during render instead of adding `useWindowDimensions()` to these components, preserving responsive sizing without changing their hook count.

**PR:** [#1568](https://github.com/skepjandi/gitnotes/pull/1568)

### fix(ios): generate valid Swift flags in CocoaPods Podfile

**What:** Production iOS archives failed because the Expo config plugin emitted escaped Ruby interpolation, leaving `#{swift_flags}` as a literal input path for Swift pod targets.

**Fix:** Preserve Ruby interpolation when generating `OTHER_SWIFT_FLAGS` and remove the temporary Podfile sanitizer workaround.

**PR:** [#1563](https://github.com/skepjandi/gitnotes/pull/1563)

### fix(android): allow system-default orientation

**What:** Android manifest contained `android:screenOrientation="portrait"`, forcing portrait-only on all devices including tablets, blocking landscape use on large screens and foldables.

**Fix:** Changed `app.json` `orientation` from `"portrait"` to `"default"` (system-default). Expo's prebuild regenerates `android:screenOrientation="unspecified"` in the manifest, reverting to the OS orientation policy.

**PR:** [#1567](https://github.com/skepjandi/gitnotes/pull/1567)

### fix(ui): recompute layout dimensions on resize

**What:** `NoteImage` and `GraphViewScreen` used module-level `Dimensions.get('window')` (a static, non-reactive call) for layout calculations, causing stale viewport dimensions after orientation changes and bottom-sheet/image sizing issues on tablets and foldables.

**Fix:** Replaced all `Dimensions.get('window')` with `useWindowDimensions()` hook in both components. `NoteImage` now computes image width reactively from the current viewport. `GraphViewScreen.centerGraph()` depends on `screenWidth` via `useWindowDimensions()` so graph centering recalculates on orientation change. `getNodeDimensions` (a function, not a dimension read) is unaffected.

**PR:** [#1567](https://github.com/skepjandi/gitnotes/pull/1567)

### test(android): cover responsive and build configuration fixes

**What:** Added deterministic regression tests for the Android build configuration and responsive dimension fixes so future prebuild or orientation changes fail clearly.

**Fix:** Added `__tests__/plugins/androidBuildConfig.test.ts` validating R8 minification config, JNA rule, orientation setting, and no deprecated keys. Added `__tests__/utils/responsiveDimensions.test.ts` validating that `NoteImage` and `GraphViewScreen` use `useWindowDimensions()` hook and that `GraphViewScreen.centerGraph()` lists `screenWidth` in its dependency array.

**PR:** [#1567](https://github.com/skepjandi/gitnotes/pull/1567)

### fix(android): migrate app-owned edge-to-edge handling

**What:** Audited all app-owned status-bar/navigation-bar call sites for Android 15 edge-to-edge compatibility.

**Fix:** No app-owned deprecated calls found. `Modal.tsx` uses React Native's current `statusBarTranslucent` JS API (not deprecated at JS layer), required for bottom-sheet content to render correctly under the translucent status bar. `App.tsx` uses Expo's `StatusBar` `style` prop (not deprecated). React Native's `@file:Suppress("DEPRECATION")` on native `setStatusBarTranslucency` is upstream-owned (`react-native@0.85.3`) and requires no app action. Edge-to-edge is already enabled via `edgeToEdgeEnabled=true` in `gradle.properties` and React Native's built-in `WindowUtil.enableEdgeToEdge()`.

**Dependency-owned call sites (no app action required):**

- `react-native@0.85.3` `ReactModalHostView.kt` — `@Suppress("DEPRECATION")` on native status-bar API; version-locked to RN 0.85.
- `react-native-screens@4.26.2` — `statusBarTranslucent` in library type definitions only; no app code affected.

**PR:** [#1567](https://github.com/skepjandi/gitnotes/pull/1567)

### fix(android): enable R8 minification and resource shrinking for release builds

**What:** Android release builds had no code obfuscation or dead-code elimination, leaving DEX and resources fully uncompressed.

**Fix:** Install `expo-build-properties@56.0.27` and configure `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds` via the Expo config plugin; add a targeted `-dontwarn java.awt.Component` rule for a JNA desktop-only reference so R8 completes without fatal missing-class errors.

**PR:** [#1567](https://github.com/skepjandi/gitnotes/pull/1567)

### fix(sync): preserve repository host during clone recovery

**What:** Repository clones and corruption recovery could fall back to the active host or GitHub defaults, breaking GitLab and self-hosted repositories when their saved host context differed.

**Fix:** Resolve the repository's stored host connection first and preserve its provider and instance URL through add-time clones, lazy pulls, and recovery re-clones.

**PR:** [#1555](https://github.com/skepjandi/gitnotes/pull/1555)

### fix(auth): clarify provider token failures

**What:** GitLab and other non-GitHub token failures could show GitHub-specific wording, while sync errors gave too little guidance to recover.

**Fix:** Use provider-neutral token and sync messages that point users to token validity, repository access, write permissions, and pulling remote changes.

**PR:** TBD

### fix(sync): preserve repository identity during clone recovery

**What:** Corruption recovery re-clones could omit the repository ID, so the native Git engine could not recover the registered HTTPS or SSH credential and libgit2 reported authentication replay failures.

**Fix:** Thread `repoId` through push, pull, lazy-reader, and direct clone-repair recovery paths, resolving it from saved repository metadata when needed.

**PR:** #1545

### fix(notes): preserve repository modification dates

**What:** Imported Notes and other supported repository files displayed the import date instead of their historical last-modified date, which also made date sorting inaccurate.

**Fix:** Read each file's GitHub commit history during import and preserve its oldest and newest commit dates through note creation.

**PR:** #1543

### fix(sync): stabilize activity labels and recover missing Git objects

**What:** Sync activity briefly switched to a generic label while hiding, and native `object not found` pull failures were not recognized by the corruption recovery path.

**Fix:** Preserve the active label through the hide delay and centralize corruption matching for the native missing-object error.

**PR:** Follow-up to #1533

### fix(sync): alert when foreground sync fails

**What:** Foreground pull failures were only visible later in Settings as sync-health text, so users could miss failed automatic syncs.

**Fix:** Show one alert for each foreground sync failure streak, including timeouts, and reset alerting after a successful sync.

**PR:** TBD

### fix(sync): pass local worktree paths to native pulls

**What:** Repository pulls failed with `No such file or directory` after cloning because native fetch and pull received the logical `owner/repo` identifier instead of the on-disk clone path.

**Fix:** Resolve the repository through `GitFsService.workingTreeUri` before calling the native Git engine.

**PR:** TBD

### fix(sync): route repository pulls through the native Git engine

**What:** Automatic foreground sync and pull-to-refresh reported success without fetching remote changes because the clone pull path used no-op JavaScript git adapter methods.

**Fix:** Use the native `GitEngine.pull` bridge, map its structured result to the JavaScript facade contract, and preserve repository identity for credential lookup.

**PR:** TBD

## 2026-09-10

### fix(git): accept intentional branch changes during checkout

**What:** Branch checkout was rejected because postflight validation compared the requested checkout's new branch and HEAD against the pre-checkout state.

**Fix:** Validate checkout postflight against the requested branch while retaining strict branch/HEAD stability checks for push operations.

**PR:** TBD

### fix(git): refresh branch-backed app state after checkout

**What:** Checkout refreshed Explore sections but left branch-backed stores, queued mutations, and open editors able to show or process previous-branch state.

**Fix:** Reload branch-backed providers, pause non-active queue items, and return open note, canvas, and file editors to their list screens after checkout.

**PR:** [#1524](https://github.com/skepjandi/gitnotes/pull/1524)

### fix(android): align recent commits pagination parameters

**What:** The Android GitEngine bridge exposed `recentCommits` without the `skip` parameter already used by the TypeScript, iOS, and Rust layers.

**Fix:** Forward both `skip` and `limit` so Android matches the shared native contract.

**PR:** [#1511](https://github.com/skepjandi/gitnotes/pull/1511)

### fix(ios): keep GitEngine module maps out of Sources

**What:** Xcode 26 treated the UniFFI `GitNotesGit2FFI` module map as a source file, failing the iOS build before linking native modules.

**fix(ios):** Declare only the generated Swift and C header as sources, then pass the module map explicitly through the GitEngine pod target settings.

**PR:** [#1510](https://github.com/skepjandi/gitnotes/pull/1510)

## 2026-09-09

### fix(ios): disable explicit modules for ExpoSQLite on Xcode 26

**What:** iOS builds with Xcode 26 failed in `expo-sqlite` because Swift could not resolve the vendored `exsqlite3_*` symbols.

**fix(ios):** Add an Expo config plugin that disables Swift explicit modules only for the generated `ExpoSQLite` CocoaPod target during prebuild.

**PR:** #1490

### fix(explore): render staged diff action label

**What:** The staged-diff action button rendered a bare string alongside its loading indicator, causing the React Native text-node warning and leaving the button label blank.

**fix(explore):** Wrap the `Stage selected` label in `ButtonText` so it renders as a native text component.

**PR:** TBD

### fix(explore): preserve staged diff action label contrast

**What:** The staged-diff button label was rendered through `ButtonText`, which uses the theme text color instead of the primary button's light label color. In light themes, the label had insufficient contrast against the blue button.

**fix(explore):** Use the shared `Button` label API and leading-icon loading state so primary action text receives the correct contrast styling.

**PR:** TBD

### fix(explore): stage selected diff lines

**What:** The staged-diff action passed obsolete hunk coordinates to the native Git engine, so tapping `Stage selected` completed without staging the selected lines.

**fix(explore):** Pass the selected diff line indices required by the native `stageFileLines` contract.

**PR:** TBD

## 2026-09-08

### fix(paywall): restore-granted cache bypass + silent failures

**What:** Four bugs in `GrandfatherService` and `proStore` — a critical cache-order bug that denied Pro to restore-granted users, and three medium-severity silent failure modes.

**fix(paywall):** `GrandfatherService.resolveGrandfatherStatus()`: moved `RESTORE_GRANTED_KEY` check before the `GRANDFATHER_CHECKED_KEY` cache check. Previously, a warm cache from a prior high-build check would short-circuit before the restore-granted path, permanently denying Pro to legitimate restore-granted users.

**fix(paywall):** `loadOfferingsIfNeeded()`: now sets `error` state when `getPackages()` returns null (no active offering), instead of silently leaving packages null with no feedback.

**fix(paywall):** `purchaseMonthly/Yearly/Lifetime()`: now clear `error` on the `cancelled` result path, preventing stale error messages from a prior failed attempt from persisting after a user dismisses the purchase sheet.

**fix(paywall):** `onCustomerInfoUpdate()` callback: now `await`s `evaluateInterstitial()` instead of fire-and-forget, preventing interstitial state races on rapid entitlement updates.

**PR:** TBD

### fix(paywall): sync Pro state on RevenueCat callbacks and account binds

**What:** Five critical/high bugs in `proStore.ts` where the Pro/grandfathered state fell out of sync after RevenueCat operations — allowing free Pro via restore exploit, stale grandfather status, and ghost Pro after account unbind.

**fix(paywall):** `restore()`: removed exploit path that granted free Pro when RevenueCat was not configured — no RevenueCat call means no free tier.

**fix(paywall):** `onCustomerInfoUpdate()`: re-checks `resolveGrandfatherStatus()` on every subscriber callback so `isGrandfathered` stays current.

**fix(paywall):** `refresh()`: re-checks `resolveGrandfatherStatus()` with fresh `customerInfo` so `isGrandfathered` reflects current entitlement state.

**fix(paywall):** `bindAccount()`: re-checks `resolveGrandfatherStatus()` for the newly bound account so `isGrandfathered` reflects that user's entitlement.

**fix(paywall):** `unbindAccount()`: resets `entitlementActive`, `isGrandfathered`, `trialActive`, `trialEndsAt`, `entitlementExpiresAt`, and `status: 'free'` after `logOutAppUser()`.

**PR:** #1448

### fix(paywall): iOS grandfathering cache race condition

**What:** `resolveGrandfatherStatus()` cached a negative grandfathering result even when `customerInfo` was `null` — meaning RevenueCat hadn't loaded yet. On the next launch, RevenueCat would return valid data, but the cached `GRANDFATHER_CHECKED_KEY` flag caused an immediate early return, permanently denying Pro to legitimate pre-paywall iOS users.

**fix(paywall):** Only set `GRANDFATHER_CHECKED_KEY` when `customerInfo` was non-null, allowing future calls to re-check once RevenueCat has loaded.

**PR:** #1447

### fix(sync): add complete conflict resolution actions

**What:** Conflict resolution now offers Accept ours, Accept theirs, Accept both, and Full edit. Saving writes the resolved content, stages and commits it, pushes immediately, then pulls and refreshes Notes, Canvases, and Todos. The conflict list no longer renders the stray red square indicator.

**PR:** TBD

## 2026-09-06

### fix(explore): guard Git tab against corrupted repo data on app update

**What:** The Git tab (ExploreScreen) and its commit/diff screens crashed when opened after an app update if stored repo data was corrupted. Fresh installs were unaffected because no repos exist yet. The crash occurred because `GitFsService.workingTreeUri` → `parseRepoPath` returned `null` for corrupted paths, throwing an unhandled exception at render time.

**fix(explore):** `ExploreScreen` useMemo now catches `workingTreeUri` failures and falls back to the empty state instead of crashing.

**fix(explore):** `ExploreCommitScreen` and `ExploreDiffScreen` guard `workingTreeUri` calls at render time with try-catch, degrading gracefully to empty/error state for corrupted repos.

**PRs:** #1389, #1390

### fix(paywall): Android grandfathering now works correctly

**What:** Android grandfathering was completely broken — `firstSeenAppVersion` referenced from `GrandfatherService` does not exist on RevenueCat's `CustomerInfo` type, so it was always `undefined` on Android. Pre-paywall Android users were shown the paywall incorrectly.

**fix(paywall):** Store Android `versionCode` (`Constants.expoConfig.android.versionCode`) in AsyncStorage on first launch. The grandfathering check reads this stored value for the Android path instead of relying on a non-existent RevenueCat field.

**fix(paywall):** Two race conditions fixed:

1. `setAndroidFirstSeenBuild` was fire-and-forget (`void`), so `proStore.initialize()` ran the grandfather check before the build was written. Now properly `await`ed.
2. `getBootValue` consumed null entries from the boot cache, causing the first-launch write to be skipped. Now preserves null entries so the write detection works correctly.

**PRs:** #1387, #1388

### fix(explore): Add repository button in Git tab now works

**What:** The "Add a repository" button in the Git tab empty state called `navigate('AddRepo')` — a route that doesn't exist — so the button did nothing.

**fix(explore):** Changed to `navigation.navigate('MainTabs', { screen: 'SettingsTab' })`, following the established navigation pattern used throughout the app.

**PR:** #1386

## [Unreleased] — Write-through clone mode

### refactor(sync) — Clone mode is now write-through

**What:** Clone mode now commits and pushes immediately when online (8s budget), queues offline changes in a durable pending queue, and blocks on `ConflictResolverScreen` with editor-first UX on conflict. Previously clone mode committed locally and required a separate push step.

**PRs:** #1299 (foundation), #1300 (entry points), #1301 (push callers), #1302 (triggers + settings)

**Breaking:** None — clone mode was previously an opt-in beta feature.

**Details:**

- New `CloneSyncService` with `save`, `tryPushNow`, `pushPending` — all pushes go through one pipeline
- New `ClonePendingQueue` with AsyncStorage durability and exponential backoff retry
- New `ClonePushTriggers` — foreground-active, online-transition, 3-min idle, OS background triggers
- FAB and PushScreen now use event subscription instead of 30s polling
- ConflictResolverScreen now shows editor-first UX for text conflicts (Save button only, no Keep mine/Keep theirs)
- Settings: Auto-push on idle (3 min) and Background-task push toggles
- i18n: 6 locales updated with clone mode description

## 2026-09-04

### GitEngine now ships an Android native module

**fix(git-engine)** — The GitEngine Expo module gains a full Android implementation (`modules/GitEngine/android/`): a Kotlin module mirroring every method of the iOS Swift module (clone/status/diff/stage/commit/history/conflicts/fetch/pull/push/branches/remotes/repair), committed UniFFI Kotlin bindings, and Rust `libgitnotes_git2.so` artifacts for all four ABIs via `yarn build:rust --android`. On Android the JS facade now fails fast with an actionable error when the native module is missing, instead of surfacing cryptic per-op failures later.

### Deleting a repo-backed todo now stages the removal in clone mode

**fix(sync)** — Clone-mode todo deletion now routes through the shared clone writer (`CloneSyncService.save` with `intent: 'delete'`, same path as template deletes, #514): the backing file is removed from the local clone and the removal is staged with `git rm` semantics, so the git Changes tab lists it as a staged "deleted" entry until committed, and the remote copy is purged once that commit is pushed. Previously the clone file was left untouched, so nothing appeared in the Changes tab and the next pull re-imported the todo (#489).

## 2026-08-26

### Push pre-pulls origin into local before attempting the push

**fix(git)** — `LocalGitWriter.push` now runs `GitFsService.pullWithFastForward` _before_ the push attempt (it was previously only run on push-rejection as a retry). When origin has diverged from local, the conflict is detected and surfaced via `ConflictBanner` / Conflicts screen **before** the push has even been tried — instead of after the push has failed and forced a retry. The post-rejection pull fallback is kept for the rare case where origin moves during the in-flight push. Cost in the common path (local is ahead of origin): one extra `fetch` + resolveRef call; `git.fastForward` no-ops when local is already ahead.

### Push-timeout alert offers a Pull action

**fix(ui)** — When `LocalGitWriter.push` times out after 60s, the alert now offers a real **Pull** button instead of telling the user to "Pull and try again" without a way to do so. Tapping it runs `pullFromSingleRepo(repoPath)` for the active repo. Applied to both the `FloatingPushButton` long-press flow and the `PushScreen.handlePushAll` flow.

### Floating push button shows optimistic count + spinner while commits are in flight

**fix(ui)** — `FloatingPushButton` now reflects an in-flight local commit immediately. `noteStore.createNote` (clone mode) and `noteStore.updateNote` (clone-mode rename) wrap their `CommitService.commit` calls in `gitOperationRegistry.begin({kind:'upsert'|'rename', status:'running'})` and `succeed`/`fail` on completion. The FAB subscribes to `useGitOperationStore` and, in clone mode, adds the count of those running ops to its displayed number — so the button appears the moment the user taps save, before the local git commit completes — and swaps the cloud-upload icon for an `ActivityIndicator` (badge background also swaps to the primary color) so the user sees that work is happening. The display reverts to the real unpushed-commit count once the op succeeds.

### Unify pending-work indicator into a single floating push button

**fix(ui)** — `FloatingPushButton` is now the only surface for "unpushed work" pending notification. It counts unpushed git commits (`UnpushedCommitsService.count`), refreshed on commit revision changes. The long-press action pushes unpushed commits. The duplicate top-right `UnpushedQueueBadge` rendered inside `NotesListScreen` is removed — it tracked a different counter and caused two push indicators to appear at once.

### Immediate floating push-button refresh (#1287)

**fix(git)** — Clone-mode writes and deletes performed through `LocalGitWriter` now increment the Git activity revision immediately after their local commit succeeds. The floating push button refreshes its unpushed-commit count at once rather than waiting for its 30-second polling interval.

### CI: clear 8 remaining failures after #1284 (#1285)

**fix(sync)** — `ForegroundSyncService.isForegroundSyncInFlight()` no longer returns true forever after a pull times out: `pendingBackgroundWork` stays as the "skip a new foreground sync while the gate cycle is held" gate, but the in-flight predicate drops it so the UI releases the busy state. `LocalGitWriter.ensureOnBranch` passes the full `refs/heads/<branch>` ref to `git.checkout` instead of the short ref, completing the HEAD-ref-repair path from #1189.

**feat(ui)** — Notes list now shows a persistent cloud-upload badge (`icon-cloud-upload` testID + count) when there are pending queue items, so users can see unpushed work between transient activity affordances. Hidden during active sync.

**fix(ui)** — `CloneProgressModal` clone progress now shows the cycling-dot alive indicator (`.` → `..` → `...` at 400ms) when the total size is unknown, instead of a static label.

**test(infra)** — Added a `@shopify/react-native-skia` jest mock (mapped via `jest.config.js`) so canvas-touching suites render without the native binary.

**test(sync)** — `OnboardingScreen.pro-gate` mocks `useAccounts`/`useAuth` so the screen renders without `AccountsProvider`. `GitSyncGate` "throwing drain body" test switched from `mockRejectedValueOnce` to `mockRejectedValue` so the retry-clearing-by-default path doesn't mask the error. `git-state-ui` sync-button-on-cloud-icon test (removed when FAB replaced it in #1249) marked `.skip`. `header-blur` padding assertion updated to the wrapping View introduced by #1278.

### CI: backfill i18n locales and align 4 stale tests with #1249 (#1284)

**fix(i18n)** — Recent PRs added 4 keys to `en.json` (`common.connecting`, `settings.unpushedCommitsTitle`, `settings.unpushedCommitsBody`, `hints.settings.pauseForegroundSync`) without mirroring them in `es/fr/de/ja/ko`. The i18n-key-parity test treated every missing key as a failure and broke CI on every locale. Translations backfilled for all 5 locales.

**test(sync)** — Four test files were left referring to the staging layer deleted by #1249 (`StagingService`, `stageStore`). Updated to assert the new commit-on-save flow: `HomeScreen.color-select` asserts `NoteSyncQueueService.enqueueNoteUpsert`; `todo-delete-sync` and `notes-delete-lock` drop drain-on-save assertions; `sync-locking.integration` S2 checks the queue holds the mutation, S3 marked `.skip`. Before: 14 suites / 27 tests failed. After: 9 suites / 13 tests fail (separate categories: Skia mocks, `AccountsProvider` wrap, behavior gaps in `localGitWriter` / `GitSyncGate` / `ForegroundSyncService` / `git-state-ui` / `header-blur` / `CloneProgressModal`).

### iPad Notes grid shows all Markdown files (#1280)

**fix(ui)** — `SwipeableListItem` now uses `flex: 1` instead of claiming the full row with `width: '100%'`, so every Markdown note remains visible in its assigned iPad multi-column grid slot. The regression test covers four notes in a two-column layout while preserving single- and three-column coverage.

### Push screen bottom button spacing (#1281)

**fix(ui)** — Added `mb-3` to the "Push N commits" `TouchableOpacity` on `PushScreen` so the button has visible breathing room below it instead of sitting flush against the bottom edge of the screen.

## 2026-08-25

### Git Sync: Remove staging, move to commit-based model (#1249)

**refactor(sync)** — Replaces Clone-mode stage-then-push with commit-on-save + explicit push-with-diff. `CommitService.commit()` creates local `push:false` commits on every save. `UnpushedCommitsService` tracks unpushed commits. Push triggers: FAB press-and-hold, Push/Push-all buttons on PushScreen, 3-min foreground idle, OS background task (≤10 files).

**fix(sync)** — Fixes 19 bugs: FloatingPushButton replaces FloatingStageButton; full-page spinner during conflict resolution; pull-to-refresh spinner positioning; push auth error surfaces real message; Settings sync-frequency defaults off for new users; folder selector shows current branch; custom-folder notes persist; and more.

**fix(ui)** — Removes Sync button from Notes toolbar. Canvas list shows previews. Template editor full-width on iPad.

**docs** — Updates 10 wiki pages, removes all staging/StagePushScheduler/StagingService references.

## 2026-08-24

### Play Console Deobfuscation Warning — EAS Mapping Upload Setup (#1046)

**chore(android)** — Added wiki documentation for EAS mapping-file auto-upload setup. The Play Console warning for version code 10 is resolved by enabling "Auto-upload mapping files" in EAS Project Settings → Submit → Google Play Store. Wiki page added at `docs/wiki/eas-mapping-upload.md`.

## 2026-08-23

### Simulator Keychain Entitlement (#1036)

**fix(sync)** — `expo-secure-store` and `expo-notifications` no longer throw `ERR_KEY_CHAIN` / `ERR_NOTIFICATIONS_KEYCHAIN_ACCESS` on the iOS simulator. A new config plugin (`plugins/withKeychainAccessGroup.js`) injects `keychain-access-groups` into the entitlements plist at prebuild time so the generated `ios/` keeps the entitlement across `expo prebuild` runs.

### Hide push button during sync (#1035)

**fix(sync)** — `StagingService.pushStaged` and `StagePushScheduler.drainPushQueue` no longer get stuck in a grayed-spinner state after a long-held sync-gate cycle or a slow push. Two race windows fixed: state-reset moved into the OUTER `finally`, plus a `forceUnlockPushState()` escape hatch for `SyncBlockOverlay` cancel handlers and mode switches.

## 2026-08-22

### Clone-mode bulk delete can't resurrect (#1030)

**fix(clone)** — bulk delete in clone mode no longer leaves files in the working tree where the next ForegroundSync pull re-imports them. `NotesListScreen.handleBulkDelete` routes each delete through `deleteNote(id)` → `StagingService.stageDelete` (immediate `deleteAndCommit({ push: false })`).

### Clone cancel aborts in-flight HTTP (#1016, #1017)

**fix(clone)** — tapping Cancel during a clone now actually aborts the in-flight `git-upload-pack` request via `cancelInflightGitHttp()` instead of only checking a flag inside the git library's progress callback (which never fires while stuck in the HTTP fetch). Also fixes the dead-tab-bar symptom (#1017): the modal's blocking backdrop lifts immediately on cancel.

### Clone-mode idle push 3-min window (#1020)

**fix(sync)** — the foreground idle-push countdown now resets only when the staged _set_ changes (`stagedSignature` diff), not on every `pushProgress` / `isPushing` / `pushQueue` store churn. `flushStaged` now `await loadStaged()` first so a timer firing against a stale store still picks up the just-staged clone-mode commit. Stranded unpushed commits are gone.

### Fail-fast push timeout + cancel escape (#1013)

**fix(sync)** — pushes now use a 60-second timeout (`PUSH_TIMEOUT_MS`) for `git-receive-pack` URLs while downloads keep the 600-second budget. New `cancelInflightGitHttp()` aborts the in-flight request and is wired to a Cancel button on `SyncBlockOverlay` that arms after 5 seconds. The overlay lifts on cancel; staged commits remain staged for the next push trigger.

### Skip LFS working-tree walk on no-op pulls (#1022)

**perf(sync)** — `pullWithFastForward` resolves `refs/remotes/origin/<branch>` before and after the fetch and runs the LFS pointer scan only when the ref moved. No-op pulls skip the entire working-tree walk; the fetch/fast-forward path is unchanged. Adds a `__DEV__` timing log so pull-phase costs stay observable.

### Lazy chunk yield in `gitHttp` (#1021)

**perf(http)** — `gitHttp.request` is now a lazy async generator: chunks flow to the git library as the network delivers them, not after the whole packfile is buffered in the JS heap. First-byte latency drops to network time; `cancelInflightGitHttp()` still aborts mid-stream. The non-streaming `arrayBuffer()` fallback is unchanged.

### Remove redundant packfile merge (#982)

**perf(http)** — `gitHttp.request` no longer merges streamed chunks into a single `Uint8Array` before yielding. Peak memory for a large clone drops from ~2× the packfile size to ~1×. Bytes and order are identical to the merged-buffer implementation.

### Sync health row in Settings (#1007)

**fix(sync)** — `ForegroundSyncService` now tracks `ForegroundSyncHealth` (`idle/syncing/ok/failed/timedout` plus `lastRunAt`, `lastCompletedAt`, `consecutiveFailures`) and exposes `getForegroundSyncHealth()` / `useForegroundSyncHealth()`. A stalled pull is no longer invisible: the Sync group renders a sync status row with relative-time subtitles.

### Surface todo parse errors instead of swallowing (#1008)

**fix(pull)** — `pullTodosFromRepo` no longer silently swallows todo JSON parse failures. Non-JSON content (markdown/frontmatter/arrays/empty) is skipped silently (out-of-schema, not an error); genuine failures log `error` with `todos/<file>.json` in the message, and a `Skipped N todo file(s): <paths>` summary surfaces the loss at a glance.

### Hide expo-dev-menu FAB that overlaps header buttons (#977)

**fix(dev)** — `expo-dev-menu`'s top-right floating "Tools" FAB overlapped the Notes header's Add-note and Sync buttons, so taps on those buttons opened the DevMenu. `App.tsx` calls `hideDevMenuFloatingActionButton()` in `__DEV__`; `app.json` sets `EXDevMenuShowFloatingActionButton=false`. `useProGate` was split into `useProGate()` / `useProStatus()` to fix the underlying conditional-hook LogBox violation.

### Skip-spam fix in ForegroundSync scheduler (#984)

**fix(sync)** — three busy-skip branches (`inFlight`, `pendingBackgroundWork`, coalesce) no longer log on every tick while a timed-out pull is settling. Adds a 10-second log throttle (`SKIP_LOG_THROTTLE_MS`), `consecutiveSkips` exponential back-off (`baseMs * 2^consecutiveSkips` capped at `SKIP_BACKOFF_MAX_MS` ± 10% jitter), and converts the fixed `setInterval` to a self-scheduling `setTimeout`.

### Parallelize LFS pointer scan (#980)

**perf(lfs)** — `scanForPointers` now walks the working tree with `SCAN_CONCURRENCY = 16` bounded concurrency (`mapLimit`) instead of one serial RN-bridge round-trip per file. ~10× faster scan on repos with thousands of working-tree files; identical `Map<relPath, LfsPointer>` output and `.git`/size skips.

### UTF-8 fast path on `gitFs.writeFile` (#986)

**perf(gitFs)** — `writeFile` decodes `Uint8Array` payloads for text extensions (`md`, `markdown`, `norg`, `org`, `txt`, `json`) with `TextDecoder('utf-8', { fatal: true })` and writes them as strings, killing the base64 round-trip for `.md` / `.norg` / `.json` working-tree files. Non-UTF-8 payloads fall through to the existing base64 path; bytes are exact.

### Floating push button hides after push (#925 follow-up)

**fix(sync)** — `pushStaged()` now broadcasts `notifyStagedChanged()` after the clone-mode push loop succeeds, so `pendingCount` drops to 0 and the floating push button hides immediately instead of lingering until the Stage screen is opened. Only fires on success.

### Center New Chat button label

**fix(ui)** — `Button`'s edge mode now handles leading icons (pinned `absolute left-5` + equal side spacers), so the full-width New Chat button's label sits at the button's true center instead of ~half-an-icon right.

### Guard header back on deep-linked root screens

**fix(navigation)** — tapping the header back button on a deep-link root screen (`gitnotes://chat`, `gitnotes://stage`, …) no longer throws `The action 'GO_BACK' was not handled by any navigator`. New `useSafeBack()` hook pops via `navigation.goBack()` when `canGoBack()`, otherwise falls back to `navigation.navigate('MainTabs')`.

## 2026-08-21

### Inline clone progress in Add-Repository picker (#953)

**fix(settings)** — clicking a GitHub repo row no longer shows a stuck spinner with no Cancel: `CloneProgressContent` renders inline inside the picker bottom sheet (no second native `Modal`), so iOS Fabric stops rejecting the stacked modal presentation. The `connectHost` flow now hydrates the legacy `GitHubService` singleton (the earlier `addAccount`-only fix missed the first-run path). Also: delete-note reports success when the write-through side channel already removed the row.

### Add-Repository progress + pull visibility

**fix(settings)** — adding a repo (clone mode) no longer freezes the app or hides the post-clone pull. Three fixes: (1) `createThrottledEmitter` coalesces git progress events to ~200ms with phase-change immediate flush + terminal-event guaranteed flush; (2) `yieldToMain()` inserts macrotask yields between `fetchInBatches` pulls and every ~25 upsert items; (3) `RepoPullService.pullFromSingleRepo` accepts an optional `CloneProgressCallback` so the pull phase renders in the same in-picker progress bar. Stores always refresh on a successful import (zero-count outcome logs a warning).

### Re-entrancy guard on floating-button collision (#floating-collision)

**fix(ui)** — `publishButtonRect` no longer overflows the JS stack when two FABs (AI button + stage push button) have overlapping rects. A `notifying` flag prevents publish-from-subscriber re-notification, and the collision listener reads the _published_ rect instead of the stale shared value so resolution converges.

### Push button missing on folder-backed updates

**fix(git)** — `LocalGitWriter.writeAndCommit` and `deleteAndCommit` now normalize leading slashes (`toRepoRelativePath()`) so folder-backed note/canvas/todo updates with `filePath = '/notes/foo.md'` produce a real local commit. Root-level notes (`notes/foo.md`) were never affected; this closes the gap.

### Daily Quote settings grouped, settings keyboard fixed

**fix(ui)** — extracted the three Daily Quote rows into their own **Daily Quote** group in Settings → Artificial Intelligence. Also: `ModelSelector`, `RenderStyleEditorScreen`, and `ChatScreen` get keyboard handling (`KeyboardAvoidingView`, `keyboardShouldPersistTaps="handled"`, `automaticallyAdjustKeyboardInsets`) so text inputs are no longer covered by the iOS keyboard.

### Thought Dump repo picker + distinct errors

**feat(thought-dump)** — Thought Dump now lets the user pick the destination repo and branch, persists the choice through `ThoughtDumpRepoPreferenceService` (`@gitnotes:thought_dump_repo`, with last-used/first-repo fallback), and surfaces four distinct save-time errors (`errorNotAuthenticated`, `errorNoRepo`, `errorInvalidRepo`, `errorWriteFailed`) instead of a single generic alert. Empty state distinguishes Connect account / No repository set up / No thought dumps yet.

### Clone-phase yield patch

**fix(clone)** — adds a macrotask yield every 256 objects inside pack index decoding, so a large-repo clone stays tappable during pack parsing. Also tightens 7 corruption-classifier sites to require `Could not find object` so a config error like `Could not find a fetch refspec for remote "origin"` no longer triggers a destructive `removeRepo` + re-clone.

## 2026-08-20

### iPad multi-column card collapse fix (#940, #941)

**fix(ui)** — `SwipeableListItem` root now has `{ width: '100%' }` as the first style entry, so on iPad's multi-column layouts (Todos ~90px, Notes grid ~263px in a ~330px column) the cards fill their column instead of collapsing to their content's intrinsic width. Single-column phone layouts are unaffected (`width: '100%'` matches the already-stretched item width).

## 2026-08-17

### Surface required GitHub token scopes in 403 messages

**fix(sync)** — `formatSyncError` separates rate-limit 403s from permission/scope 403s. Rate-limit still says "GitHub rate limit hit — try again in a few minutes" (must match first); a permission 403 now tells the user exactly which scopes they need (fine-grained `Contents: Read and write` with the repo selected, or a classic token with the `repo` scope). `extractGitHubReason` keeps GitHub's sanitized reason in the error message and scrubs bearer tokens defensively. Token-add UI spells out the same scopes in all six locales.

### Stage → Push UX overhaul

**fix(ux)** — single coordination point is the push button (not row locks). Removed all per-row lock UI (`useEntityLock` deleted). Push buttons keep their label and render no `ActivityIndicator`; they gray out during a push. Push progress flows through `githubActivity` with a determinate `ProgressBar` from `LocalGitWriter.push`'s `onProgress`. Push notifications fire under `PUSH_NOTIFICATION_ID = 'gitnotes-push-progress'` (start / progress / complete body-text updates, throttled to 1/sec, suppressed in foreground). `drainPushQueue()` runs immediately on explicit push (floating button long-press, Stage Push / Push-all) instead of waiting for the 3-min idle timer. Push session marker (`gitnotes-push-session`) lets `ForegroundSyncService.handleAppStateChange` resume a push on `AppState → active`. Deletes are staged not pinned — drop failures surface on the Stage screen's **Failed to delete** section, not on a row.

### Settings → Add Repository invisible primary button

**fix(ui)** — `Button`'s `variant="primary"` now fills `colors.primary` as the surface background with white text. The "Add" manual-repo button (and every other `variant="primary"` that overrode its text to white) was rendering as a blank white rectangle in light mode.

### "No repositories found" after adding a token

**fix(settings)** — `AccountsContext.addAccount` now calls `GitHubService.setToken(token, user)` after a successful connect (mirroring `setToken`/`switchToHost`), so the repo list and write preflight work immediately after adding an account. Earlier, only the "change token" path synced.

### Add-Repository row busy-state + re-entry guard (#936)

**fix(settings)** — tapping a GitHub repo row during a pending add no longer fires a second concurrent `addRepository`. `SettingsScreen.isAddingRepo` becomes `isAddingRepoPath: string | null`; both `handleSelectGithubRepo` and `handleAddManualRepo` short-circuit when `isAddingRepoPath !== null`. Picker rows show an inline `ActivityIndicator` while busy, dim non-tapped rows to `opacity: 0.5`, and the manual Add button mirrors the same busy indicator via its `trailingIcon`.
