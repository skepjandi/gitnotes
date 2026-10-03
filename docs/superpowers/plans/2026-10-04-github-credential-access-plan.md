# GitHub Credential Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine GitHub App, OAuth, and PAT repository discovery and expose independent credential status/removal controls under one GitHub account.

**Architecture:** Keep the existing shared `hostId` account model. Make `GitHubHostService.listRepositories()` collect repositories from every credential stored for that host and deduplicate by canonical full name. Add one credential-removal boundary in `AccountStorage`/`AuthService`, then render PAT, OAuth, and App rows from the existing Settings host state without changing native per-repository credential priority.

**Tech Stack:** React Native, TypeScript, Zustand/React context, AsyncStorage/SecureStore, Jest, ESLint, Prettier.

---

### Task 1: Add credential lifecycle primitives

**Files:**
- Modify: `src/services/AccountStorage.ts:266-364, 684-759`
- Modify: `src/services/AuthService.ts` credential methods and public types
- Modify: `src/contexts/AccountsContext.tsx:55-67, 330-430`
- Test: `__tests__/services/AuthService.credentials.test.ts`
- Create: `__tests__/services/AccountStorage.credentials.test.ts`

- [ ] **Step 1: Write failing storage tests**

Add tests that store PAT, OAuth, and App credentials under one host, remove exactly one kind, and assert the other records plus the host/account remain. Add a final-removal test that asserts the host and account are removed when no credential kind remains. Cover SSH as an existing credential kind so the final-removal check does not accidentally ignore it.

- [ ] **Step 2: Run the focused tests to verify failure**

Run:

```bash
yarn jest __tests__/services/AuthService.credentials.test.ts __tests__/services/AccountStorage.credentials.test.ts --no-coverage --runInBand
```

Expected: the new credential-removal API is missing or the assertions fail.

- [ ] **Step 3: Implement one typed removal boundary**

Add an `AccountStorage.removeCredential(hostId, kind)` method that:

```ts
type RemovableCredentialKind = 'token' | 'oauth' | 'github_app' | 'ssh';

// Delete only the selected credential, then remove the host connection only
// when no credential of any kind remains.
static async removeCredential(
  hostId: string,
  kind: RemovableCredentialKind,
): Promise<{ hostRemoved: boolean }>;
```

Use the existing per-kind delete helpers, check all four credential kinds after deletion, and delegate final host/account cleanup to `removeHostConnection(hostId)`. Do not revoke remote PATs or SSH keys. Add `AuthService.removeCredential()` as the context-facing wrapper, and update `AccountsContext`’s OAuth/App methods plus a new PAT method to call it before clearing native host credentials. Preserve the existing `disconnectHost()` behavior for removing the whole host.

- [ ] **Step 4: Run the focused tests to verify success**

Run the same Jest command from Step 2. Expected: all credential lifecycle tests pass.

- [ ] **Step 5: Commit the lifecycle unit**

```bash
GIT_MASTER=1 git add src/services/AccountStorage.ts src/services/AuthService.ts src/contexts/AccountsContext.tsx __tests__/services/AuthService.credentials.test.ts __tests__/services/AccountStorage.credentials.test.ts
GIT_MASTER=1 git commit -m "fix(auth): remove GitHub credentials independently"
```

### Task 2: Union GitHub repositories across credentials

**Files:**
- Modify: `src/services/git/GitHubHostService.ts:190-231`
- Test: `__tests__/services/git/gitHostRepositoryListing.test.ts`

- [ ] **Step 1: Write failing repository-union tests**

Extend the existing GitHub host repository listing tests with these cases:

```ts
it('merges App-selected, PAT, and OAuth repositories by full name', async () => {
  // App returns owner/app-repo; PAT returns owner/pat-repo + owner/shared;
  // OAuth returns owner/oauth-repo + owner/shared.
  // Expect four unique repositories and one API call per bearer credential.
});

it('keeps App-only discovery working without a token', async () => {
  // Expect selectedRepositories and no GitHubService token-list call.
});

it('keeps successful sources when one token source fails', async () => {
  // PAT rejects; OAuth still returns repositories; expect OAuth results.
});
```

