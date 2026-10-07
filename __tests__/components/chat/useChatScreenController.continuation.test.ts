/**
 * Tests for bounded continuation helpers and chat screen shared utilities.
 *
 * Tests the pure functions and parsers that drive the bounded continuation loop.
 */

import { parseToolEvent, decodeOverEscapedChunk, parseToolArgs } from '../../../src/components/chat/chatScreenShared';
import {
  computeShouldContinue,
  makeToolCallKey,
  newExecutedToolCalls,
} from '../../../src/components/chat/continuationHelpers';
import { MAX_TOOL_ROUNDS } from '../../../src/services/ai/config';

describe('parseToolEvent', () => {
  it('recognizes tool-call-streaming-start', () => {
    const event = parseToolEvent(JSON.stringify({ type: 'tool-call-streaming-start', toolCallId: 'tc1', toolName: 'create_note' }));
    expect(event?.type).toBe('tool-call-streaming-start');
    expect(event?.toolCallId).toBe('tc1');
    expect(event?.toolName).toBe('create_note');
  });

  it('recognizes tool-result', () => {
    const event = parseToolEvent(JSON.stringify({ type: 'tool-result', toolCallId: 'tc1', toolName: 'create_note', result: '{"title":"Test"}' }));
    expect(event?.type).toBe('tool-result');
    expect(event?.result).toBe('{"title":"Test"}');
  });

  it('recognizes tool-call-delta', () => {
    const event = parseToolEvent(JSON.stringify({ type: 'tool-call-delta', toolCallId: 'tc1', argsTextDelta: 'hello' }));
    expect(event?.type).toBe('tool-call-delta');
    expect(event?.argsTextDelta).toBe('hello');
  });

  it('recognizes tool-call', () => {
    const event = parseToolEvent(JSON.stringify({ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_note', input: { title: 'Test' } }));
    expect(event?.type).toBe('tool-call');
    expect(event?.input).toEqual({ title: 'Test' });
  });

  it('returns null for text chunks', () => {
    expect(parseToolEvent('Hello world')).toBeNull();
    expect(parseToolEvent('  { "type": "text-delta" }')).toBeNull();
  });

  it('returns null for unrecognized event types', () => {
    expect(parseToolEvent(JSON.stringify({ type: 'text-delta', textDelta: 'hi' }))).toBeNull();
    expect(parseToolEvent(JSON.stringify({ type: 'unknown', data: 123 }))).toBeNull();
  });
});

describe('decodeOverEscapedChunk', () => {
  it('passes plain text through unchanged', () => {
    expect(decodeOverEscapedChunk('Hello world')).toBe('Hello world');
    expect(decodeOverEscapedChunk('Line1\nLine2')).toBe('Line1\nLine2');
  });

  it('decodes over-escaped JSON strings', () => {
    expect(decodeOverEscapedChunk('"Hello\\nWorld"')).toBe('Hello\nWorld');
    expect(decodeOverEscapedChunk('"Tab\\there"')).toBe('Tab\there');
  });

  it('returns original chunk for non-string JSON', () => {
    const chunk = JSON.stringify({ type: 'text-delta', textDelta: 'hi' });
    expect(decodeOverEscapedChunk(chunk)).toBe(chunk);
  });
});

describe('parseToolArgs', () => {
  it('returns record input as-is', () => {
    expect(parseToolArgs({ title: 'Test', body: 'Hello' })).toEqual({ title: 'Test', body: 'Hello' });
  });

  it('parses JSON string fallback', () => {
    expect(parseToolArgs(undefined, '{"title":"Test"}')).toEqual({ title: 'Test' });
  });

  it('returns empty object for invalid fallback', () => {
    expect(parseToolArgs(undefined, 'not json')).toEqual({});
    expect(parseToolArgs(undefined, '')).toEqual({});
  });
});

describe('computeShouldContinue (from production continuationHelpers)', () => {
  it('returns true when tools executed, no pause, signal set, within limit', () => {
    const result = computeShouldContinue({ round: 0, handledToolCount: 1, pausedForConfirmation: false, continuationSignal: { success: true } });
    expect(result).toBe(true);
  });

  it('returns false when handledToolCount is 0', () => {
    const result = computeShouldContinue({ round: 0, handledToolCount: 0, pausedForConfirmation: false, continuationSignal: { success: true } });
    expect(result).toBe(false);
  });

  it('returns false when paused for confirmation', () => {
    const result = computeShouldContinue({ round: 0, handledToolCount: 1, pausedForConfirmation: true, continuationSignal: { success: true } });
    expect(result).toBe(false);
  });

  it('returns false when continuationSignal is null', () => {
    const result = computeShouldContinue({ round: 0, handledToolCount: 1, pausedForConfirmation: false, continuationSignal: null });
    expect(result).toBe(false);
  });

  it('returns false when next round would exceed MAX_TOOL_ROUNDS', () => {
    const result = computeShouldContinue({ round: 4, handledToolCount: 1, pausedForConfirmation: false, continuationSignal: { success: true } });
    expect(result).toBe(false);
  });

  it('returns true at round 3 (next would be 4, within limit)', () => {
    const result = computeShouldContinue({ round: 3, handledToolCount: 1, pausedForConfirmation: false, continuationSignal: { success: true } });
    expect(result).toBe(true);
  });
});

describe('makeToolCallKey (from production continuationHelpers)', () => {
  it('produces distinct keys for different tool names', () => {
    const key1 = makeToolCallKey('create_note', { title: 'Test' });
    const key2 = makeToolCallKey('search_notes', { title: 'Test' });
    expect(key1).not.toBe(key2);
  });

  it('produces distinct keys for different args', () => {
    const key1 = makeToolCallKey('create_note', { title: 'A' });
    const key2 = makeToolCallKey('create_note', { title: 'B' });
    expect(key1).not.toBe(key2);
  });

  it('produces same key for same tool and args', () => {
    const key1 = makeToolCallKey('create_note', { title: 'Test', body: 'Hello' });
    const key2 = makeToolCallKey('create_note', { title: 'Test', body: 'Hello' });
    expect(key1).toBe(key2);
  });
});

describe('newExecutedToolCalls (from production continuationHelpers)', () => {
  it('returns empty toolCallIds and toolCallKeys sets', () => {
    const result = newExecutedToolCalls();
    expect(result.toolCallIds.size).toBe(0);
    expect(result.toolCallKeys.size).toBe(0);
  });

  it('detects duplicate toolCallKey across rounds', () => {
    const exec = newExecutedToolCalls();
    const key = makeToolCallKey('create_note', { title: 'Test' });
    exec.toolCallKeys.add(key);
    expect(exec.toolCallKeys.has(key)).toBe(true);
    expect(exec.toolCallKeys.has(makeToolCallKey('create_note', { title: 'Test' }))).toBe(true);
  });

  it('different args produces different key', () => {
    const exec = newExecutedToolCalls();
    exec.toolCallKeys.add(makeToolCallKey('create_note', { title: 'A' }));
    expect(exec.toolCallKeys.has(makeToolCallKey('create_note', { title: 'B' }))).toBe(false);
  });

  it('each call returns independent objects (regression: refs must not share state)', () => {
    // The streaming-session reset assigns newExecutedToolCalls() to executedToolCallIdsRef
    // and executedToolCallsRef independently. If they shared the same object, stale IDs or
    // keys from one session would leak into the next, causing valid tool calls to be
    // skipped or deduplicated incorrectly.
    const exec1 = newExecutedToolCalls();
    const exec2 = newExecutedToolCalls();
    const key = makeToolCallKey('create_note', { title: 'Test' });
    exec1.toolCallKeys.add(key);
    exec2.toolCallIds.add('tc1');
    expect(exec1.toolCallKeys.has(key)).toBe(true);
    expect(exec2.toolCallKeys.has(key)).toBe(false); // exec2 should not see exec1's key
    expect(exec1.toolCallIds.has('tc1')).toBe(false); // exec1 should not see exec2's ID
    expect(exec2.toolCallIds.has('tc1')).toBe(true);
  });
});

describe('MAX_TOOL_ROUNDS boundary (production constant)', () => {
  it('is 5', () => {
    expect(MAX_TOOL_ROUNDS).toBe(5);
  });

  it('5 rounds total (0,1,2,3,4) before exhaustion', () => {
    const rounds: boolean[] = [];
    for (let round = 0; round < 5; round++) {
      rounds.push(computeShouldContinue({ round, handledToolCount: 1, pausedForConfirmation: false, continuationSignal: { success: true } }));
    }
    expect(rounds).toEqual([true, true, true, true, false]);
  });
});

describe('continuation end-to-end scenario', () => {
  it('tool call increments handledToolCount and sets continuationSignal', () => {
    const signal = { current: null as { success: true; resultText?: string } | null };
    const exec = newExecutedToolCalls();
    const key = makeToolCallKey('create_note', { title: 'Test' });
    exec.toolCallKeys.add(key);
    const handledToolCount = 1;
    signal.current = { success: true };
    expect(exec.toolCallKeys.has(key)).toBe(true);
    expect(computeShouldContinue({ round: 0, handledToolCount, pausedForConfirmation: false, continuationSignal: signal.current })).toBe(true);
  });

  it('confirmation-required tool sets pausedForConfirmation and skips continuation', () => {
    const handledToolCount = 1;
    const pausedForConfirmation = true;
    const continuationSignal = { success: true };
    expect(computeShouldContinue({ round: 0, handledToolCount, pausedForConfirmation, continuationSignal })).toBe(false);
  });

  it('same (toolName, args) deduplication key prevents re-execution', () => {
    const exec = newExecutedToolCalls();
    const key1 = makeToolCallKey('create_note', { title: 'Test' });
    exec.toolCallKeys.add(key1);
    const key2 = makeToolCallKey('create_note', { title: 'Test' });
    expect(exec.toolCallKeys.has(key2)).toBe(true);
  });

  it('same toolName different args does NOT deduplicate', () => {
    const exec = newExecutedToolCalls();
    exec.toolCallKeys.add(makeToolCallKey('create_note', { title: 'A' }));
    expect(exec.toolCallKeys.has(makeToolCallKey('create_note', { title: 'B' }))).toBe(false);
  });

  it('after confirmation Apply, toolCallKey in executed set prevents re-execution', () => {
    const exec = newExecutedToolCalls();
    const confirmationKey = makeToolCallKey('create_note', { title: 'Test' });
    exec.toolCallKeys.add(confirmationKey);
    const continuationKey = makeToolCallKey('create_note', { title: 'Test' });
    expect(exec.toolCallKeys.has(continuationKey)).toBe(true);
  });
});
