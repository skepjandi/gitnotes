import { WebSocket as WsSocket } from 'ws';
import type { ChatMessage, ChatThread, ThreadBackend } from '../../src/models/Chat';
import type { AgentBridge } from '../../src/services/agent/types';
import type {
  ChatEvent,
  ChatRunInput,
  DistributiveOmit,
  ElicitationRequest,
  ElicitationResult,
  PermissionDecision,
  PermissionRequest,
} from '../../src/services/chat/types';
import { useAgentBridgeStore } from '../../src/stores/agentBridgeStore';
import type { FakeBridge } from './fakeBridge';

export type AgentBackendState = Extract<ThreadBackend, { type: 'agent' }>;

/** React Native's global `WebSocket` is what production code opens; tests point it at `ws`. */
export function installNodeWebSocket(): () => void {
  const target = globalThis as { WebSocket?: unknown };
  const previous = target.WebSocket;
  target.WebSocket = WsSocket;
  return () => {
    target.WebSocket = previous;
  };
}

export async function pairFakeBridge(bridge: FakeBridge): Promise<AgentBridge> {
  return useAgentBridgeStore.getState().addBridge({ name: 'Fake host', url: bridge.url, token: bridge.token });
}

export function userMessage(text: string): ChatMessage {
  return { id: `user-${text}`, role: 'user', content: text, timestamp: 1, kind: 'text' };
}

export function agentThread(bridgeId: string, backend: Partial<AgentBackendState> = {}, text = 'hello'): ChatThread {
  return {
    id: 'thread-1',
    title: 'Agent chat',
    messages: [userMessage(text)],
    createdAt: 1,
    updatedAt: 1,
    repoOwner: '',
    repoName: '',
    branch: '',
    filePath: '',
    backend: { type: 'agent', bridgeId, agentId: 'fake', agentName: 'Fake Agent', cwd: '/work', ...backend },
  };
}

export interface TestRunInput extends ChatRunInput {
  controller: AbortController;
  permissionRequests: Array<Omit<PermissionRequest, 'id'>>;
  elicitationRequests: Array<DistributiveOmit<ElicitationRequest, 'id'>>;
  statuses: Array<string | null>;
}

type DecideElicitation = (request: DistributiveOmit<ElicitationRequest, 'id'>) => Promise<ElicitationResult> | ElicitationResult;

type Decide = (request: Omit<PermissionRequest, 'id'>) => Promise<PermissionDecision> | PermissionDecision;

/** `requestPermission` answers with `decide` (default: first option) and resolves `{ optionId: null }` on abort, like the real session. */
export function runInput(thread: ChatThread, options: { text?: string; decide?: Decide; decideElicitation?: DecideElicitation } = {}): TestRunInput {
  const controller = new AbortController();
  const permissionRequests: Array<Omit<PermissionRequest, 'id'>> = [];
  const elicitationRequests: Array<DistributiveOmit<ElicitationRequest, 'id'>> = [];
  const statuses: Array<string | null> = [];
  const decideElicitation: DecideElicitation = options.decideElicitation ?? (() => ({ action: 'cancel' }));
  const decide: Decide = options.decide ?? ((request) => ({ optionId: request.options[0]?.id ?? null }));
  return {
    thread,
    userText: options.text ?? 'hello',
    contexts: [],
    images: [],
    signal: controller.signal,
    controller,
    permissionRequests,
    elicitationRequests,
    statuses,
    requestPermission: (request) => {
      permissionRequests.push(request);
      const aborted = new Promise<PermissionDecision>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ optionId: null }), { once: true });
      });
      return Promise.race([Promise.resolve(decide(request)), aborted]);
    },
    requestElicitation: (request) => {
      elicitationRequests.push(request);
      const aborted = new Promise<ElicitationResult>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true });
      });
      return Promise.race([Promise.resolve(decideElicitation(request)), aborted]);
    },
    reportStatus: (status) => {
      statuses.push(status);
    },
  };
}

export async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

/** Like `collect`, but keeps the events that arrived before a failure. */
export async function drive(events: AsyncIterable<ChatEvent>): Promise<{ events: ChatEvent[]; error: Error | null }> {
  const collected: ChatEvent[] = [];
  try {
    for await (const event of events) collected.push(event);
  } catch (error) {
    return { events: collected, error: error instanceof Error ? error : new Error(String(error)) };
  }
  return { events: collected, error: null };
}

/** Applies `agent-state` events and the replay cursor the way the chat session persists them. */
export function foldBackend(backend: AgentBackendState, events: ChatEvent[]): AgentBackendState {
  const folded: AgentBackendState = { ...backend };
  for (const event of events) {
    if (event.seq !== undefined) folded.lastSeq = event.seq;
    if (event.type === 'agent-state') {
      if (event.sessionId !== undefined) folded.sessionId = event.sessionId;
      if (event.connectionId !== undefined) folded.connectionId = event.connectionId;
      if (event.modeId !== undefined) folded.modeId = event.modeId;
      if (event.availableModes !== undefined) folded.availableModes = event.availableModes;
      if (event.configOptions !== undefined) folded.configOptions = event.configOptions;
      if (event.supportsImages !== undefined) folded.supportsImages = event.supportsImages;
      if (typeof event.pendingPromptId === 'number') folded.pendingPromptId = event.pendingPromptId;
    }
    if (event.type === 'turn-end') delete folded.pendingPromptId;
  }
  return folded;
}

export function threadWithBackend(thread: ChatThread, backend: AgentBackendState): ChatThread {
  return { ...thread, backend };
}

export function textOf(events: ChatEvent[]): string {
  return events.flatMap((event) => (event.type === 'text-delta' ? [event.text] : [])).join('');
}

export function eventsOfType<T extends ChatEvent['type']>(
  events: ChatEvent[],
  type: T,
): Array<Extract<ChatEvent, { type: T }>> {
  return events.filter((event): event is Extract<ChatEvent, { type: T }> => event.type === type);
}

/** Event types without the bookkeeping `agent-state` events. */
export function visibleTypes(events: ChatEvent[]): string[] {
  return events.filter((event) => event.type !== 'agent-state').map((event) => event.type);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(10);
  }
}