Use the existing mocks for `AccountStorage` and `GitHubService`; assert returned `hostId` values and deduplication by `fullName`.

- [ ] **Step 2: Run the repository listing tests to verify failure**

```bash
yarn jest __tests__/services/git/gitHostRepositoryListing.test.ts --no-coverage --runInBand
```

Expected: the current App short-circuit returns only App-selected repositories and OAuth is never queried.

- [ ] **Step 3: Implement credential-source collection**

Replace the early App return in `GitHubHostService.listRepositories()` with source collection:

1. Map `selectedRepositories` to normalized `GitHostRepository` values.
2. Read the PAT with `AccountStorage.getHostToken(hostId)` and OAuth with `AccountStorage.getOAuthCredential(hostId)`.
3. Call `GitHubService.getRepositories({ tokenOverride })` once for each available bearer token. Do not call the same token twice if PAT and OAuth access tokens are identical.
4. Merge all successful records by `fullName`, preferring a record with non-null description, size, and privacy metadata.
5. Return an `unavailable` result only when no source produced a repository and at least one remote source failed; otherwise return successful union results.

Keep App-selected repository scope enforcement in `NativeCredentialBridge` untouched.

- [ ] **Step 4: Run the repository listing tests to verify success**

Run the command from Step 2. Expected: all repository-union cases pass.

- [ ] **Step 5: Commit the discovery unit**

```bash
GIT_MASTER=1 git add src/services/git/GitHubHostService.ts __tests__/services/git/gitHostRepositoryListing.test.ts
GIT_MASTER=1 git commit -m "fix(git): merge GitHub credential repository access"
```

### Task 3: Render independent credential status rows

**Files:**
- Modify: `src/components/settings/SettingsContent.tsx:72-179, 590-850`
- Modify: `src/screens/SettingsScreen.tsx:190-271, 1014-1235`
- Modify: `src/components/settings/settingsStyles.ts` only if the existing row styles cannot support the credential rows
- Test: `__tests__/components/settings/SettingsContent.connectHost.test.tsx`
- Test: `__tests__/screens/SettingsScreen.hostIdentity.test.tsx` or a new focused Settings credential test

- [ ] **Step 1: Write failing UI tests**

Add tests that render one GitHub host with `hostCredentialKinds[hostId]` set to `['token', 'oauth', 'github_app']` and assert:

- PAT, OAuth, and GitHub App status labels are visible.
- Each row exposes its own remove/disconnect action and test ID.
- Triggering a PAT action calls the new PAT callback with the host ID.
- Triggering OAuth/App actions calls their existing callbacks without calling the whole-host disconnect callback.

Add a second test with only PAT remaining and verify removing it uses the same final-host cleanup path.

- [ ] **Step 2: Run the UI tests to verify failure**

```bash
yarn jest __tests__/components/settings/SettingsContent.connectHost.test.tsx __tests__/screens/SettingsScreen.hostIdentity.test.tsx --no-coverage --runInBand
```

Expected: PAT status/action elements and the new callback prop do not exist.

- [ ] **Step 3: Add the PAT callback and credential rows**

Extend `SettingsContentProps` with `onDisconnectToken(hostId: string)`, then render a GitHub-only credential list under each host. Use the existing `hostCredentialKinds` state as the source of presence, retain the existing OAuth/App loading/error state, and keep SSH unchanged. Use stable test IDs such as:

```text
settings.credential.token.<hostId>
settings.credential.oauth.<hostId>
settings.credential.github-app.<hostId>
```

The existing whole-host disconnect control remains separate and continues to warn about repository removal.

- [ ] **Step 4: Wire SettingsScreen removal handlers**

