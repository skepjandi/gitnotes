import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ChatTimelineList, type ChatTimelineListProps } from '@/components/chat/ChatTimelineList';
import type { ElicitationRequest } from '@/services/chat/types';
import type { ChatMessage } from '@/models/Chat';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@/components/chat/motion/RowArrival', () => {
  const ReactRuntime = require('react');
  const ReactNative = require('react-native');
  return {
    RowArrival: ({ children }: { children: React.ReactNode }) =>
      ReactRuntime.createElement(ReactNative.View, { testID: 'row-arrival' }, children),
  };
});
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
    pendingElicitations: [],
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

  it('renders an open elicitation inline and resolves it', () => {
    const onResolveElicitation = jest.fn();
    const request: ElicitationRequest = {
      mode: 'form',
      id: 'e1',
      message: 'Which database?',
      fields: [{ key: 'db', label: 'Database', required: true, kind: 'enum', options: [{ value: 'pg', label: 'Postgres' }] }],
    };
    const { getByTestId } = renderList({ pendingElicitations: [request], onResolveElicitation });

    expect(getByTestId('chat-elicitation.card')).toBeTruthy();
    fireEvent.press(getByTestId('chat-elicitation.option.db.pg'));
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(onResolveElicitation).toHaveBeenCalledWith('e1', { action: 'accept', content: { db: 'pg' } });
  });

  it('shows an Earlier row for long transcripts and loads one more page', () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ id: `m${index}`, role: 'assistant' as const, content: `m${index}`, timestamp: 1, kind: 'text' as const }));
    const { getByTestId, queryByText } = renderList({ messages: many });

    expect(getByTestId('chat.button.load-earlier')).toBeTruthy();
    expect(queryByText('m0')).toBeNull();

    fireEvent.press(getByTestId('chat.button.load-earlier'));

    expect(queryByText('m0')).toBeTruthy();
    expect(queryByText('m59')).toBeTruthy();
  });

  it('never hides the work row an open approval hangs off', () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ id: `m${index}`, role: 'assistant' as const, content: `m${index}`, timestamp: 1, kind: 'text' as const }));
    many.unshift({ id: 't1', role: 'assistant' as const, content: '', timestamp: 1, kind: 'tool' as const, toolCallId: 'call-t1', toolKind: 'execute' as const, toolStatus: 'completed' as const });
    const { getByTestId, queryByTestId } = renderList({
      messages: many,
      pendingPermissions: [{ id: 'p1', toolCallId: 'call-t1', title: 'Run', options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }] }],
    });

    expect(getByTestId('chat-permission.card')).toBeTruthy();
    expect(queryByTestId('chat.button.load-earlier')).toBeNull();
  });

  it('animates only rows that arrive after the first render', () => {
    const { queryAllByTestId, rerender } = renderList({ messages: [user] });
    expect(queryAllByTestId('row-arrival')).toHaveLength(0);

    rerender(
      <ChatTimelineList
        messages={[user, reply]}
        pendingPermissions={[]}
        queuedPrompts={[]}
        pendingElicitations={[]}
        isRunning={false}
        headerHeight={0}
        empty={<Text>nothing yet</Text>}
        onResolvePermission={jest.fn()}
        onCancelQueued={jest.fn()}
        onRetryQueued={jest.fn()}
      />,
    );

    expect(queryAllByTestId('row-arrival')).toHaveLength(1);
  });
});
