# GitHub Credential Access Design

## Goal

Make GitHub repository discovery and credential management consistent when one GitHub account has a GitHub App installation, OAuth connection, and PAT simultaneously.

## Current Problems

- `GitHubHostService.listRepositories()` returns GitHub App `selectedRepositories` immediately and therefore hides repositories available through PAT or OAuth.
- OAuth credentials are stored separately but are not used for repository discovery.
- Settings shows OAuth and App controls, but PAT is implicit in the host row and App lacks an individual disconnect action.
- Existing credential removal APIs delete one credential locally, but the UI does not present all credential kinds as independent controls.

## Design

### Repository discovery

For a GitHub host, discovery queries every locally available credential:

1. GitHub App credentials contribute their stored `selectedRepositories`.
2. PAT credentials query GitHub's `/user/repos` endpoint with the PAT.
3. OAuth credentials query the same endpoint with the stored OAuth access token.

Results are merged by canonical `owner/repo` name and returned once per repository. When duplicate records exist, prefer the record with richer API metadata while preserving the host ID. This changes discovery only; per-repository credential resolution remains unchanged, including App repository-selection enforcement.

If one credential source fails while another succeeds, successful results remain available and the failure is represented only when no usable source returns repositories. App-only hosts continue to work from stored selection metadata.

### Credential management UI

GitHub credentials remain grouped under one account and host. The host section shows independent rows for each present credential:

- PAT: connected/added state and remove action.
- OAuth: connected state and disconnect action.
- GitHub App: installed state and disconnect action.
- SSH: existing control, unchanged.

Removing one credential clears only that credential and its native credential registrations. The account and host remain while at least one credential remains. Removing the final credential uses existing host cleanup behavior, including removal of the empty host/account row and affected repository cleanup.

Credential removal requires confirmation and refreshes account/credential state after completion. PAT removal is local-only because PAT revocation is managed by the user on GitHub. OAuth/App disconnects remove the local credential and existing native registrations; remote revocation is outside this change because App revocation has no current backend endpoint and OAuth revocation is not currently wired into the UI flow.

### State boundary

Expose credential presence through the existing `AccountStorage`/`AccountsContext` boundary rather than having Settings components interpret storage keys. The Settings screen may continue to load detailed records needed for App repository labels, but status rows should use a typed per-host credential summary.

## Testing

- Unit-test GitHub repository discovery with App + PAT, App + OAuth, and all-three combinations; verify union and deduplication.
- Unit-test partial credential-source failures and App-only discovery.
- Test credential summary state for PAT, OAuth, and App.
- Test removing one credential while preserving the host/account and remaining credentials.
- Test removing the last credential and preserving existing host/account cleanup behavior.
- Run focused tests, TypeScript, lint, formatting, and the full Jest suite.

## Out of Scope

- GitHub PAT revocation or SSH key revocation through GitHub APIs.
- Adding a new backend App-revocation endpoint.
- Changing native per-repository credential priority or App repository enforcement.
- Splitting one GitHub account into separate UI account rows per credential.
