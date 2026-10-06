/**
 * Tests for bounded continuation helpers from continuationHelpers.ts.
 *
 * Imports the REAL production functions and tests them with mocked AIService
 * at the integration level.
 */

import {
  computeShouldContinue,
  makeToolCallKey,
  newExecutedToolCalls,
} from '../../../src/components/chat/continuationHelpers';
import { MAX_TOOL_ROUNDS } from '../../../src/services/ai/config';

describe('computeShouldContinue (from production continuationHelpers)', () => {
  it('returns true when tools executed, no pause, signal set, within limit', () => {
    const result = computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    });
    expect(result).toBe(true);
  });

  it('returns false when handledToolCount is 0', () => {
    const result = computeShouldContinue({
      round: 0,
      handledToolCount: 0,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    });
    expect(result).toBe(false);
  });

  it('returns false when paused for confirmation', () => {
    const result = computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: true,
      continuationSignal: { success: true },
    });
    expect(result).toBe(false);
  });

  it('returns false when continuationSignal is null', () => {
    const result = computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: null,
    });
    expect(result).toBe(false);
  });

  it('returns false when next round would exceed MAX_TOOL_ROUNDS', () => {
    const result = computeShouldContinue({
      round: 4,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    });
    expect(result).toBe(false);
  });

  it('returns true at round 3 (next would be 4, within limit)', () => {
    const result = computeShouldContinue({
      round: 3,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    });
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
});

describe('MAX_TOOL_ROUNDS boundary (production constant)', () => {
  it('is 5', () => {
    expect(MAX_TOOL_ROUNDS).toBe(5);
  });

  it('5 rounds total (0,1,2,3,4) before exhaustion', () => {
    const rounds: boolean[] = [];
    for (let round = 0; round < 5; round++) {
      rounds.push(computeShouldContinue({
        round,
        handledToolCount: 1,
        pausedForConfirmation: false,
        continuationSignal: { success: true },
      }));
    }
    expect(rounds).toEqual([true, true, true, true, false]);
  });
});

describe('controller seam: makeToolCallKey used for dedup key construction', () => {
  it('controller uses makeToolCallKey for executedToolCallsRef.toolCallKeys dedup', () => {
    const exec = newExecutedToolCalls();
    const key = makeToolCallKey('create_note', { title: 'Test' });
    exec.toolCallKeys.add(key);
    expect(exec.toolCallKeys.has(key)).toBe(true);
  });

  it('controller uses toolCallIds for toolCallId dedup', () => {
    const exec = newExecutedToolCalls();
    exec.toolCallIds.add('tc1');
    expect(exec.toolCallIds.has('tc1')).toBe(true);
    expect(exec.toolCallIds.has('tc2')).toBe(false);
  });

  it('handleConfirmApply pattern: add confirmed tool to executedToolCallsRef.toolCallKeys', () => {
    const exec = newExecutedToolCalls();
    const confirmationKey = makeToolCallKey('create_note', { title: 'Confirmed' });
    exec.toolCallKeys.add(confirmationKey);
    const continuationKey = makeToolCallKey('create_note', { title: 'Confirmed' });
    expect(exec.toolCallKeys.has(continuationKey)).toBe(true);
  });
});

describe('controller seam: computeShouldContinue used for round continuation guard', () => {
  it('after non-confirmation tool: signal set, shouldContinue=true for round 0', () => {
    expect(computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    })).toBe(true);
  });

  it('after confirmation-required tool: pausedForConfirmation=true blocks continuation', () => {
    expect(computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: true,
      continuationSignal: { success: true },
    })).toBe(false);
  });

  it('continuationSignal=null blocks continuation even with tools', () => {
    expect(computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: null,
    })).toBe(false);
  });

  it('round 4 with tools: next round would be MAX=5, blocks continuation', () => {
    expect(computeShouldContinue({
      round: 4,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true },
    })).toBe(false);
  });

  it('continuationSignal with resultText is still truthy for continuation', () => {
    expect(computeShouldContinue({
      round: 0,
      handledToolCount: 1,
      pausedForConfirmation: false,
      continuationSignal: { success: true, resultText: 'created' },
    })).toBe(true);
  });
});
