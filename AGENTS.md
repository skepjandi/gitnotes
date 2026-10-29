# GitNotēs — Agent Rules

> Rules for AI coding agents working in this repository.

## Read the Wiki First

**Before touching any code, read the relevant wiki page(s).** The wiki (`docs/wiki/`) is the canonical reference for every service, store, hook, model, screen, context, and architectural pattern. If you need to understand how something works, the wiki has the answer.

- Changing a service? → read `docs/wiki/services.md`
- Modifying state? → read `docs/wiki/stores.md`
- Editing screens or navigation? → read `docs/wiki/screens.md`
- Touching sync or Git logic? → read `docs/wiki/sync-architecture.md`
- Working with notes? → read `docs/wiki/note-file-format.md`
- Anything involving the native Git module? → read `docs/wiki/git-engine.md`

If the wiki is wrong or missing, fix it first — then make your code change. See the wiki accuracy rule below.

## Worktrees (ALWAYS)

**All agent work — fixes, features, refactors, even small edits — must happen inside a git worktree. Never edit files in the main worktree's working tree directly.**

This repo runs **multiple concurrent agent sessions** on different branches and issues. The main worktree is a shared resource — all agents serve from it and commit against it. Editing it directly causes race conditions where one agent's uncommitted changes block or corrupt another's work. Use worktrees to isolate every session's changes.

### Workflow

```bash
# From the repo root (the main worktree):
git worktree add -b <type>/<scope>-<slug> .worktrees/<scope>-<slug> main
# e.g.  git worktree add -b fix/discard-placeholder .worktrees/fix-discard main

# Always create the worktree under .worktrees/ at the repo root — never in
# /tmp, the home directory, or anywhere outside the repo. .worktrees/ is
# gitignored so the symlink/node_modules and per-worktree state don't pollute git.

ln -sfn "$(pwd)/node_modules" .worktrees/<scope>-<slug>/node_modules
# node_modules is a 2.5 GB tree that is symlinked from main into the worktree
# so jest (which resolves from the worktree) works without a duplicate install.
```

### Rules

- **Never leave code in main.** The main working tree must always be clean — no uncommitted changes, no staged files, no dangling work. If your worktree branch is merged, remove the worktree immediately. A dirty main blocks other agents and causes race conditions.
- **One worktree per branch.** Never branch from another worktree's branch — always branch from `main` (or the upstream you're targeting). After `git fetch origin` in the main repo, base new worktrees on the updated `origin/main`.
- **Coordinate before touching shared files.** Before editing `conflictStore.ts`, `LocalGitWriter.ts`, or any file another agent's `git status` shows as modified in the main working tree, check `git worktree list` and `git status` in the other worktrees. If another session has uncommitted work on the same files, wait or scope your change to a different file.
- **Do not commit secrets / tokens / Metro debug output** — review `git diff` before committing. This applies whether you are in a worktree or not.
- **Clean up** with `git worktree remove <path>` when a branch is merged and the worktree is no longer needed. Branches are cheap to recreate.
- **Main must stay clean.** After merging (squash-merge or rebase+merge), immediately remove the source worktree and verify `git status` in main shows nothing uncommitted or unstaged. A polluted main blocks other agents and corrupts shared state.

## Testing

All tests must pass before pushing:

```bash
yarn ts:check       # TypeScript compilation
yarn jest           # Run all Jest tests
yarn eslint . --ext .ts,.tsx  # Linting
```

- **Never push failing tests.** CI runs the same suite.
- New service/hook/feature needs a test file in `__tests__/` mirroring the `src/` structure.
- Use `@testing-library/react-native` for component tests.
- Use `jest.mock()` for service dependencies, `Date.now()` mocking for cache tests.
- Run `yarn jest __tests__/specific-file.test.ts --no-coverage --forceExit` for targeted testing.
- Do not use screenshots or LLM visual inspection as test evidence. Verify behavior programmatically with unit, component, or integration tests where appropriate; leave manual feature testing to the user and state clearly what remains unverified in the PR.

