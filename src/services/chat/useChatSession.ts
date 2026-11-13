import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ChatMessage } from '../../models/Chat';
import { useAIStore } from '../../stores/aiStore';
import { checkContextBudget } from '../ai/modelLimits';
import { getChatSession } from './sessions';
import type { ChatSessionState, UseChatSessionResult } from './types';

const NO_MESSAGES: ChatMessage[] = [];

const BASE_PROMPT_BYTES = 600;

function estimateThreadBytes(messages: ChatMessage[]): number {
  let bytes = BASE_PROMPT_BYTES;
  for (const message of messages) {
    bytes += (message.content?.length ?? 0) + (message.toolCallResult?.length ?? 0);
    for (const context of message.attachedContexts ?? []) bytes += context.approxBytes || 0;
  }
  return bytes;
}

/**
 * Subscribes a screen to a thread's session. The session outlives the screen:
 * unmounting never aborts a running turn.
 */
export function useChatSession(threadId: string): UseChatSessionResult {
  const session = getChatSession(threadId);

  useEffect(() => {
    void session.ensureLoaded();
  }, [session]);

  const state: ChatSessionState = useStore(
    session.store,
    useShallow((s) => s),
  );
  const selectedModelId = useAIStore((s) => s.selectedModelId);

  const messages = state.thread?.messages ?? NO_MESSAGES;
  const isModelThread = state.thread !== null && state.thread.backend?.type !== 'agent';
  const settled = state.status === 'idle' || state.status === 'error';

  const contextBudget = useMemo(() => {
    if (!isModelThread) return null;
    const { warningLevel, message } = checkContextBudget(
      useAIStore.getState().getSelectedModel(),
      estimateThreadBytes(messages),
    );
    return { warningLevel, message };
    // Recomputed when the turn settles or a message is added, not for every streamed token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelThread, messages.length, settled, selectedModelId]);

  return useMemo(
    () => ({
      ...state,
      messages,
      contextBudget,
      send: session.send,
      stop: session.stop,
      cancelQueued: session.cancelQueued,
      retryQueued: session.retryQueued,
      retry: session.retry,
      editAndResend: session.editAndResend,
      regenerate: session.regenerate,
      resolvePermission: session.resolvePermission,
      setMode: session.setMode,
      dismissError: session.dismissError,
    }),
    [state, messages, contextBudget, session],
  );
}
