import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { ToolCallCard } from '@/components/chat/ToolCallCard';
import { MAX_DIFF_LINES, MAX_TOOL_TEXT_CHARS } from '@/components/chat/toolPresentation';
import type { ChatMessage, ToolStatus } from '@/models/Chat';

function toolMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'tool-1',
    role: 'assistant',
    kind: 'tool',
    content: '',
    timestamp: 1,
    toolCallId: 'call-1',
    toolCallName: 'bash',
    toolTitle: 'Run npm test',
    toolKind: 'execute',
    ...overrides,
  };
}

describe('ToolCallCard', () => {
  beforeEach(() => mockNavigate.mockClear());

  it.each<[ToolStatus, string]>([
    ['pending', 'Pending'],
    ['awaiting-approval', 'Needs approval'],
    ['running', 'Running'],
    ['completed', 'Done'],
    ['failed', 'Failed'],
    ['rejected', 'Rejected'],
  ])('renders the %s status badge', (status, label) => {
    const { getByTestId } = render(<ToolCallCard message={toolMessage({ toolStatus: status })} />);

    expect(getByTestId(`chat-tool.status.${status}`).props.accessibilityLabel).toBe(label);
  });

  it('uses the agent title, falling back to the humanised tool name', () => {
    const titled = render(<ToolCallCard message={toolMessage()} />);
    expect(titled.getByTestId('chat-tool.title').props.children).toBe('npm test');
    titled.unmount();

    const legacy = render(
      <ToolCallCard message={toolMessage({ toolTitle: undefined, toolKind: undefined, toolCallName: 'create_note' })} />,
    );
    expect(legacy.getByTestId('chat-tool.title').props.children).toBe('Create Note');
  });

  it('shows a running legacy tool as running while streaming and completed once it has a result', () => {
    const legacy = toolMessage({ toolStatus: undefined });
    const running = render(<ToolCallCard message={legacy} isStreaming />);
    expect(running.getByTestId('chat-tool.status.running')).toBeTruthy();
    running.unmount();

    const done = render(<ToolCallCard message={{ ...legacy, toolCallResult: 'ok' }} isStreaming />);
    expect(done.getByTestId('chat-tool.status.completed')).toBeTruthy();
  });

  it('keeps details collapsed until the header is pressed', () => {
    const message = toolMessage({
      toolStatus: 'completed',
      toolCallArgs: { command: 'npm test' },
      toolCallResult: 'all green',
    });
    const { getByTestId, queryByTestId } = render(<ToolCallCard message={message} />);

    expect(queryByTestId('chat-tool.args')).toBeNull();
    expect(queryByTestId('chat-tool.result')).toBeNull();

    fireEvent.press(getByTestId('chat-tool.button.toggle'));

    expect(getByTestId('chat-tool.args').props.children).toContain('"command": "npm test"');
    expect(getByTestId('chat-tool.result').props.children).toBe('all green');
  });

  it('is not expandable when there is nothing to show', () => {
    const { getByTestId } = render(<ToolCallCard message={toolMessage({ toolStatus: 'running' })} />);
    expect(getByTestId('chat-tool.button.toggle').props.accessibilityState.disabled).toBe(true);
  });

  it('truncates a long result and reveals everything on "show all"', () => {
    const longResult = 'x'.repeat(MAX_TOOL_TEXT_CHARS + 100);
    const { getByTestId } = render(
      <ToolCallCard message={toolMessage({ toolStatus: 'completed', toolCallResult: longResult })} />,
    );
    fireEvent.press(getByTestId('chat-tool.button.toggle'));

    expect(getByTestId('chat-tool.result').props.children).toHaveLength(MAX_TOOL_TEXT_CHARS);
    fireEvent.press(getByTestId('chat-tool.result.show-all'));
    expect(getByTestId('chat-tool.result').props.children).toHaveLength(MAX_TOOL_TEXT_CHARS + 100);
  });

  it('renders added and removed diff lines and caps very long diffs', () => {
    const newText = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `line ${i}`).join('\n');
    const message = toolMessage({
      toolKind: 'edit',
      toolStatus: 'completed',
      toolDiffs: [
        { path: 'src/small.ts', oldText: 'a\nb', newText: 'a\nc' },
        { path: 'src/big.ts', oldText: null, newText },
      ],
    });
    const { getByTestId, getAllByTestId, getAllByText } = render(<ToolCallCard message={message} />);
    fireEvent.press(getByTestId('chat-tool.button.toggle'));

    expect(getAllByText('src/small.ts').length).toBeGreaterThan(0);
    expect(getAllByTestId('chat-tool.diff-line.del')).toHaveLength(1);
    // 1 add in the small diff + MAX_DIFF_LINES in the capped big diff
    expect(getAllByTestId('chat-tool.diff-line.add')).toHaveLength(1 + MAX_DIFF_LINES);
    expect(getByTestId('chat-tool.diff-hidden').props.children).toBe('… 10 more lines');
  });

  it('lists locations with their line numbers', () => {
    const message = toolMessage({
      toolStatus: 'completed',
      toolLocations: [{ path: '/repo/a.ts', line: 12 }, { path: '/repo/b.ts' }],
    });
    const { getByTestId, getByText } = render(<ToolCallCard message={message} />);
    fireEvent.press(getByTestId('chat-tool.button.toggle'));

    expect(getByText('/repo/a.ts:12')).toBeTruthy();
    expect(getByText('/repo/b.ts')).toBeTruthy();
  });

  it('keeps the legacy note chip that opens the note for model threads', () => {
    const message = toolMessage({
      kind: undefined,
      toolKind: undefined,
      toolTitle: undefined,
      toolStatus: undefined,
      toolCallName: 'create_note',
      toolCallResult: JSON.stringify({ noteId: 'note-9', title: 'Ideas' }),
    });
    const { getByTestId, queryByTestId, getByText } = render(<ToolCallCard message={message} />);
    fireEvent.press(getByTestId('chat-tool.button.toggle'));

    expect(queryByTestId('chat-tool.result')).toBeNull();
    expect(getByText('Ideas')).toBeTruthy();
    fireEvent.press(getByTestId('chat-message-bubble.tool-result.note-link'));
    expect(mockNavigate).toHaveBeenCalledWith('NoteEditor', { noteId: 'note-9' });
  });
});