## Self-Documenting Code

- Clear names, no comments explaining obvious behavior.
- Use TypeScript strict mode — no `any` without justification.
- Keep functions short and focused (single responsibility).
- Use the existing patterns in `src/services/` as reference.
- **Never keep deprecated code.** When a library/module deprecates an API (e.g., `FileSystem.deleteAsync`), migrate to the replacement immediately. Do not leave deprecated calls in the codebase — fix them as part of the same change that introduces them.
- **Zero tolerance for lint-blocking issues.** Before committing, verify `yarn eslint src --ext .ts,.tsx` reports **0 errors**. Agents must proactively eliminate these categories on every change:
  - `@typescript-eslint/no-unused-vars` — remove unused imports, variables, and function parameters; prefix intentionally unused parameters with `_`
  - `@typescript-eslint/no-empty-function` — replace empty function bodies with `/* noop */` comments (never leave `{}` or `async () => {}`)
  - `prefer-const` — change `let` to `const` when the variable is never reassigned
  - `no-useless-escape` — remove unnecessary escape characters in regex (`\[` → `[`, `\]` → `]`, `\-` → `-`, `\/` → `/`)
  - `no-empty` — never leave empty block statements; add a comment or remove the block

## Second-Order Thinking Before Every Change

**Never fix something without understanding its ripples.** Every change has downstream effects — on callers, consumers, stores, sync queues, other tabs, and future features. Fixes that solve one problem but create three others are net negatives.

Before making any change — bug fix, refactor, "small tweak", or feature — ask:

- **What does this code talk to?** Find upstream callers and downstream consumers. A change to a shared service or store affects every caller.
- **What does this code touch?** If you're modifying a sync service, note editor, Git engine, or queue — trace the full call chain. These are high-coupling areas where a naive fix causes cascade failures.
- **Am I treating the symptom or the cause?** If the bug keeps appearing, the "fix" may be masking a design problem. Dig deeper.
- **What breaks when this scales?** A quick workaround that works for 10 items but fails at 10,000 is not a fix — it's debt.
- **Is this change reversible?** If you can't easily undo this, think harder. Prefer incremental, reversible changes over big bangs.

If you're uncertain about the impact of a change — **stop and ask**. It is always better to spend 5 minutes understanding the system than 5 hours fixing a cascade of regressions.

## Git Discipline

- **Never commit or push directly on `main`.** All agent changes must be made on a dedicated branch and submitted through a pull request. This remains mandatory even for small fixes or when `main` is otherwise clean.
- Atomic commits with descriptive messages (imperative mood).
- No `node_modules/`, `.DS_Store`, `.env`, or build artifacts.
- Branch per feature, rebase before merging.
- Worktrees are required — see the "Worktrees (ALWAYS)" section above. The old note that said "create git worktrees inside `.worktrees/`" was too soft; the requirement is unconditional.
- `lint-staged` runs on pre-commit (ESLint + Prettier).

## Git Tab Branch Ownership

**Git → Branches.** The Explore tab (Git UI) is the sole authority for branch operations. No external UI (note editors, sync services, or other tabs) may trigger or control branch switches.

- **No external branch UI.** Branch selection exists only in the Explore screen. Do not add branch selectors to note editors, settings screens, or other non-Git UI surfaces.
- **Remote checkout via GitBranchCoordinator.** When checking out a remote tracking branch, `GitBranchCoordinator.checkout()` fetches the remote ref first if the local checkout fails with "ref not found", then retries. Do not implement separate fetch-and-retry logic elsewhere.
- **Queue isolation on checkout.** When `GitBranchCoordinator.checkout()` succeeds, it calls `pauseAllExcept(activeRepoId, activeBranch)` to isolate the sync queue. Do not bypass this by calling `NoteSyncQueueService` directly for branch operations.
- **Retained internal branch identity.** Every `QueueItem` stores `branch` as a required field. Do not allow mutations that strip or default this field.

