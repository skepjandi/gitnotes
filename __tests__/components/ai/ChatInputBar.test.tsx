import React from 'react';
import { render } from '@testing-library/react-native';

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
    },
    spacing: { 1: 4, 2: 8, 3: 12 },
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
});
