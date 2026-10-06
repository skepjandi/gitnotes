/**
 * Bounded continuation helpers for AI chat streaming.
 *
 * Pure functions for the bounded multi-round continuation loop.
 * Import this module to test the actual production logic.
 */

import { MAX_TOOL_ROUNDS, TOOL_EXECUTION_TIMEOUT_MS } from '../../services/ai/config';
import type { ActionExecutorResult } from '../../services/ai/actionExecutor';

// ── Public types ────────────────────────────────────────────────────────────────

export interface ContinuationSignal {
  success: true;
  resultText?: string;
}

export interface ExecutedToolCalls {
  toolCallIds: Set<string>;
  toolCallKeys: Set<string>;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

export function makeToolCallKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

export function computeShouldContinue(params: {
  round: number;
  handledToolCount: number;
  pausedForConfirmation: boolean;
  continuationSignal: ContinuationSignal | null;
}): boolean {
  const { round, handledToolCount, pausedForConfirmation, continuationSignal } = params;
  return (
    handledToolCount > 0 &&
    !pausedForConfirmation &&
    continuationSignal != null &&
    round + 1 < MAX_TOOL_ROUNDS
  );
}

export function newExecutedToolCalls(): ExecutedToolCalls {
  return { toolCallIds: new Set<string>(), toolCallKeys: new Set<string>() };
}

/**
 * Wraps a tool-call promise with a timeout.  Settles within
 * TOOL_EXECUTION_TIMEOUT_MS; rejects with Error('TIMEOUT') on timeout.
 * The caller is responsible for result formatting and UI updates.
 */
export async function executeWithTimeout(
  toolPromise: Promise<ActionExecutorResult>,
): Promise<ActionExecutorResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      toolPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('TIMEOUT'));
        }, TOOL_EXECUTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