## Sync Architecture (Git Services) — source of truth

GitNotēs uses **clone mode** exclusively: local git commits with write-through push.

- User changes are **committed locally** (local git commit via `CloneSyncService.save`) and pushed **immediately when online** (8s budget via `tryPushNow`). If offline, changes queue in `NoteSyncQueueService` (branch-aware AsyncStorage queue) and push when connectivity returns. If a conflict is detected (409/non-fast-forward), the user is blocked on `ConflictResolverScreen` with editor-first UX — no separate push step needed.
  Push is triggered by: foreground-active (AppState → active), online-transition (NetInfo), 3-minute idle timer (`ClonePushTriggers`), and OS background task (up to 50 files).
  - Issues #925, #926, #927, #938 resolved.

## Wiki documentation

There are two documentation surfaces, and they serve different purposes:

- **`CHANGELOG.md`** (repo root) — **single-PR fixes and narrow bug-fix entries**. Grouped by date descending, one section per entry: title, area (conventional-commit prefix), 2-4 line summary, PR reference. Default location for any new fix.
- **GitHub Wiki** ([skepjandi/gitnotes/wiki](https://github.com/skepjandi/gitnotes/wiki)) — **the public-facing main wiki**. Architecture, services, contributor guides, feature deep-dives, post-mortems, and multi-PR campaigns. A new wiki page is appropriate only when the change crosses architectural boundaries (new service, new major feature, cross-cutting refactor) or teaches something contributors need to understand the system.

Editing the wiki: write the page in `docs/wiki/<name>.md` (this repo, source-controlled), add it to `docs/wiki/index.md`, and open a PR. The CI sync workflow (`.github/workflows/sync-wiki.yml`) mirrors `docs/wiki/` → GitHub Wiki on every merge to `main`. Manual edits on `github.com/skepjandi/gitnotes/wiki` will be overwritten on the next sync.

Wiki documentation is part of the definition of done for **architecture-level changes only**. For all other understanding (how a service works, what a store does, how screens are wired), use the wiki — it is the canonical reference. Do not rely on memory or partial context.

**Wiki accuracy is a living concern.** If you find a wiki page that is wrong — a wrong file name, wrong function signature, wrong description, wrong import path, wrong deep link, wrong context provider nesting, or any factual inaccuracy — **fix it as part of your current work**. Do not leave the wrong information in place. Update the wiki page, open a PR, and let the CI sync workflow push the correction to the GitHub Wiki. This applies to every PR: fixing wiki inaccuracies is not optional or out-of-scope.

## Quote Content Policy

All quotes in `src/data/philosopher_quotes.json` (the Daily Quote dataset) MUST:

- Be **accurately attributed** to the correct author, with the **correct wording** — verify against a reliable source before adding or editing. Remove or correct any misattributed quote.
- Carry a **`source`** field naming the book/essay/letter/work the quote was told or written in (e.g. `"source": "Meditations"`). Quotes with unidentifiable origin must be removed.
- Be **free of religious/sectarian content** — no references to deities, scripture, prayer, afterlife dogma, or sectarian doctrine. The dataset stays secular. A quote by a religious-figure author (Buddha, Rumi, Lao Tzu, etc.) is allowed ONLY if the quote text itself is secular, and each such retention is a conscious, documented decision.
- Come from the **curated pool**: philosophers, essayists, scientists, and writers (classical + modern). Target dataset size ≈ 500 quotes.

Every new quote added to the dataset must pass the same checks: religious-keyword scan (case-insensitive over `text` + `author`: god, jesus, christ, allah, bible, quran, lord, pray, holy, divine, sin, faith, soul, heaven, religio, spirit) + manual author review + attribution/source verification.

## Data Safety

- **Never push secrets, API keys, or auth tokens.**
- `.env` is in `.gitignore` — use `.env.example` for templates.
- Check `git diff` before committing to ensure no sensitive data.
