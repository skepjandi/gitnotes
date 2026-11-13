import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatThreadListScreen, { AGENT_GUIDE_DISMISSED_KEY } from '@/screens/ChatThreadListScreen';
import type { ChatThreadSummary } from '@/models/Chat';
import { useChatStore } from '@/stores/chatStore';

const mockNavigate = jest.fn();
let mockWidth = 1200;

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get: (target, key) =>
      key === 'useWindowDimensions' ? () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }) : target[key],
  });
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
}));
jest.mock('@/hooks/useProScreenGuard', () => ({ useProScreenGuard: () => false }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/components/chat/ChatConversation', () => {
  const { Text } = require('react-native');
  return { ChatConversation: ({ threadId, embedded }: { threadId: string; embedded?: boolean }) => (
    <Text testID="mock-conversation">{`${threadId}:${String(embedded)}`}</Text>
  ) };
});
jest.mock('@/components/chat/setup/BridgeSetupGuide', () => {
  const { Pressable } = require('react-native');
  return { BridgeSetupGuide: ({ visible, onTryDemo }: { visible: boolean; onTryDemo: () => void }) =>
    visible ? <Pressable testID="mock-guide.demo" onPress={onTryDemo} /> : null };
});
jest.mock('@/services/chat', () => ({ createDemoThread: jest.fn().mockResolvedValue({ id: 'demo-1' }) }));
jest.mock('@/services/chat/sessions', () => ({ peekChatSession: () => undefined }));
jest.mock('@/stores/aiHubStore', () => ({
  useAIHubStore: Object.assign(() => undefined, { getState: () => ({ closeChatRepoPicker: jest.fn(), goNewChat: jest.fn() }) }),
}));
jest.mock('@/stores/githubActivityStore', () => ({ githubActivity: { begin: jest.fn(), end: jest.fn() } }));

const summary = (id: string, backend: ChatThreadSummary['backend']): ChatThreadSummary => ({
  id,
  title: `Thread ${id}`,
  updatedAt: Date.now(),
  messageCount: 1,
  preview: '',
  backend,
  ...(backend === 'agent' ? { agentName: 'Claude Code' } : {}),
});

function seed(threads: ChatThreadSummary[], deleteThread = jest.fn().mockResolvedValue(true)) {
  useChatStore.setState({ threads, isLoading: false, error: null, loadThreads: jest.fn().mockResolvedValue(undefined), deleteThread });
  return deleteThread;
}

describe('ChatThreadListScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockWidth = 1200;
    await AsyncStorage.clear();
  });

  it('on wide windows selects a thread in place and highlights it', async () => {
    seed([summary('a', 'agent'), summary('b', 'agent')]);
    const { getByTestId, queryByTestId } = render(<ChatThreadListScreen />);

    expect(getByTestId('chat-thread-list.split.placeholder')).toBeTruthy();
    fireEvent.press(getByTestId('chat-thread-card.a'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getByTestId('mock-conversation').props.children).toBe('a:true');
    expect(getByTestId('chat-thread-card.a').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('chat-thread-card.b').props.accessibilityState).toEqual({ selected: false });
    expect(queryByTestId('chat-thread-list.split.placeholder')).toBeNull();
  });

  it('clears the selection when the selected thread is deleted', async () => {
    seed([summary('a', 'agent')]);
    const { getByTestId, queryByTestId } = render(<ChatThreadListScreen />);
    fireEvent.press(getByTestId('chat-thread-card.a'));
    expect(getByTestId('mock-conversation')).toBeTruthy();

    act(() => useChatStore.setState({ threads: [] }));

    await waitFor(() => expect(queryByTestId('mock-conversation')).toBeNull());
    expect(getByTestId('chat-thread-list.split.placeholder')).toBeTruthy();
  });

  it('keeps phone behaviour below the split width: navigates and has no conversation pane', () => {
    mockWidth = 600;
    seed([summary('a', 'agent')]);
    const { getByTestId, queryByTestId } = render(<ChatThreadListScreen />);

    fireEvent.press(getByTestId('chat-thread-card.a'));

    expect(mockNavigate).toHaveBeenCalledWith('ChatScreen', { threadId: 'a' });
    expect(queryByTestId('chat-thread-list.split')).toBeNull();
    expect(getByTestId('chat-thread-card.a').props.accessibilityState).toEqual({ selected: false });
  });

  it('nudges first-run users toward the guide until dismissed, and remembers it', async () => {
    seed([summary('m', 'model')]);
    const first = render(<ChatThreadListScreen />);
    await waitFor(() => expect(first.getByTestId('chat-thread-list.guide-nudge')).toBeTruthy());
    expect(first.getByTestId('chat-thread-list.button.guide')).toBeTruthy();

    fireEvent.press(first.getByTestId('chat-thread-list.guide-nudge.dismiss'));

    expect(first.queryByTestId('chat-thread-list.guide-nudge')).toBeNull();
    expect(await AsyncStorage.getItem(AGENT_GUIDE_DISMISSED_KEY)).toBe('true');
    first.unmount();

    const second = render(<ChatThreadListScreen />);
    await act(async () => { await Promise.resolve(); });
    expect(second.queryByTestId('chat-thread-list.guide-nudge')).toBeNull();
  });

  it('shows no nudge once an agent thread exists', async () => {
    seed([summary('a', 'agent')]);
    const { queryByTestId } = render(<ChatThreadListScreen />);
    await act(async () => { await Promise.resolve(); });
    expect(queryByTestId('chat-thread-list.guide-nudge')).toBeNull();
  });

  it('opens the demo thread from the guide', async () => {
    mockWidth = 600;
    seed([]);
    const { getByTestId } = render(<ChatThreadListScreen />);
    await waitFor(() => expect(getByTestId('chat-thread-list.guide-nudge.open')).toBeTruthy());

    fireEvent.press(getByTestId('chat-thread-list.guide-nudge.open'));
    fireEvent.press(getByTestId('mock-guide.demo'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('ChatScreen', { threadId: 'demo-1' }));
  });
});
