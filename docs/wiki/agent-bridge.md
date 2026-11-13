# Coding Agents & Chat Runtime

GitNotēs chat has two backends behind one runtime:

| Backend | Runs where | Transcript storage |
|---------|-----------|--------------------|
| **Model** (`modelBackend`) | In the app via the Vercel AI SDK (Anthropic, OpenAI-compatible, Apple Intelligence, on-device Llama) | The user's GitHub chat repo (`ChatStorageService`) |
| **Agent** (`agentBackend`) | On the user's own computer: Claude Code, opencode, pi, Codex, Gemini CLI or any [ACP](https://agentclientprotocol.com) agent, reached through `gitnotes-bridge` | Device-local only (`LocalThreadStorage`) — tool output can contain host secrets, so it is never pushed to GitHub |

## Runtime

```
ChatScreen ─ useChatSession(threadId)
                │
           ChatSession   (one per thread, lives in a registry, survives unmount)
                │  run(): AsyncIterable<ChatEvent>
        ┌───────┴────────┐
   modelBackend      agentBackend ── AcpClient ── BridgeConnection ══ WebSocket ══ gitnotes-bridge ── stdio ── agent
```

- `src/services/chat/types.ts` — `ChatEvent`, `ChatBackend`, `PermissionRequest`, `ChatSessionState/Actions`.
- `src/services/chat/reducer.ts` — pure `applyChatEvent`; folds events into `ChatMessage[]`, touching only the tail/owning message.
- `src/services/chat/ChatSession.ts` — per-thread state machine `idle → running ⇄ awaiting-permission → idle | error`. Streams are never tied to a screen or to a global "active thread", so leaving a chat mid-turn keeps it running and two threads can stream at once.
- Permissions are one mechanism: a backend awaits `requestPermission(...)`; the UI renders a card. Agent permission requests (ACP `session/request_permission`) and model tool confirmations (`actionMode: 'confirm'`) use it identically.
- Prompts sent while a turn runs are queued on the session (`queuedPrompts`) and run oldest-first when the turn ends normally. `stop()` keeps the queue but never auto-sends it; a prompt whose turn fails before any output goes back to the head as `failed` (retry/cancel).
- A third backend, `demoBackend` (`backend: { type: 'demo' }`), replays scripted turns (thought, plan, read, edit with diff, an approval-gated command, streamed text) with no bridge. It is offered as "Explore with a demo agent" in the new-chat picker and is device-local like agent threads.
- Agents' `available_commands_update` populates `thread.backend.availableCommands`, which feeds the composer's slash-command palette.
- Persistence is serialised per thread (one promise chain), fixing the old GitHub 409 race between the first user-message save and the reply save.

## Bridge

`bridge/` is a standalone Node package (`gitnotes-bridge`), installed with `curl -fsSL https://raw.githubusercontent.com/skepjandi/gitnotes/main/bridge/install.sh | sh` (downloads the repo tarball, builds `bridge/` into `~/.gitnotes-bridge/app`, writes a launcher to `~/.local/bin`). It spawns ACP agents over stdio and exposes them on an authenticated WebSocket (wire format: `bridge/src/protocol.ts`).

Key properties:

