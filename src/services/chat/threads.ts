import type { ChatThread } from '../../models/Chat';
import { folderName } from '../../components/agent/format';
import type { AgentBridge, BridgeSessionInfo } from '../agent/types';
import { useAIStore } from '../../stores/aiStore';
import { useChatStore } from '../../stores/chatStore';
import { DEFAULT_CHAT_TITLE } from '../../utils/chatThreadSummary';
import { chatT } from './copy';
import { DEMO_CONFIG_OPTIONS } from './backends/demoScript';
import { seedChatSession } from './sessions';
import { localThreadStorage } from './storage/localThreadStorage';
import { generateId } from '../../utils/ids';
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

export const findAgentThreadIdsByConnection: ChatThreadApi['findAgentThreadIdsByConnection'] = async (bridgeId) => {
  const found = new Map<string, string>();
  const summaries = useChatStore.getState().threads.filter((summary) => summary.backend === 'agent');
  for (const summary of summaries) {
    const thread = await localThreadStorage.load(summary.id);
    const backend = thread?.backend;
    if (backend?.type === 'agent' && backend.bridgeId === bridgeId && backend.connectionId) {
      found.set(backend.connectionId, summary.id);
    }
  }
  return found;
};

export const adoptAgentSession: ChatThreadApi['adoptAgentSession'] = async (bridge: AgentBridge, session: BridgeSessionInfo) => {
  const { cwd, sessionId } = session;
  if (cwd === null || sessionId === null) throw new Error(chatT('chat.adoptNoSession'));

  const existingId = (await findAgentThreadIdsByConnection(bridge.id)).get(session.connectionId);
  if (existingId) {
    const existing = await localThreadStorage.load(existingId);
    if (existing) return existing;
  }

  const now = Date.now();
  const thread: ChatThread = {
    id: newThreadId(now),
    title: `${folderName(cwd)} · ${session.agentName}`,
    messages: [
      {
        id: generateId(),
        role: 'system',
        content: chatT('chat.adoptedNotice', { agent: session.agentName, folder: folderName(cwd) }),
        timestamp: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    repoOwner: '',
    repoName: '',
    branch: '',
    filePath: '',
    backend: {
      type: 'agent',
      bridgeId: bridge.id,
      agentId: session.agentId,
      agentName: session.agentName,
      cwd,
      sessionId,
      connectionId: session.connectionId,
      lastSeq: session.headSeq,
    },
  };
  await localThreadStorage.save(thread);
  seedChatSession(thread);
  useChatStore.getState().upsertSummary(thread);
  return thread;
};

export const createDemoThread: ChatThreadApi['createDemoThread'] = async () => {
  const now = Date.now();
  const thread: ChatThread = {
    id: newThreadId(now),
    title: chatT('chat.demoTitle'),
    messages: [],
    createdAt: now,
    updatedAt: now,
    repoOwner: '',
    repoName: '',
    branch: '',
    filePath: '',
    backend: { type: 'demo', configOptions: DEMO_CONFIG_OPTIONS },
  };
  await localThreadStorage.save(thread);
  seedChatSession(thread);
  useChatStore.getState().upsertSummary(thread);
  return thread;
};
