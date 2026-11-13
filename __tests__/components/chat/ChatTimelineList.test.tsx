import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ChatTimelineList, type ChatTimelineListProps } from '@/components/chat/ChatTimelineList';
import type { ChatMessage } from '@/models/Chat';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@shopify/flash-list', () => jest.requireActual('../../helpers/flashListRows'));
jest.mock('react-native-marked', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');
  return {
    useMarkdown: (content: string) => [ReactRuntime.createElement(ReactNative.Text, { key: 'md' }, content)],
  };
});

const user: ChatMessage = { id: 'u1', role: 'user', content: 'run the tests', timestamp: 1, kind: 'text' };
const reply: ChatMessage = { id: 'a1', role: 'assistant', content: 'All green.', timestamp: 2, kind: 'text' };
const tool = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  timestamp: 2,
  kind: 'tool',
  toolCallId: `call-${id}`,
  toolTitle: `Step ${id}`,
  toolKind: 'execute',
  toolStatus: 'completed',
  ...overrides,
});

function renderList(overrides: Partial<ChatTimelineListProps> = {}) {
  const props: ChatTimelineListProps = {
    messages: [user, reply],
    pendingPermissions: [],
    queuedPrompts: [],
    isRunning: false,
    headerHeight: 0,
    empty: <Text>nothing yet</Text>,
    onResolvePermission: jest.fn(),
    onCancelQueued: jest.fn(),
    onRetryQueued: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<ChatTimelineList {...props} />) };
}

describe('ChatTimelineList', () => {
  it('shows the empty state when there is nothing to render', () => {
    const { getByText } = renderList({ messages: [] });
    expect(getByText('nothing yet')).toBeTruthy();
  });

  it('renders the prompt as a bubble and the reply as plain markdown', () => {
    const { getAllByTestId, getByText } = renderList();

    expect(getAllByTestId('chat-message-bubble.button.long-press')).toHaveLength(2);
    expect(getByText('run the tests')).toBeTruthy();
    expect(getByText('All green.')).toBeTruthy();
  });

  it('folds tool calls into one collapsed work line that expands to the steps', () => {
    const { getByTestId, queryAllByTestId, getByText } = renderList({
      messages: [user, tool('t1'), tool('t2', { toolKind: 'edit' }), reply],
    });

    expect(queryAllByTestId('chat-tool.card')).toHaveLength(0);
    expect(getByText(/Ran 1 command · Edited 1 file/)).toBeTruthy();

    fireEvent.press(getByTestId('chat-work.button.toggle'));

    expect(queryAllByTestId('chat-tool.card')).toHaveLength(2);
  });

  it('renders an open approval inline and resolves it with the pressed option', () => {
    const { getByTestId, props } = renderList({
      messages: [user, tool('t1', { toolStatus: 'awaiting-approval' })],
      pendingPermissions: [
        {
          id: 'p1',
          toolCallId: 'call-t1',
          title: 'Run npm test',
          options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
        },
      ],
    });

    fireEvent.press(getByTestId('chat-permission.button.allow'));

    expect(props.onResolvePermission).toHaveBeenCalledWith('p1', { optionId: 'allow' });
  });

  it('lets a failed queued prompt be retried or cancelled, but not a sending one', () => {
    const { getByTestId, queryByTestId, props } = renderList({
      queuedPrompts: [
        { id: 'q1', text: 'then lint', contexts: [], state: 'failed' },
        { id: 'q2', text: 'and build', contexts: [], state: 'sending' },
      ],
    });

    fireEvent.press(getByTestId('chat-queued.retry.q1'));
    fireEvent.press(getByTestId('chat-queued.cancel.q1'));

    expect(props.onRetryQueued).toHaveBeenCalledWith('q1');
    expect(props.onCancelQueued).toHaveBeenCalledWith('q1');
    expect(queryByTestId('chat-queued.cancel.q2')).toBeNull();
    expect(queryByTestId('chat-queued.retry.q2')).toBeNull();
  });
});
