/**
 * Tunables for AI chat / context handling.
 *
 * Keep all magic numbers and limits here so they can be tuned in one
 * place and surfaced for OSS contributors.
 */

/** Maximum bytes pulled from a single GitHub file when building context. */
export const MAX_CONTEXT_FILE_BYTES = 50 * 1024;

/** Maximum total bytes packed into the context section of the system prompt. */
export const MAX_CONTEXT_TOTAL_BYTES = 100 * 1024;

/**
 * How many times to retry a GitHub PUT/DELETE on 409/422 sha conflicts.
 *
 * Bumped from 3 → 6: writing chat threads concurrently from two app
 * sessions (e.g. iPad + phone) races on `chats/index.json` — each save
 * refreshes the sha and PUTs again, but with only 3 attempts a slow
 * session would still surface a user-facing 409 instead of converging.
 */
export const GITHUB_WRITE_RETRIES = 6;

/** Approximate bytes per token for byte→token estimation (English heuristic). */
export const BYTES_PER_TOKEN = 4;

/** Streaming text deltas are flushed to the UI at most this often. */
export const STREAM_RENDER_FLUSH_MS = 80;

/** Default chat-storage branch when the user has not picked one. */
export const DEFAULT_CHAT_BRANCH = 'main';

/**
 * Maximum number of tool-call round-trips permitted in a single
 * `streamChatResponse` continuation before the controller aborts.
 * Caps runaway loops when the model repeatedly calls the same tool.
 */
export const MAX_TOOL_ROUNDS = 5;

/**
 * Milliseconds to wait for a tool `execute` function to resolve before
 * treating it as timed out. Exposed here so the controller can apply the
 * same deadline to any SDK-level continuation retry.
 */
export const TOOL_EXECUTION_TIMEOUT_MS = 30_000;
