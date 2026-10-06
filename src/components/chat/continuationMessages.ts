import type { ToolCallPart, ToolModelMessage, ToolResultPart, ModelMessage } from 'ai';
import type { ChatMessage } from '../../models/Chat';

function isValidToolIdentifier(toolCallId: string | undefined, toolName: string | undefined): asserts toolCallId is string {
  if (!toolCallId) throw new Error('toolCallId is required for tool-carrying messages');
  if (!toolName) throw new Error('toolName is required for tool-carrying messages');
}

function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function toContinuationMessages(messages: ChatMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const hasToolSignature = Boolean(msg.toolCallName || msg.toolCallResult);

      if (!hasToolSignature) {
        result.push({ role: 'assistant', content: msg.content });
        continue;
      }

      isValidToolIdentifier(msg.toolCallId, msg.toolCallName);

      const toolCallPart: ToolCallPart = {
        type: 'tool-call',
        toolCallId: msg.toolCallId!,
        toolName: msg.toolCallName!,
        input: msg.toolCallArgs ?? {},
      };

      if (!msg.toolCallResult) {
        result.push({ role: 'assistant', content: [toolCallPart] });
        continue;
      }

      const serializedResult = serializeToolResult(msg.toolCallResult);

      result.push({ role: 'assistant', content: [toolCallPart] });

      const toolResultPart: ToolResultPart = {
        type: 'tool-result',
        toolCallId: msg.toolCallId!,
        toolName: msg.toolCallName!,
        output: { type: 'text', value: serializedResult },
      };

      const toolMsg: ToolModelMessage = { role: 'tool', content: [toolResultPart] };
      result.push(toolMsg);
      continue;
    }
  }

  return result;
}
