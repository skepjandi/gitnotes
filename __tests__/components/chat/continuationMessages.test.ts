import type { ChatMessage } from '../../../src/models/Chat';
import { toContinuationMessages } from '../../../src/components/chat/continuationMessages';

const makeMsg = (partial: Partial<ChatMessage>): ChatMessage =>
  ({
    id: 'msg-1',
    role: 'user',
    content: '',
    timestamp: 0,
    ...partial,
  } as ChatMessage);

describe('toContinuationMessages', () => {
  it('converts a user message to UserModelMessage with string content', () => {
    const input = [makeMsg({ role: 'user', content: 'hello world' })];
    const result = toContinuationMessages(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: 'user' });
    const content = (result[0] as { content: string }).content;
    expect(content).toBe('hello world');
  });

  it('converts a plain assistant text message to AssistantModelMessage', () => {
    const input = [makeMsg({ role: 'assistant', content: 'Sure thing.' })];
    const result = toContinuationMessages(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: 'assistant' });
  });

  it('emits assistant tool-call followed by tool-result when result is present', () => {
    const input = [
      makeMsg({
        id: 'msg-2',
        role: 'assistant',
        content: '',
        toolCallId: 'tc-1',
        toolCallName: 'create_note',
        toolCallArgs: { title: 'Test', content: 'Body' },
        toolCallResult: '{"noteId":"n1","title":"Test"}',
      }),
    ];
    const result = toContinuationMessages(input);
    // Assistant message with ToolCallPart only
    const assistantMsg = result[0] as { role: 'assistant'; content: unknown };
    expect(assistantMsg.role).toBe('assistant');
    const parts = assistantMsg.content as unknown[];
    const toolCallPart = parts.find((p) => (p as { type?: string }).type === 'tool-call');
    expect(toolCallPart).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'create_note',
      input: { title: 'Test', content: 'Body' },
    });
    // Separate tool result message
    expect(result[1]).toMatchObject({ role: 'tool' });
    const toolResultMsg = result[1] as { role: 'tool'; content: unknown };
    const toolResultPart = (toolResultMsg.content as unknown[])[0] as { output: unknown };
    expect(toolResultPart.output).toMatchObject({
      type: 'text',
      value: '{"noteId":"n1","title":"Test"}',
    });
  });

  it('throws when toolCallName is missing on a tool-carrying assistant message', () => {
    const input = [
      makeMsg({
        role: 'assistant',
        toolCallId: 'tc-1',
        toolCallName: undefined,
        toolCallArgs: { title: 'Test' },
        toolCallResult: '{"ok":true}',
      }),
    ];
    expect(() => toContinuationMessages(input)).toThrow();
  });

  it('throws when toolCallId is missing on a tool-carrying assistant message', () => {
    const input = [
      makeMsg({
        role: 'assistant',
        toolCallId: undefined,
        toolCallName: 'create_note',
        toolCallArgs: { title: 'Test' },
      }),
    ];
    expect(() => toContinuationMessages(input)).toThrow();
  });

  it('passes through system messages unchanged', () => {
    const input = [makeMsg({ role: 'system', content: 'You are helpful.' })];
    const result = toContinuationMessages(input);
    expect(result[0]).toMatchObject({ role: 'system', content: 'You are helpful.' });
  });

  it('serialises tool result as JSON string when result is an object', () => {
    const input = [
      makeMsg({
        role: 'assistant',
        toolCallId: 'tc-2',
        toolCallName: 'find_notes',
        toolCallArgs: { query: 'test' },
        toolCallResult: { matches: [{ id: 'n1', title: 'Note 1' }], total: 1 },
      }),
    ];
    const result = toContinuationMessages(input);
    const toolResultMsg = result[1] as { role: 'tool'; content: unknown };
    const toolResultPart = (toolResultMsg.content as unknown[])[0] as { output: { type: string; value: string } };
    expect(toolResultPart.output.type).toBe('text');
    expect(() => JSON.parse(toolResultPart.output.value)).not.toThrow();
  });

  it('returns empty array for empty input', () => {
    expect(toContinuationMessages([])).toEqual([]);
  });
});