- **Survives disconnects.** An agent process outlives its socket. The bridge keeps a replay ring buffer; the app re-attaches with `resume { connectionId, lastSeq }` and receives exactly the missed frames. Already-answered permission requests are not replayed.
- **Survives app death.** `thread.backend` stores `connectionId`, `lastSeq` and `pendingPromptId` in the same snapshot as the messages, so a cold-started app can `resume` a turn that finished while it was gone without duplicating text.
- **Secure by default.** Binds `127.0.0.1`, token auth (32 random bytes), failed-auth back-off, `cwd` containment to configured roots. Roots are a guard rail, **not a sandbox** — the agent's own permission prompts (relayed to the phone) and the token are the security boundary.
- **Any ACP agent.** Presets: `claude` (`@agentclientprotocol/claude-agent-acp`), `opencode` (`opencode acp`), `pi` (`pi-acp`), `codex` (`@agentclientprotocol/codex-acp`), `gemini` (`gemini --acp`); more via `~/.gitnotes-bridge/config.json`.
- **Request/response frames (bridge >= 0.2.0).** Besides the agent socket the bridge answers `fs-search` (`@` file mentions, gitignore-aware), `git` (status, diff, stage, unstage, commit; never push, never amend) and `ports` (listening TCP ports of the agent's process tree). They carry a client `reqId`, work on unbound sockets, validate `cwd` against the roots and are advertised in `ready.features`; an older bridge omits them and the app hides the matching UI (`unsupported`). Protocol version stays 1.
- **Open sessions (bridge >= 0.3.0).** `AgentConnection` records the ACP `sessionId` and `cwd` from the `session/new` response and `session/load` / `session/resume` requests it already forwards, and `list-sessions` answers `sessions-result` with a `BridgeSessionInfo` (`connectionId`, `agentId`, `agentName`, `cwd`, `sessionId`, `startedAt`, `headSeq`, `attached`) for every live connection. Advertised as the `sessions` feature (always present).

### Reaching the bridge from a phone

| Route | URL | Notes |
|-------|-----|-------|
| Tailscale | `tailscale serve --bg 7878` → `wss://<machine>.<tailnet>.ts.net` | Recommended. TLS, works on iOS and Android, no port forwarding. |
| Cloudflare Tunnel | `wss://<your-tunnel-host>` | Public endpoint; the token is the only gate. |
| LAN | `ws://192.168.x.y:7878` with `--host 0.0.0.0` | iOS only (ATS `NSAllowsLocalNetworking`). Android release builds block cleartext. |

## App side

- `src/stores/agentBridgeStore.ts` — paired bridges (AsyncStorage); tokens only in `expo-secure-store` (`bridgeSecrets.ts`).
- `src/services/agent/pairing.ts` — `gitnotes://agents/pair?url=…&token=…&name=…`; the app always shows a confirmation with the host before saving a pairing link.
- `src/services/agent/BridgeConnection.ts` — WebSocket, auth, heartbeat (20s ping / 10s pong timeout), backoff reconnect + `resume`.
- `src/services/agent/AcpClient.ts`, `acpMapper.ts` — JSON-RPC ACP client and `session/update → ChatEvent` mapping. Advertises no `fs`/`terminal` client capabilities; agents use their own tools on the host.
- `src/screens/AgentBridgesScreen.tsx` — manage bridges; new-chat picker lets users choose a model or an agent + workspace. `BridgeSetupGuide` (How it works + connection diagnostics) opens from here and from the picker.
- `src/services/agent/bridgeTools.ts` — `fs-search` / `git` / `ports` calls over one reused authenticated socket per bridge (`BridgeConnection.request`, 10 s timeout); features cached per bridge. `listSessions(bridgeId)` rejects `unsupported` when the bridge lacks the `sessions` feature.
- `src/components/agent/OpenSessionsList.tsx` — "Open sessions" per bridge on `AgentBridgesScreen` and "Continue an open session" in `NewChatPicker`. Rows with no `cwd`/`sessionId` yet are hidden; unsupported or unreachable bridges render nothing; other failures show a small inline error. Tapping calls `adoptAgentSession(bridge, session)` (`services/chat/threads.ts`), which returns the local thread already bound to `session.connectionId` or creates a device-local agent thread with `{ sessionId, connectionId, lastSeq: headSeq }` and a leading system note that earlier history is not shown, then opens `ChatScreen`.

## Agent chat capabilities

- **Config options.** ACP `configOptions` (model, reasoning effort, mode, custom) are parsed from `session/new|load`, kept live through `config_option_update`, changed with `session/set_config_option` (optimistic, rolled back on failure) and stored on `thread.backend.configOptions`. Agents without them fall back to legacy `modes`.
- **Elicitation.** The client advertises `elicitation: { form, url }`. `elicitation/create` becomes a `ElicitationRequest` (flat JSON Schema → fields: string, number, integer, boolean, enum, multi-enum) rendered inline as `ElicitationCard`; url mode shows the host and requires an explicit tap. Answers are `accept` / `decline` / `cancel`. The replay cursor is held while one is open, so a cold restart asks again.
- **Images.** Picked or captured images are copied to `documentDirectory/chat-images/<threadId>/` (`imageStorage.ts`, max 5 per message, 5 MB each), never embedded in the transcript JSON, and sent as ACP `image` blocks only when the agent advertises `promptCapabilities.image`. Otherwise they are dropped with a visible note.
- **Notes.** Attached notes, files, folders and repos are resolved to text (`contextContent.ts`, 64 KB per item, 256 KB total, explicit `[truncated]` marker) and sent as ACP `resource` blocks (`gitnotes://note/<path>`), or as plain text when the agent lacks `embeddedContext`.
- **Review.** `ReviewScreen` (route `ReviewScreen { bridgeId, cwd, path? }`) shows git status, per-file diffs, stage/unstage and commit through the bridge `git` frames. Mission control links to it from its Changes section.
- **Mission control.** Sections: needs you, subagents (tool calls named Task/Agent or carrying `subagent_type`), background (running `execute` tools with a live output tail), plan, changes, listening ports (polled every 5 s while visible), activity, status.
