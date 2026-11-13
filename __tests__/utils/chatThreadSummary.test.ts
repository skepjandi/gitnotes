import { buildThreadSummary } from '@/utils/chatThreadSummary';
import type { ChatThread } from '@/models/Chat';

const makeThread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: 't1',
  title: 'T',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  repoOwner: '',
  repoName: '',
  branch: '',
  filePath: '',
  ...overrides,
});

describe('buildThreadSummary backends', () => {
  it('carries agent name and cwd', () => {
    const summary = buildThreadSummary(
      makeThread({ backend: { type: 'agent', bridgeId: 'b', agentId: 'a', agentName: 'Claude', cwd: '/w/app' } }),
    );
    expect(summary).toMatchObject({ backend: 'agent', agentName: 'Claude', cwd: '/w/app' });
  });

  it('marks demo threads and omits backend for model threads', () => {
    expect(buildThreadSummary(makeThread({ backend: { type: 'demo' } })).backend).toBe('demo');
    expect(buildThreadSummary(makeThread()).backend).toBeUndefined();
  });
});
