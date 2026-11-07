import type { ChatThread } from '../../../models/Chat';
import type { ChatBackend } from '../types';
import { agentBackend } from './agentBackend';
import { modelBackend } from './modelBackend';

export function resolveBackend(thread: ChatThread): ChatBackend {
  return thread.backend?.type === 'agent' ? agentBackend : modelBackend;
}
