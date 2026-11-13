import type { ChatThread } from '../../../models/Chat';
import type { ChatBackend } from '../types';
import { agentBackend } from './agentBackend';
import { demoBackend } from './demoBackend';
import { modelBackend } from './modelBackend';

export function resolveBackend(thread: ChatThread): ChatBackend {
  switch (thread.backend?.type) {
    case 'agent':
      return agentBackend;
    case 'demo':
      return demoBackend;
    default:
      return modelBackend;
  }
}