Add `handleDisconnectToken(hostId)` beside the existing OAuth/App handlers. Each individual handler should:

1. Confirm the selected credential removal.
2. Call the corresponding `useAuth()` method.
3. Refresh account summaries and credential-kind state through the existing context refresh path.
4. Remove affected repositories only when the removal reports `hostRemoved: true`.

Pass the new handler into `SettingsContent`. Keep whole-host disconnect and whole-account removal unchanged.

- [ ] **Step 5: Run the UI tests to verify success**

Run the command from Step 2. Expected: status rows and individual callback assertions pass.

- [ ] **Step 6: Commit the UI unit**

```bash
GIT_MASTER=1 git add src/components/settings/SettingsContent.tsx src/screens/SettingsScreen.tsx src/components/settings/settingsStyles.ts __tests__/components/settings/SettingsContent.connectHost.test.tsx __tests__/screens/SettingsScreen.hostIdentity.test.tsx
GIT_MASTER=1 git commit -m "feat(settings): manage GitHub credentials independently"
```

### Task 4: Update documentation and run verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/wiki/services.md` only if the current credential lifecycle description is inaccurate after implementation
- Modify: `docs/wiki/sync-architecture.md` only if repository discovery semantics need documenting

- [ ] **Step 1: Add the changelog entry**

Add a dated `fix(auth)` entry describing that GitHub App, OAuth, and PAT repository access is merged and each credential can be removed independently without deleting the account until the final credential is gone.

- [ ] **Step 2: Run focused verification**

```bash
yarn jest __tests__/services/git/gitHostRepositoryListing.test.ts __tests__/services/AuthService.credentials.test.ts __tests__/components/settings/SettingsContent.connectHost.test.tsx --no-coverage --runInBand
yarn ts:check
yarn eslint src/services/AccountStorage.ts src/services/AuthService.ts src/contexts/AccountsContext.tsx src/services/git/GitHubHostService.ts src/components/settings/SettingsContent.tsx src/screens/SettingsScreen.tsx __tests__/services/git/gitHostRepositoryListing.test.ts __tests__/services/AuthService.credentials.test.ts __tests__/services/AccountStorage.credentials.test.ts __tests__/components/settings/SettingsContent.connectHost.test.tsx
yarn prettier --check CHANGELOG.md docs/wiki/services.md docs/wiki/sync-architecture.md docs/superpowers/specs/2026-10-04-github-credential-access-design.md docs/superpowers/plans/2026-10-04-github-credential-access-plan.md
```

Expected: focused tests pass, TypeScript exits 0, ESLint reports 0 errors, and Prettier reports all files formatted.

- [ ] **Step 3: Run the full suite and inspect the final diff**

```bash
yarn jest --no-coverage --runInBand --forceExit
GIT_MASTER=1 git diff --check main...HEAD
GIT_MASTER=1 git status --short --branch
```

Expected: the full Jest suite passes, `git diff --check` is clean, and only intended source/tests/docs files are changed.

- [ ] **Step 4: Commit documentation and final verification artifacts**

```bash
GIT_MASTER=1 git add CHANGELOG.md docs/wiki/services.md docs/wiki/sync-architecture.md
GIT_MASTER=1 git commit -m "docs: record GitHub credential access behavior"
```

Omit wiki files from the command when the implementation does not change their factual content.

## Plan Self-Review

- Spec coverage: repository union, partial failures, credential status rows, individual removal, last-credential cleanup, tests, and out-of-scope revocation are covered by Tasks 1–4.
- Placeholder scan: no unresolved TODO/TBD steps; every implementation step names files, APIs, commands, and expected results.
- Type consistency: `removeCredential(hostId, kind)` returns `{ hostRemoved: boolean }` from storage through AuthService/AccountsContext to SettingsScreen; repository discovery continues using `GitHubService.getRepositories({ tokenOverride })`.
- Scope: no backend changes, native credential-priority changes, or separate account model are introduced.
