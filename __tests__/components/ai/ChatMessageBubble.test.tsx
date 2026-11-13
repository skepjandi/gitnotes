import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-marked', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');

  return {
    useMarkdown: (content: string) => [ReactRuntime.createElement(ReactNative.Text, { key: 'markdown' }, content)],
  };
});

import { ChatMessageBubble, areBubblePropsEqual } from '@/components/ai/ChatMessageBubble';
import type { ChatMessage } from '@/models/Chat';

const assistant = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content: 'hello',
  timestamp: Date.now(),
  ...overrides,
});

describe('ChatMessageBubble', () => {
  it('constrains long assistant markdown to the bubble width', () => {
    const { UNSAFE_getAllByType } = render(<ChatMessageBubble message={assistant({ content: 'A'.repeat(500) })} />);

    const hasWidthBoundMarkdown = UNSAFE_getAllByType(View).some((node) => {
      const style = StyleSheet.flatten(node.props.style) as { width?: unknown } | undefined;
      return style?.width === '100%';
    });

    expect(hasWidthBoundMarkdown).toBe(true);
  });

  it('renders thought messages as a collapsed block that expands on press', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <ChatMessageBubble message={assistant({ kind: 'thought', content: 'weighing options' })} />,
    );

    expect(getByText('Thinking')).toBeTruthy();
    expect(queryByTestId('chat-thought.text')).toBeNull();

    fireEvent.press(getByTestId('chat-thought.button.toggle'));
    expect(getByTestId('chat-thought.text').props.children).toBe('weighing options');

    fireEvent.press(getByTestId('chat-thought.button.toggle'));
    expect(queryByTestId('chat-thought.text')).toBeNull();
  });

  it('collapses again when the same cell is reused for another thought message', () => {
    const first = assistant({ id: 't1', kind: 'thought', content: 'first' });
    const second = assistant({ id: 't2', kind: 'thought', content: 'second' });
    const { getByTestId, queryByTestId, rerender } = render(<ChatMessageBubble message={first} />);

    fireEvent.press(getByTestId('chat-thought.button.toggle'));
    expect(getByTestId('chat-thought.text')).toBeTruthy();

    rerender(<ChatMessageBubble message={second} />);
    expect(queryByTestId('chat-thought.text')).toBeNull();
  });

  it('renders plan messages as a checklist with an icon per entry status', () => {
    const message = assistant({
      kind: 'plan',
      plan: [
        { content: 'Read the code', status: 'completed' },
        { content: 'Write the fix', status: 'in_progress' },
        { content: 'Run the tests', status: 'pending' },
      ],
    });
    const { getByTestId, getByText } = render(<ChatMessageBubble message={message} />);

    expect(getByText('Read the code')).toBeTruthy();
    expect(getByTestId('chat-plan.entry.completed').findByProps({ testID: 'icon-checkmark-circle' })).toBeTruthy();
    expect(getByTestId('chat-plan.entry.in_progress').findByProps({ testID: 'icon-radio-button-on' })).toBeTruthy();
    expect(getByTestId('chat-plan.entry.pending').findByProps({ testID: 'icon-ellipse-outline' })).toBeTruthy();
  });

  it('renders tool messages as a tool card and legacy tool bubbles too', () => {
    const agentTool = render(
      <ChatMessageBubble message={assistant({ kind: 'tool', toolTitle: 'Read a.ts', toolStatus: 'completed' })} />,
    );
    expect(agentTool.getByTestId('chat-tool.card')).toBeTruthy();
    agentTool.unmount();

    const legacy = render(<ChatMessageBubble message={assistant({ content: '', toolCallName: 'get_note' })} />);
    expect(legacy.getByTestId('chat-tool.card')).toBeTruthy();
  });

  it('shows typing dots instead of an empty streaming assistant bubble', () => {
    const { queryByTestId } = render(<ChatMessageBubble message={assistant({ content: '' })} isStreaming />);
    expect(queryByTestId('chat-message-bubble.button.long-press')).toBeNull();
  });

  it('forwards long presses on text bubbles with the message', () => {
    const onLongPress = jest.fn();
    const message = assistant();
    const { getByTestId } = render(<ChatMessageBubble message={message} onLongPress={onLongPress} />);

    fireEvent(getByTestId('chat-message-bubble.button.long-press'), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(message);
  });
});

describe('areBubblePropsEqual', () => {
  const onLongPress = jest.fn();
  const base = assistant({ kind: 'tool', toolCallName: 'bash', toolStatus: 'running' });

  it('treats a re-created but identical message as equal so untouched rows skip rendering', () => {
    expect(areBubblePropsEqual({ message: base, onLongPress }, { message: { ...base }, onLongPress })).toBe(true);
  });

  it.each<[string, Partial<ChatMessage>]>([
    ['content', { content: 'more text' }],
    ['toolStatus', { toolStatus: 'completed' }],
    ['toolTitle', { toolTitle: 'New title' }],
    ['toolKind', { toolKind: 'edit' }],
    ['toolCallResult', { toolCallResult: 'out' }],
    ['toolDiffs', { toolDiffs: [{ path: 'a', newText: 'b' }] }],
    ['toolLocations', { toolLocations: [{ path: 'a' }] }],
    ['plan', { plan: [{ content: 'x', status: 'pending' }] }],
    ['kind', { kind: 'text' }],
  ])('re-renders when %s changes', (_field, patch) => {
    expect(areBubblePropsEqual({ message: base, onLongPress }, { message: { ...base, ...patch }, onLongPress })).toBe(false);
  });

  it('re-renders when the streaming flag flips', () => {
    expect(areBubblePropsEqual({ message: base, isStreaming: true }, { message: base, isStreaming: false })).toBe(false);
  });

  it('renders attached images and opens the full screen viewer on tap', () => {
    const message: ChatMessage = {
      id: 'u2',
      role: 'user',
      content: 'look at this',
      timestamp: 1,
      kind: 'text',
      attachedImages: [{ id: 'img1', uri: 'file:///docs/img1.png', mimeType: 'image/png' }],
    };
    const { getByTestId } = render(<ChatMessageBubble message={message} />);

    expect(getByTestId('chat-message-bubble.image.img1')).toBeTruthy();
    fireEvent.press(getByTestId('chat-message-bubble.image.img1'));
    expect(getByTestId('chat-image-viewer')).toBeTruthy();
  });

  it('renders a slash command as a command chip', () => {
    const message: ChatMessage = { id: 'u3', role: 'user', content: '/compact', timestamp: 1, kind: 'text' };
    const { getByTestId, queryByTestId } = render(<ChatMessageBubble message={message} />);

    expect(getByTestId('chat-message-bubble.command')).toBeTruthy();
    expect(queryByTestId('chat-message-bubble.command')).toBeTruthy();
  });

  it('keeps a plain message out of the command chip', () => {
    const message: ChatMessage = { id: 'u4', role: 'user', content: 'run /compact now', timestamp: 1, kind: 'text' };
    const { queryByTestId } = render(<ChatMessageBubble message={message} />);

    expect(queryByTestId('chat-message-bubble.command')).toBeNull();
  });
});
