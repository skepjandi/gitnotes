import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
  useTokens: () => ({
    colors: {
      primary: '#00f',
      text: '#000',
      textSecondary: '#999',
    },
    spacing: { 1: 4, 2: 8, 3: 12 },
    type: { sm: 12, md: 16 },
  }),
}));

jest.mock('@/components/ui/Surface', () => ({
  Surface: ({ children }: { children?: unknown }) => {
    const ReactRuntime = require('react');
    const ReactNative = require('react-native');
    return ReactRuntime.createElement(ReactNative.View, null, children);
  },
}));

jest.mock('react-native-marked', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');

  return {
    useMarkdown: (content: string) => [ReactRuntime.createElement(ReactNative.Text, { key: 'markdown' }, content)],
  };
});

import { ChatMessageBubble } from '@/components/ai/ChatMessageBubble';

describe('ChatMessageBubble', () => {
  it('constrains long assistant markdown to the bubble width', () => {
    const { UNSAFE_getAllByType } = render(
      <ChatMessageBubble
        message={{
          id: 'assistant-1',
          role: 'assistant',
          content: 'A'.repeat(500),
          timestamp: Date.now(),
        }}
      />,
    );

    const hasWidthBoundMarkdown = UNSAFE_getAllByType(View).some((node) => {
      const style = StyleSheet.flatten(node.props.style) as { width?: unknown } | undefined;
      return style?.width === '100%';
    });

    expect(hasWidthBoundMarkdown).toBe(true);
  });
});
