# gitnotes-bridge

`gitnotes-bridge` is a small daemon that runs on your **development machine** and lets the
GitNotēs mobile app drive a local coding agent (Claude Code, OpenCode, Pi, Codex, Gemini CLI, or
any other [ACP](https://agentclientprotocol.com) agent) over an authenticated WebSocket.

The agent runs on your machine, the app is the remote control. If your phone sleeps, switches
network or the app is killed, the agent keeps working: the bridge keeps a replay log and the app
re-attaches with `resume` and catches up on everything it missed.

```
┌──────────────┐   wss:// (or ws:// on a trusted LAN)   ┌──────────────────┐   stdio/JSON-RPC   ┌────────────┐
│ GitNotēs app │ ──────────────────────────────────────► │  gitnotes-bridge │ ──────────────────► │ ACP agent  │
│   (phone)    │ ◄────────────────────────────────────── │  (your laptop)  │ ◄────────────────── │ (opencode) │
└──────────────┘        ACP messages + replay            └──────────────────┘                    └────────────┘
```

---

## Install

Requires **Node.js >= 20**, `curl` and `tar` (macOS and Linux).

```bash
curl -fsSL https://raw.githubusercontent.com/skepjandi/gitnotes/main/bridge/install.sh | sh
```

The script downloads this repository's `bridge/` directory, builds it with npm into `~/.gitnotes-bridge/app`, and writes a `gitnotes-bridge` launcher to `~/.local/bin` (add that to your `PATH` if the script says so). Re-running it upgrades in place. Read the script first if you prefer: [`install.sh`](install.sh).

| Variable | Default | Purpose |
|----------|---------|---------|
| `GITNOTES_BRIDGE_REF` | `main` | Branch, tag or commit to install |
| `GITNOTES_BRIDGE_REPO` | `skepjandi/gitnotes` | `owner/name` on GitHub |
| `GITNOTES_BRIDGE_HOME` | `~/.gitnotes-bridge/app` | Install directory |
| `GITNOTES_BRIDGE_BIN_DIR` | `~/.local/bin` | Launcher directory |
| `GITNOTES_BRIDGE_TARBALL_URL` | GitHub tarball | Full tarball URL (mirrors, testing) |

Uninstall: `rm -rf ~/.gitnotes-bridge/app ~/.local/bin/gitnotes-bridge`. Your token stays in `~/.gitnotes-bridge/config.json`; delete it to unpair every phone.

From a checkout instead: `cd bridge && npm install && node dist/cli.js`.

## Run

```bash
gitnotes-bridge                       # listens on 127.0.0.1:7878, root = current directory
gitnotes-bridge --root ~/code         # one or more workspace roots
gitnotes-bridge --host 0.0.0.0        # also reachable from the LAN
```

On start the bridge prints its listening address, the workspace roots, the agents it found (with
availability) and a **pairing link**:

```
gitnotes-bridge 0.2.0
  listening  ws://127.0.0.1:7878
  roots
    - /Users/you/code
  agents
    ✓ claude     Claude Code — npx -y @agentclientprotocol/claude-agent-acp
    ✓ opencode   OpenCode — opencode acp
    ✗ pi         Pi — npx -y pi-acp
  pairing link
    gitnotes://agents/pair?url=ws%3A%2F%2F127.0.0.1%3A7878&token=…&name=My-Laptop.local
```

The token appears **only** in that link. The bridge never logs it and never logs frame contents.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port <n>` | `7878` | TCP port to listen on. |
| `--host <addr>` | `127.0.0.1` | Address to bind. Use `0.0.0.0` to expose it on the LAN. |
| `--root <dir>` | current directory | Workspace root, repeatable. Agents may only open sessions inside these roots. |
| `--config <file>` | `~/.gitnotes-bridge/config.json` | Config file location. |
| `--public-url <url>` | derived from host/port | URL the phone should dial, e.g. `wss://host.tailnet.ts.net`. |
| `--tls-cert <file>` | – | TLS certificate, enables `wss://`. |
| `--tls-key <file>` | – | TLS private key, enables `wss://`. |
| `--token <token>` | generated once | Shared secret. Overrides the stored token. |
| `--max-connections <n>` | `8` | Maximum number of agents running at the same time. |
| `--idle-ttl-min <n>` | `720` | Minutes an unwatched, silent agent may live before it is killed. |

`SIGINT` / `SIGTERM` kill every agent and close the server.

## Configuration file

`~/.gitnotes-bridge/config.json` (directory `0700`, file `0600`):

```json
{
  "token": "…",
  "roots": ["/Users/you/code"],
  "agents": [
    {
      "id": "my-agent",
      "name": "My agent",
      "command": "my-acp",
      "args": ["--stdio"],
      "env": { "MY_AGENT_MODE": "acp" }
    }
  ]
}
```

* `token` – generated (32 random bytes, base64url) the first time the bridge starts and then reused.
* `roots` – default workspace roots, overridden by `--root`.
* `agents` – extra agents, or overrides of the built-in presets (matched by `id`).

The token is the **only** secret. Treat the config file like a private key.

## Pairing with the app

1. Start the bridge on your machine.
2. Copy the printed `gitnotes://agents/pair?…` link.
3. Open it on the phone (GitNotēs → Agents → Add bridge → paste, or scan the QR code the app shows).
4. The app stores the URL in its settings and the **token in the iOS Keychain / Android
   Keystore** – never in plain storage.

The link is a plain URL: `url` is the WebSocket URL, `token` the shared secret, `name` a label for
the bridge.

## Remote access

The phone cannot reach `127.0.0.1` on your laptop. Pick one of these recipes.

### Tailscale (recommended)

```bash
tailscale serve --bg 7878            # https://<machine>.<tailnet>.ts.net
gitnotes-bridge --public-url wss://<machine>.<tailnet>.ts.net
```

`tailscale serve` terminates TLS for you, so the phone only ever sees `wss://`. Nothing is exposed
to the public internet, and only devices in your tailnet can connect.

### Cloudflared

```bash
cloudflared tunnel --url ws://localhost:7878
gitnotes-bridge --public-url wss://<subdomain>.trycloudflare.com
```

The tunnel URL is public: anyone with the URL **and** the token can use the bridge. Rotate the
token (delete `token` from the config file and restart) if the URL leaks.

### Plain LAN (`ws://`)

```bash
gitnotes-bridge --host 0.0.0.0 --root ~/code
```

The pairing link then points at `ws://<lan-ip>:7878`.

> **Cleartext caveat (important).** `ws://` is unencrypted. It only works when the app allows
> cleartext traffic: on **iOS** that is possible for local networks, but on **Android release
> builds cleartext is blocked by default**, so a plain `ws://` bridge will not connect on Android
> at all. Prefer `wss://` (Tailscale serve or cloudflared). A `ws://` URL is only acceptable on a
> network you fully trust.

## Security model

* **The token is the security boundary.** Anyone who knows the token can drive the agents on your
  machine. It is 32 random bytes, compared with a constant-time digest comparison, and it is only
  ever printed inside the pairing link.
* **The bridge binds to `127.0.0.1` by default.** Exposing it (`--host 0.0.0.0`, a tunnel) is an
  explicit decision.
* **Five failed authentications from one IP block that IP for 60 seconds**, and the first frame of
  every socket must be a valid `auth` within 5 seconds.
* **The roots are a convenience guard, not a sandbox.** The bridge refuses ACP `session/new`,
  `session/load`, `session/resume` and `session/fork` requests whose `params.cwd` is not an
  absolute path inside one of the roots (symlinks are resolved first, so a symlink that points out
  of the root is rejected too). That stops a *mistyped* path from reaching the wrong project.
  It does **not** contain the agent: the agent can still run any command its own permission rules
  allow, read files, and write anywhere the bridge process can. Only the token protects you.
* Agent transcripts stay on the bridge host. The app stores agent threads device-locally and never
  pushes them to your notes repository.

## Protocol summary

One WebSocket carries JSON text frames. The wire format is defined in
[`src/protocol.ts`](src/protocol.ts) and is shared verbatim with the app.

**Client → bridge**

| Frame | Meaning |
| --- | --- |
| `{type:'auth', token, protocol:1}` | Must be the first frame. |
| `{type:'ping'}` | Answered with `{type:'pong'}`. |
| `{type:'list-workspaces'}` | Answers with `{type:'workspaces', items}`. |
| `{type:'connect', agent}` | Spawns an agent and binds this socket to it. |
| `{type:'resume', connectionId, lastSeq}` | Re-attaches to a running agent and replays frames. |
| `{type:'rpc', message}` | Forwards a JSON-RPC message to the agent. |
| `{type:'disconnect', kill?}` | Unbinds the socket; `kill:true` also stops the agent. |
| `{type:'fs-search', reqId, cwd, query, limit?}` | Fuzzy path search under `cwd`. Answers `fs-results`. Works on unbound sockets. |
| `{type:'git', reqId, cwd, op}` | `op.kind` is `status`, `diff`, `stage`, `unstage` or `commit`. Answers `git-result`. |
| `{type:'ports', reqId, connectionId}` | Listening TCP ports of the agent process tree. Answers `ports-result`. |

**Bridge → client**

| Frame | Meaning |
| --- | --- |
| `{type:'ready', protocol, bridgeVersion, hostname, agents, roots, features}` | Sent after a successful `auth`. `features` lists the optional capabilities available on this host. |
| `{type:'pong'}` | Answer to `ping`. |
| `{type:'workspaces', items}` | Roots plus their direct git children. |
| `{type:'connected', connectionId, agent, resumed, replayCount, headSeq}` | A connection is bound. `replayCount` frames follow immediately. |
| `{type:'rpc', seq, message}` | One JSON-RPC message from the agent. `seq` is the replay cursor. |
| `{type:'log', text}` | Agent stderr (at most 200 lines per connection). Never replayed. |
| `{type:'agent-exit', code, signal}` | The agent process ended. |
| `{type:'error', code, message}` | Something went wrong; see `BridgeErrorCode`. |
| `{type:'fs-results', reqId, items, truncated}` | Matches (`{path, isDir}`), best first. |
| `{type:'git-result', reqId, result}` | Result of a `git` op. |
| `{type:'ports-result', reqId, ports}` | Sorted, de-duplicated `{port, process?, pid?}`. |
| `{type:'request-error', reqId, code, message}` | One request failed (`bad-request`, `forbidden-cwd`, `not-a-repo`, `git-failed`, `unsupported`, `unknown-connection`); the socket stays open. |

**Optional features.** `ready.features` is computed once at startup and is additive (protocol stays
at version 1):

| Feature | Available when | Notes |
| --- | --- | --- |
| `fs-search` | always | Respects `.gitignore` in git repos (`git ls-files`); otherwise a bounded walk that skips `node_modules`, `.git`, `dist`, `build`. Default 50 results, max 200, 2 s budget. Symlinks are never followed. |
| `git` | `git --version` succeeds | Commands run without a shell, serialized per directory. Paths must be repository-relative (no `..`, absolute paths or leading `-`). Patches are cut at 200 KB (`truncated:true`). Commits never use `--amend` or `--no-verify`, and the bridge never pushes. |
| `ports` | `lsof` or `ss` is installed | Lists TCP LISTEN sockets owned by the agent process and its descendants. |

Every request frame carries a `reqId` that is echoed on the reply, and `cwd` must lie inside a
configured root (`forbidden-cwd` otherwise).

**Replay.** Every frame the bridge sends for a connection gets a `seq` (1, 2, 3 …). The bridge
keeps the last 5000 frames (and at most 32 MiB) in a ring buffer. `resume` with a `lastSeq`
replays exactly the frames after that cursor. If the cursor is older than the buffer, the bridge
answers `replay-gap` and the app has to start a new session (`connect` + ACP `session/load`).
Agent requests the client already answered (for example a permission prompt) are **not** replayed,
so you are never asked the same question twice.

**Survival.** A dropped socket only detaches; the agent keeps running. The connection is torn
down when the app asks for it (`disconnect` with `kill`), when the agent exits, or when nobody has
watched it and it has been silent for the idle TTL. After the agent exits, the connection and its
replay log are kept for 10 more minutes so a late `resume` still sees the last messages.

**Refused working directories.** When the bridge rejects a `session/*` request because of its
`cwd`, the client gets an `{type:'error', code:'forbidden-cwd'}` frame *and* a JSON-RPC error
response (`code -32602`) carrying the original request id. The agent never sees the request.

## Adding a custom ACP agent

Any program that speaks the Agent Client Protocol over stdio works. Add it to the config file:

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My agent",
      "command": "my-acp",
      "args": ["--stdio"],
      "env": { "MY_AGENT_MODE": "acp" }
    }
  ]
}
```

or override a built-in preset by using the same `id` (the `id` is what the app sends in
`connect`):

```json
{
  "agents": [
    { "id": "claude", "name": "Claude (local build)", "command": "/opt/claude/acp" }
  ]
}
```

Rules the bridge follows when it starts an agent:

* `shell: false` – the command and its arguments are executed directly, never through a shell.
* The working directory is the first root.
* The environment is the bridge's environment plus the `env` block from the config.
* stdout is parsed as NDJSON (one JSON object per line; partial lines and CRLF are tolerated).
  Anything that is not JSON is delivered as a `log` frame.
* stderr is delivered as `log` frames.
* stdin receives one JSON object per line.

The built-in presets are:

| id | Command | Availability check |
| --- | --- | --- |
| `claude` | `npx -y @agentclientprotocol/claude-agent-acp` | `claude` on `PATH` |
| `opencode` | `opencode acp` | `opencode` on `PATH` |
| `pi` | `npx -y pi-acp` | `pi` on `PATH` |
| `codex` | `npx -y @agentclientprotocol/codex-acp` | `codex` on `PATH` |
| `gemini` | `gemini --acp` | `gemini` on `PATH` |

## Development

```bash
cd bridge
npm install
npm run build      # tsc -> dist/
npm test           # build + node --test (unit and integration tests, loopback only)
npm run test:smoke # real `opencode acp` round trip, skipped when opencode is missing
```

The tests use a fake ACP agent (`test/fixtures/fake-agent.js`) and never touch the network beyond
loopback.
