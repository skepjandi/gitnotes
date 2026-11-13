import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatThreadCard } from '@/components/chat/ChatThreadCard';
import type { ChatThreadSummary } from '@/models/Chat';

const thread: ChatThreadSummary = {
  id: 't1',
  title: 'Fix login',
  updatedAt: Date.now(),
  messageCount: 3,
  preview: 'Done',
  backend: 'agent',
  agentName: 'Claude Code',
};

describe('ChatThreadCard', () => {
  it('shows the needs-you badge and agent badge', () => {
    const { getByTestId, getByText } = render(<ChatThreadCard thread={thread} status="awaiting-permission" onPress={jest.fn()} onLongPress={jest.fn()} />);

    expect(getByTestId('chat-thread-card.status-badge')).toBeTruthy();
    expect(getByText('Needs you')).toBeTruthy();
    expect(getByText('Claude Code')).toBeTruthy();
  });

  it('shows a spinner and working badge while running', () => {
    const { getByTestId, getByText } = render(<ChatThreadCard thread={thread} status="running" onPress={jest.fn()} onLongPress={jest.fn()} />);

    expect(getByTestId('chat-thread-card.running-indicator')).toBeTruthy();
    expect(getByText('Working')).toBeTruthy();
  });

  it('has no status badge when idle and still handles presses', () => {
    const onPress = jest.fn();
    const { queryByTestId, getByTestId } = render(<ChatThreadCard thread={thread} onPress={onPress} onLongPress={jest.fn()} />);

    expect(queryByTestId('chat-thread-card.status-badge')).toBeNull();
    fireEvent.press(getByTestId('chat-thread-card.t1'));
    expect(onPress).toHaveBeenCalled();
  });
});
