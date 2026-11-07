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
- Persistence is serialised per thread (one promise chain), fixing the old GitHub 409 race between the first user-message save and the reply save.

## Bridge

`bridge/` is a standalone Node package (`gitnotes-bridge`), installed with `curl -fsSL https://raw.githubusercontent.com/skepjandi/gitnotes/main/bridge/install.sh | sh` (downloads the repo tarball, builds `bridge/` into `~/.gitnotes-bridge/app`, writes a launcher to `~/.local/bin`). It spawns ACP agents over stdio and exposes them on an authenticated WebSocket (wire format: `bridge/src/protocol.ts`).

Key properties:

- **Survives disconnects.** An agent process outlives its socket. The bridge keeps a replay ring buffer; the app re-attaches with `resume { connectionId, lastSeq }` and receives exactly the missed frames. Already-answered permission requests are not replayed.
- **Survives app death.** `thread.backend` stores `connectionId`, `lastSeq` and `pendingPromptId` in the same snapshot as the messages, so a cold-started app can `resume` a turn that finished while it was gone without duplicating text.
- **Secure by default.** Binds `127.0.0.1`, token auth (32 random bytes), failed-auth back-off, `cwd` containment to configured roots. Roots are a guard rail, **not a sandbox** — the agent's own permission prompts (relayed to the phone) and the token are the security boundary.
- **Any ACP agent.** Presets: `claude` (`@agentclientprotocol/claude-agent-acp`), `opencode` (`opencode acp`), `pi` (`pi-acp`), `codex` (`@agentclientprotocol/codex-acp`), `gemini` (`gemini --acp`); more via `~/.gitnotes-bridge/config.json`.

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
- `src/screens/AgentBridgesScreen.tsx` — manage bridges; new-chat picker lets users choose a model or an agent + workspace.
