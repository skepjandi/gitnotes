import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
  useTokens: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      primary: '#00f',
      text: '#000',
      textSecondary: '#999',
      accent: '#00f',
      elevated: '#eee',
      warning: '#fa0',
      error: '#f00',
    },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    type: { sm: 12 },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@/components/ui/IconButton', () => {
  const ReactNative = require('react-native');
  const ReactRuntime = require('react');

  return {
    IconButton: ({ children, variant: _variant, ...props }: { children?: React.ReactNode; variant?: string; [key: string]: unknown }) =>
      ReactRuntime.createElement(ReactNative.TouchableOpacity, props, children),
  };
});

jest.mock('@/components/ui/Surface', () => ({
  Surface: ({ children }: { children?: unknown }) => {
    const ReactRuntime = require('react');
    return ReactRuntime.createElement('View', null, children);
  },
}));

import { ChatInputBar } from '@/components/ai/ChatInputBar';

describe('ChatInputBar', () => {
  it('keeps the message input editable while a response is streaming', () => {
    const { getByTestId } = render(
      <ChatInputBar
        onSend={jest.fn()}
        onAttach={jest.fn()}
        attachedContexts={[]}
        onRemoveContext={jest.fn()}
        isStreaming
      />,
    );

    expect(getByTestId('chat-input.input.message').props.editable).toBe(true);
  });
  it('queues a typed message while a response is streaming instead of blocking send', () => {
    const onSend = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar onSend={onSend} onAttach={jest.fn()} attachedContexts={[]} onRemoveContext={jest.fn()} isStreaming onStop={jest.fn()} />,
    );

    fireEvent.changeText(getByTestId('chat-input.input.message'), 'then lint');
    fireEvent.press(getByTestId('chat-input.button.send'));

    expect(onSend).toHaveBeenCalledWith('then lint');
  });

  it('shows stop only while streaming with an empty draft', () => {
    const { getByTestId, queryByTestId } = render(
      <ChatInputBar onSend={jest.fn()} onAttach={jest.fn()} attachedContexts={[]} onRemoveContext={jest.fn()} isStreaming onStop={jest.fn()} />,
    );
    expect(getByTestId('chat-input.button.stop')).toBeTruthy();

    fireEvent.changeText(getByTestId('chat-input.input.message'), 'x');
    expect(queryByTestId('chat-input.button.stop')).toBeNull();
  });

  it('suggests agent slash commands and completes the picked one', () => {
    const { getByTestId, queryByTestId } = render(
      <ChatInputBar
        onSend={jest.fn()}
        onAttach={jest.fn()}
        attachedContexts={[]}
        onRemoveContext={jest.fn()}
        isStreaming={false}
        commands={[{ name: 'compact', description: 'Summarize' }, { name: 'review' }]}
      />,
    );

    expect(queryByTestId('chat-input.slash-palette')).toBeNull();
    fireEvent.changeText(getByTestId('chat-input.input.message'), '/co');
    expect(getByTestId('chat-input.slash.compact')).toBeTruthy();
    expect(queryByTestId('chat-input.slash.review')).toBeNull();

    fireEvent.press(getByTestId('chat-input.slash.compact'));
    expect(getByTestId('chat-input.input.message').props.value).toBe('/compact ');
    expect(queryByTestId('chat-input.slash-palette')).toBeNull();
  });
});
