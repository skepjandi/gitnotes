# GitNotēs Wiki

> Project knowledge base for contributors and AI agents. All pages are automatically synced to the [GitHub Wiki](https://github.com/skepjandi/gitnotes/wiki) on every merge to `main`.

## Pages

| Page | Description |
|------|-------------|
| [Setup](./setup.md) | Prerequisites, install, run, environment variables |
| [Architecture](./architecture.md) | Full tech stack, key modules, data flow, navigation |
| [Development Guide](./development-guide.md) | Dev commands, troubleshooting, contributing |
| [Services](./services.md) | Every service file with one-line purpose, grouped by domain |
| [Stores](./stores.md) | Every Zustand store with state shape and key actions |
| [Screens & Navigation](./screens.md) | All screens, navigation tree, deep link paths |
| [Hooks](./hooks.md) | Every custom hook catalogued with purpose |
| [Models](./models.md) | Every TypeScript model interface with key fields |
| [Contexts](./contexts.md) | Every React context with provider hierarchy |
| [Sync Architecture](./sync-architecture.md) | Clone sync deep-dive |
| [Git Engine](./git-engine.md) | Rust native Git module architecture and build process |
| [Coding Agents & Chat Runtime](./agent-bridge.md) | Chat session architecture, `gitnotes-bridge`, ACP agents (Claude Code, opencode, pi, …), reconnect/resume |
| [Paywall & Pro Tier](./paywall.md) | RevenueCat, StoreKit 2, entitlements, feature gates |
| [Note File Format](./note-file-format.md) | How notes are stored on disk — frontmatter, file format, DocumentIndex, wiki-links |

## Quick Start

```bash
yarn install
yarn start     # Metro bundler
yarn ios       # iOS
yarn android   # Android
```

## AI Agent Note

If you are an AI agent modifying code in this repository, read the [Architecture](./architecture.md) page before making significant changes. Any change to services, stores, screens, hooks, models, contexts, sync, or the Git engine must update the corresponding wiki page. See `AGENTS.md` for the full wiki-first rule.

## Documentation Philosophy

- **For contributors:** `docs/wiki/` is the source of truth; `CHANGELOG.md` records individual fixes.
- **For AI agents:** Every module, service, store, and model is documented here with precise names and paths.
- **Wiki sync:** Edit `docs/wiki/*.md` and open a PR. The CI workflow (`.github/workflows/sync-wiki.yml`) mirrors changes to the GitHub Wiki automatically.

## See Also

- [GitHub Wiki](https://github.com/skepjandi/gitnotes/wiki)
- [CHANGELOG.md](../../CHANGELOG.md)
- [AGENTS.md](../../AGENTS.md)
