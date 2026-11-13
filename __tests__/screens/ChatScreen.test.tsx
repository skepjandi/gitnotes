import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import ChatScreen from '@/screens/ChatScreen';
import type { ChatMessage, ChatThread } from '@/models/Chat';
import type { UseChatSessionResult } from '@/services/chat/types';
import { saveChatImage } from '@/services/chat/imageStorage';
import { bridgeTools } from '@/services/agent/bridgeTools';

const mockSession = jest.fn<UseChatSessionResult, [string]>();

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { threadId: 'thread-1' } }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/services/chat', () => ({ useChatSession: (id: string) => mockSession(id) }));
jest.mock('@/hooks/useProScreenGuard', () => ({ useProScreenGuard: () => false }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/components/VoiceInputModal', () => () => null);
jest.mock('@/components/ai/ContextPickerModal', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, onConfirm }: { visible: boolean; onConfirm: (items: unknown[]) => void }) =>
      visible
        ? ReactRuntime.createElement(ReactNative.Pressable, {
            testID: 'context-picker.confirm',
            onPress: () => onConfirm([{ type: 'file', owner: 'o', repo: 'r', path: 'notes/a.md', name: 'a.md' }]),
          })
        : null,
  };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///tmp/pick.png', mimeType: 'image/png', fileName: 'pick.png', width: 10, height: 10 }],
  })),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('react-native-marked', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');
  return {
    useMarkdown: (content: string) => [ReactRuntime.createElement(ReactNative.Text, { key: 'markdown' }, content)],
  };
});
jest.mock('@shopify/flash-list', () => jest.requireActual('../helpers/flashListRows'));
jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: {
    features: jest.fn(async () => ['fs-search']),
    searchFiles: jest.fn(async () => ({ items: [{ path: 'src/app.ts', isDir: false }], truncated: false })),
  },
}));
jest.mock('@/services/chat/imageStorage', () => ({ saveChatImage: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const userMessage: ChatMessage = { id: 'u1', role: 'user', content: 'fix the bug', timestamp: 1, kind: 'text' };
const reply: ChatMessage = { id: 'a1', role: 'assistant', content: 'Done.', timestamp: 2, kind: 'text' };

function threadWith(backend: ChatThread['backend'], messages: ChatMessage[]): ChatThread {
  return {
    id: 'thread-1',
    title: 'Chat',
    messages,
    createdAt: 1,
    updatedAt: 2,
    repoOwner: 'o',
    repoName: 'r',
    branch: 'main',
    filePath: 'chat/thread-1.json',
    backend,
  };
}

function session(overrides: Partial<UseChatSessionResult> = {}): UseChatSessionResult {
  const messages = overrides.messages ?? [userMessage, reply];
  return {
    loadState: 'ready',
    loadError: null,
    thread: threadWith({ type: 'model' }, messages),
    messages,
    status: 'idle',
    error: null,
    streamStartedAt: 0,
    statusLine: null,
    pendingPermissions: [],
    pendingElicitations: [],
    queuedPrompts: [],
    retryable: false,
    contextBudget: null,
    send: jest.fn(async () => undefined),
    stop: jest.fn(),
    cancelQueued: jest.fn(),
    retryQueued: jest.fn(),
    retry: jest.fn(async () => undefined),
    editAndResend: jest.fn(async () => undefined),
    regenerate: jest.fn(async () => undefined),
    resolvePermission: jest.fn(),
    resolveElicitation: jest.fn(),
    setMode: jest.fn(async () => undefined),
    setConfigOption: jest.fn(async () => undefined),
    dismissError: jest.fn(),
    ...overrides,
  };
}

describe('ChatScreen', () => {
  it('shows a loading state until the thread is ready and keeps the input disabled', () => {
    mockSession.mockReturnValue(session({ loadState: 'loading', thread: null, messages: [] }));
    const { getByTestId } = render(<ChatScreen />);

    expect(getByTestId('chat.state.loading')).toBeTruthy();
    expect(getByTestId('chat-input.input.message').props.editable).toBe(false);
  });

  it('shows not-found instead of an empty chat for a missing thread', () => {
    mockSession.mockReturnValue(session({ loadState: 'not-found', thread: null, messages: [] }));

    expect(render(<ChatScreen />).getByTestId('chat.state.not-found')).toBeTruthy();
  });

  it('sends typed text through the session', () => {
    const current = session();
    mockSession.mockReturnValue(current);
    const { getByTestId } = render(<ChatScreen />);

    fireEvent.changeText(getByTestId('chat-input.input.message'), 'run the tests');
    fireEvent.press(getByTestId('chat-input.button.send'));

    expect(current.send).toHaveBeenCalledWith('run the tests', [], []);
  });

  it('renders every pending permission as a card and resolves with the pressed option', () => {
    const current = session({
      status: 'awaiting-permission',
      pendingPermissions: [
        {
          id: 'p1',
          title: 'Run npm test',
          options: [
            { id: 'yes', label: 'Allow', kind: 'allow_once' },
            { id: 'no', label: 'Reject', kind: 'reject_once' },
          ],
        },
      ],
    });
    mockSession.mockReturnValue(current);
    const { getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('chat-permission.button.no'));

    expect(current.resolvePermission).toHaveBeenCalledWith('p1', { optionId: 'no' });
  });

  it('offers retry for a failed turn and wires it to the session', () => {
    const current = session({ status: 'error', error: 'Bridge unreachable', retryable: true });
    mockSession.mockReturnValue(current);
    const { getByText, getByTestId } = render(<ChatScreen />);

    expect(getByText('Bridge unreachable')).toBeTruthy();
    fireEvent.press(getByTestId('chat-error.button.retry'));

    expect(current.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the reconnect line reported by an agent backend', () => {
    mockSession.mockReturnValue(
      session({
        status: 'running',
        statusLine: 'Reconnecting to the bridge…',
        thread: threadWith(
          { type: 'agent', bridgeId: 'b', agentId: 'claude', agentName: 'Claude Code', cwd: '/code/app' },
          [userMessage],
        ),
        messages: [userMessage],
      }),
    );

    expect(render(<ChatScreen />).getByText('Reconnecting to the bridge…')).toBeTruthy();
  });

  it('switches agent modes from the mode chip', () => {
    const current = session({
      thread: threadWith(
        {
          type: 'agent',
          bridgeId: 'b',
          agentId: 'claude',
          agentName: 'Claude Code',
          cwd: '/code/app',
          modeId: 'default',
          availableModes: [
            { id: 'default', name: 'Manual' },
            { id: 'plan', name: 'Plan' },
          ],
        },
        [userMessage],
      ),
      messages: [userMessage],
    });
    mockSession.mockReturnValue(current);
    jest.useFakeTimers();
    try {
      const { getByTestId } = render(<ChatScreen />);

      fireEvent.press(getByTestId('chat-config.chip.mode'));
      fireEvent.press(getByTestId('chat-config.choice.mode.plan'));
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(current.setMode).toHaveBeenCalledWith('plan');
    } finally {
      jest.useRealTimers();
    }
  });

  const agentThread = (backend: Partial<Extract<ChatThread['backend'], { type: 'agent' }>> = {}) =>
    threadWith(
      { type: 'agent', bridgeId: 'b', agentId: 'claude', agentName: 'Claude Code', cwd: '/code/app', ...backend },
      [userMessage],
    );

  it('shows the current model on the chip and changes ACP config options through the session', () => {
    const current = session({
      thread: agentThread({
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'sonnet',
            options: [
              { value: 'sonnet', name: 'Sonnet' },
              { value: 'opus', name: 'Opus', description: 'Deepest' },
            ],
          },
          {
            id: 'effort',
            name: 'Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'low',
            options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
          },
        ],
      }),
      messages: [userMessage],
    });
    mockSession.mockReturnValue(current);
    const { getByTestId } = render(<ChatScreen />);

    expect(getByTestId('chat-config.chip.model.label').props.children).toBe('Sonnet');
    fireEvent.press(getByTestId('chat-config.chip.model'));
    fireEvent.press(getByTestId('chat-config.choice.model.opus'));
    expect(current.setConfigOption).toHaveBeenCalledWith('model', 'opus');

    fireEvent.press(getByTestId('chat-config.chip.effort'));
    fireEvent.press(getByTestId('chat-config.choice.effort.high'));
    expect(current.setConfigOption).toHaveBeenCalledWith('effort', 'high');
    expect(current.setMode).not.toHaveBeenCalled();
  });

  it('renders a pending elicitation inline and resolves it through the session', () => {
    const current = session({
      status: 'awaiting-permission',
      thread: agentThread(),
      pendingElicitations: [
        {
          mode: 'form',
          id: 'e1',
          message: 'Which database?',
          fields: [
            { key: 'db', label: 'Database', required: true, kind: 'enum', options: [{ value: 'pg', label: 'Postgres' }] },
          ],
        },
      ],
    });
    mockSession.mockReturnValue(current);
    const { getByTestId, getByText } = render(<ChatScreen />);

    expect(getByText('Which database?')).toBeTruthy();
    fireEvent.press(getByTestId('chat-elicitation.option.db.pg'));
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(current.resolveElicitation).toHaveBeenCalledWith('e1', { action: 'accept', content: { db: 'pg' } });
  });

  it('forwards attached notes to the agent when sending', () => {
    const current = session({ thread: agentThread({ supportsImages: false }), messages: [userMessage] });
    mockSession.mockReturnValue(current);
    const { getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('chat-input.button.attach'));
    fireEvent.press(getByTestId('context-picker.confirm'));
    fireEvent.changeText(getByTestId('chat-input.input.message'), 'summarise');
    fireEvent.press(getByTestId('chat-input.button.send'));

    expect(current.send).toHaveBeenCalledWith(
      'summarise',
      [expect.objectContaining({ path: 'notes/a.md', name: 'a.md' })],
      [],
    );
  });

  it('picks images for an agent that accepts them and sends them with the prompt', async () => {
    jest.mocked(saveChatImage).mockResolvedValue({ id: 'img1', uri: 'file:///docs/img1.png', mimeType: 'image/png' });
    const current = session({ thread: agentThread({ supportsImages: true }), messages: [userMessage] });
    mockSession.mockReturnValue(current);
    jest.useFakeTimers();
    try {
      const { getByTestId, queryByTestId } = render(<ChatScreen />);

      fireEvent.press(getByTestId('chat-input.button.attach'));
      fireEvent.press(getByTestId('chat-input.attach.library'));
      act(() => {
        jest.advanceTimersByTime(400);
      });

      await waitFor(() => expect(getByTestId('chat-input.image.img1')).toBeTruthy());
      expect(saveChatImage).toHaveBeenCalledWith('thread-1', expect.objectContaining({ uri: 'file:///tmp/pick.png' }));

      fireEvent.changeText(getByTestId('chat-input.input.message'), 'what is this');
      fireEvent.press(getByTestId('chat-input.button.send'));
      expect(current.send).toHaveBeenCalledWith('what is this', [], [expect.objectContaining({ id: 'img1' })]);
      expect(queryByTestId('chat-input.image.img1')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('hides the image menu when the agent does not accept images', () => {
    mockSession.mockReturnValue(session({ thread: agentThread({ supportsImages: false }), messages: [userMessage] }));
    const { getByTestId, queryByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('chat-input.button.attach'));
    expect(queryByTestId('chat-input.attach.library')).toBeNull();
  });

  it('suggests files from the bridge for an @token and inserts the path', async () => {
    mockSession.mockReturnValue(session({ thread: agentThread(), messages: [userMessage] }));
    jest.useFakeTimers();
    try {
      const { getByTestId } = render(<ChatScreen />);

      await act(async () => {
        jest.advanceTimersByTime(10);
      });

      fireEvent.changeText(getByTestId('chat-input.input.message'), 'look at @sr');
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(bridgeTools.searchFiles).toHaveBeenCalledWith('b', '/code/app', 'sr');
      fireEvent.press(getByTestId('chat-input.mention.src/app.ts'));
      expect(getByTestId('chat-input.input.message').props.value).toBe('look at @src/app.ts ');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not search files when the bridge does not advertise fs-search', async () => {
    jest.mocked(bridgeTools.features).mockResolvedValueOnce([]);
    jest.mocked(bridgeTools.searchFiles).mockClear();
    mockSession.mockReturnValue(session({ thread: agentThread(), messages: [userMessage] }));
    jest.useFakeTimers();
    try {
      const { getByTestId, queryByTestId } = render(<ChatScreen />);

      await act(async () => {
        jest.advanceTimersByTime(10);
      });

      fireEvent.changeText(getByTestId('chat-input.input.message'), 'look at @sr');
      await act(async () => {
        jest.advanceTimersByTime(200);
      });

      expect(queryByTestId('chat-input.mention-palette')).toBeNull();
      expect(bridgeTools.searchFiles).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
