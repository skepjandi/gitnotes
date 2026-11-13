import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
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
  }),
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

  it('opens a menu with notes and images when the agent accepts images', () => {
    jest.useFakeTimers();
    try {
    const onAttach = jest.fn();
    const onPickImage = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        onSend={jest.fn()}
        onAttach={onAttach}
        attachedContexts={[]}
        onRemoveContext={jest.fn()}
        isStreaming={false}
        onPickImage={onPickImage}
      />,
    );

    fireEvent.press(getByTestId('chat-input.button.attach'));

    fireEvent.press(getByTestId('chat-input.attach.notes'));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onAttach).toHaveBeenCalled();

    fireEvent.press(getByTestId('chat-input.attach.camera'));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(onPickImage).toHaveBeenCalledWith('camera');
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists staged images with a remove button', () => {
    const onRemoveImage = jest.fn();
    const { getByTestId } = render(
      <ChatInputBar
        onSend={jest.fn()}
        onAttach={jest.fn()}
        attachedContexts={[]}
        onRemoveContext={jest.fn()}
        isStreaming={false}
        attachedImages={[{ id: 'img1', uri: 'file:///docs/img1.png', mimeType: 'image/png' }]}
        onRemoveImage={onRemoveImage}
      />,
    );

    expect(getByTestId('chat-input.image.img1')).toBeTruthy();
    fireEvent.press(getByTestId('chat-input.image.remove.img1'));
    expect(onRemoveImage).toHaveBeenCalledWith('img1');
  });

  it('suggests files for an @token and inserts the chosen path at the caret', async () => {
    jest.useFakeTimers();
    try {
      const fileSearch = jest.fn(async () => [
        { path: 'src/app.ts', isDir: false },
        { path: 'src', isDir: true },
      ]);
      const { getByTestId, queryByTestId } = render(
        <ChatInputBar
          onSend={jest.fn()}
          onAttach={jest.fn()}
          attachedContexts={[]}
          onRemoveContext={jest.fn()}
          isStreaming={false}
          fileSearch={fileSearch}
        />,
      );

      fireEvent.changeText(getByTestId('chat-input.input.message'), 'look at @sr');
      expect(queryByTestId('chat-input.mention-palette')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(fileSearch).toHaveBeenCalledWith('sr');
      expect(getByTestId('chat-input.mention-palette')).toBeTruthy();
      expect(getByTestId('chat-input.mention.src/app.ts')).toBeTruthy();

      fireEvent.press(getByTestId('chat-input.mention.src/app.ts'));
      expect(getByTestId('chat-input.input.message').props.value).toBe('look at @src/app.ts ');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a directory open with a trailing slash so the next segment can follow', async () => {
    jest.useFakeTimers();
    try {
      const fileSearch = jest.fn(async () => [{ path: 'src', isDir: true }]);
      const { getByTestId } = render(
        <ChatInputBar
          onSend={jest.fn()}
          onAttach={jest.fn()}
          attachedContexts={[]}
          onRemoveContext={jest.fn()}
          isStreaming={false}
          fileSearch={fileSearch}
        />,
      );

      fireEvent.changeText(getByTestId('chat-input.input.message'), '@');
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      fireEvent.press(getByTestId('chat-input.mention.src'));

      expect(getByTestId('chat-input.input.message').props.value).toBe('@src/');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the slash palette instead of the mention palette at the start of the text', async () => {
    jest.useFakeTimers();
    try {
      const fileSearch = jest.fn(async () => [{ path: 'src/app.ts', isDir: false }]);
      const { getByTestId, queryByTestId } = render(
        <ChatInputBar
          onSend={jest.fn()}
          onAttach={jest.fn()}
          attachedContexts={[]}
          onRemoveContext={jest.fn()}
          isStreaming={false}
          commands={[{ name: 'compact' }]}
          fileSearch={fileSearch}
        />,
      );

      fireEvent.changeText(getByTestId('chat-input.input.message'), '/');
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(getByTestId('chat-input.slash-palette')).toBeTruthy();
      expect(queryByTestId('chat-input.mention-palette')).toBeNull();
      expect(fileSearch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
