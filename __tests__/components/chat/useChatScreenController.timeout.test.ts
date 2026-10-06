import type { ActionExecutorResult } from '../../../src/services/ai/actionExecutor';
import { executeToolCall } from '../../../src/services/ai/actionExecutor';
import { executeWithTimeout } from '../../../src/components/chat/continuationHelpers';
import { TOOL_EXECUTION_TIMEOUT_MS } from '../../../src/services/ai/config';
import { formatExecutorResult } from '../../../src/components/chat/chatScreenShared';

jest.mock('../../../src/services/ai/actionExecutor');

const mockExecuteToolCall = executeToolCall as jest.MockedFunction<typeof executeToolCall>;

describe('executeWithTimeout', () => {
  const toolName = 'search_notes';
  const args = { query: 'test' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('fast resolve', () => {
    it('resolves with tool result when tool completes quickly', async () => {
      const expected: ActionExecutorResult = {
        success: true,
        data: { matches: [] },
        requiresConfirmation: false,
      };
      mockExecuteToolCall.mockResolvedValueOnce(expected);

      const result = await executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      expect(result).toEqual(expected);
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall).toHaveBeenCalledWith(toolName, args, 'auto');
    });

    it('returns confirmation result when tool requires confirmation', async () => {
      const confirmResult: ActionExecutorResult = {
        success: true,
        requiresConfirmation: true,
        proposedChanges: {
          type: 'create_note',
          description: 'Create note: "Test"',
          details: {},
        },
      };
      mockExecuteToolCall.mockResolvedValueOnce(confirmResult);

      const result = await executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      expect(result).toEqual(confirmResult);
      expect(result.requiresConfirmation).toBe(true);
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });

    it('returns error result when tool fails', async () => {
      const errorResult: ActionExecutorResult = {
        success: false,
        error: 'Note not found',
        requiresConfirmation: false,
      };
      mockExecuteToolCall.mockResolvedValueOnce(errorResult);

      const result = await executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      expect(result).toEqual(errorResult);
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });

    it('timer is cleared immediately on fast resolve', async () => {
      const expected: ActionExecutorResult = {
        success: true,
        data: { matches: [] },
        requiresConfirmation: false,
      };
      mockExecuteToolCall.mockResolvedValueOnce(expected);

      await executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS * 10);

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout behavior', () => {
    it('rejects with TIMEOUT error when tool hangs beyond TOOL_EXECUTION_TIMEOUT_MS', async () => {
      const hangingPromise = new Promise<never>(() => { /* never resolves */ });
      mockExecuteToolCall.mockReturnValueOnce(hangingPromise);

      const resultPromise = executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS);
      await Promise.resolve();

      await expect(resultPromise).rejects.toThrow('TIMEOUT');
    });

    it('timer is cleared after timeout rejection', async () => {
      const hangingPromise = new Promise<never>(() => { /* never resolves */ });
      mockExecuteToolCall.mockReturnValueOnce(hangingPromise);

      const resultPromise = executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS);
      await Promise.resolve();

      try {
        await resultPromise;
      } catch {
        /* expected */
      }

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS * 10);

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });

    it('zero duplicate executor calls even after timeout fires', async () => {
      const hangingPromise = new Promise<never>(() => { /* never resolves */ });
      mockExecuteToolCall.mockReturnValueOnce(hangingPromise);

      const resultPromise = executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS);
      await Promise.resolve();

      try {
        await resultPromise;
      } catch {
        /* expected */
      }

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS * 10);

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });

    it('timeout rejection is catchable and returns compatible error structure', async () => {
      const hangingPromise = new Promise<never>(() => { /* never resolves */ });
      mockExecuteToolCall.mockReturnValueOnce(hangingPromise);

      const resultPromise = executeWithTimeout(executeToolCall(toolName, args, 'auto'));

      jest.advanceTimersByTime(TOOL_EXECUTION_TIMEOUT_MS);
      await Promise.resolve();

      let caughtError: unknown;
      try {
        await resultPromise;
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe('TIMEOUT');
    });

    it('result is compatible with formatExecutorResult for success case', async () => {
      const expected: ActionExecutorResult = {
        success: true,
        data: { matches: [] },
        requiresConfirmation: false,
      };
      mockExecuteToolCall.mockResolvedValueOnce(expected);

      const result = await executeWithTimeout(executeToolCall(toolName, args, 'auto'));
      const formatted = formatExecutorResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('matches');
    });

    it('error result is compatible with formatExecutorResult', async () => {
      const errorResult: ActionExecutorResult = {
        success: false,
        error: 'Note not found',
        requiresConfirmation: false,
      };
      mockExecuteToolCall.mockResolvedValueOnce(errorResult);

      const result = await executeWithTimeout(executeToolCall(toolName, args, 'auto'));
      const formatted = formatExecutorResult(result);

      expect(typeof formatted).toBe('string');
      expect(formatted).toBe('Note not found');
    });
  });
});
