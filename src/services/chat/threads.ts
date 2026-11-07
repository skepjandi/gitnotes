import type { ChatThread } from '../../models/Chat';
import { useAIStore } from '../../stores/aiStore';
import { useChatStore } from '../../stores/chatStore';
import { DEFAULT_CHAT_TITLE } from '../../utils/chatThreadSummary';
import { chatT } from './copy';
import { seedChatSession } from './sessions';
import { localThreadStorage } from './storage/localThreadStorage';
import type { ChatThreadApi, CreateAgentThreadInput } from './types';

function newThreadId(now: number): string {
  return `${now}-${Math.random().toString(36).substring(2, 11)}`;
}

export const createModelThread: ChatThreadApi['createModelThread'] = async () => {
  const { chatRepoOwner, chatRepoName, chatRepoBranch } = useAIStore.getState();
  if (!chatRepoOwner || !chatRepoName) throw new Error(chatT('chat.storageRepoNotConfigured'));

  const now = Date.now();
  const thread: ChatThread = {
    id: newThreadId(now),
    title: DEFAULT_CHAT_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
    repoOwner: chatRepoOwner,
    repoName: chatRepoName,
    branch: chatRepoBranch || 'main',
    filePath: `chats/${now}.json`,
  };
  seedChatSession(thread);
  useChatStore.getState().upsertSummary(thread);
  return thread;
};

export const createAgentThread: ChatThreadApi['createAgentThread'] = async (input: CreateAgentThreadInput) => {
  const now = Date.now();
  const thread: ChatThread = {
    id: newThreadId(now),
    title: input.title?.trim() || DEFAULT_CHAT_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
    repoOwner: '',
    repoName: '',
    branch: '',
    filePath: '',
    backend: {
      type: 'agent',
      bridgeId: input.bridgeId,
      agentId: input.agentId,
      agentName: input.agentName,
      cwd: input.cwd,
    },
  };
  await localThreadStorage.save(thread);
  seedChatSession(thread);
  useChatStore.getState().upsertSummary(thread);
  return thread;
};
