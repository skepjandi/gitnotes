import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import ChatScreen from '@/screens/ChatScreen';
import type { ChatMessage, ChatThread } from '@/models/Chat';
import type { UseChatSessionResult } from '@/services/chat/types';

const mockSession = jest.fn<UseChatSessionResult, [string]>();

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { threadId: 'thread-1' } }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/services/chat', () => ({ useChatSession: (id: string) => mockSession(id) }));
jest.mock('@/hooks/useProScreenGuard', () => ({ useProScreenGuard: () => false }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/components/VoiceInputModal', () => () => null);
jest.mock('@/components/ai/ContextPickerModal', () => () => null);
jest.mock('react-native-marked', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');
  return {
    useMarkdown: (content: string) => [ReactRuntime.createElement(ReactNative.Text, { key: 'markdown' }, content)],
  };
});
jest.mock('@shopify/flash-list', () => jest.requireActual('../helpers/flashListRows'));
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
    setMode: jest.fn(async () => undefined),
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

    expect(current.send).toHaveBeenCalledWith('run the tests', []);
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

      fireEvent.press(getByTestId('chat-mode.chip'));
      fireEvent.press(getByTestId('chat-mode.item.plan'));
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(current.setMode).toHaveBeenCalledWith('plan');
    } finally {
      jest.useRealTimers();
    }
  });
});
