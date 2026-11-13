import type { AgentConfigOption, ImageAttachment } from '@/models/Chat';
import type { ElicitationRequest, ElicitationResult } from '@/services/chat/types';
import { ScriptedBackend, makeAgentThread, makeSession } from './helpers';

const tick = (ms = 60) => jest.advanceTimersByTimeAsync(ms);

const MODEL: AgentConfigOption = {
  id: 'model',
  name: 'Model',
  type: 'select',
  currentValue: 'sonnet',
  options: [
    { value: 'sonnet', name: 'Sonnet' },
    { value: 'opus', name: 'Opus' },
  ],
};

const image = (id: string): ImageAttachment => ({ id, uri: `file:///docs/${id}.png`, mimeType: 'image/png' });

const FORM: Parameters<NonNullable<ReturnType<typeof makeSession>['backend']['inputs'][number]['requestElicitation']>>[0] = {
  mode: 'form',
  message: 'Which?',
  fields: [{ key: 'a', label: 'A', required: true, kind: 'string' }],
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ChatSession images', () => {
  it('stores attachedImages on the user message and hands them to the backend', async () => {
    const h = makeSession(makeAgentThread());
    const sent = h.session.send('look', [], [image('i1')]);
    await tick(0);

    const thread = h.session.store.getState().thread;
    expect(thread?.messages[0]?.attachedImages).toEqual([image('i1')]);
    expect(h.backend.inputs[0]?.images).toEqual([image('i1')]);
    h.backend.end();
    await sent;
  });

  it('omits attachedImages when none are given', async () => {
    const h = makeSession(makeAgentThread());
    const sent = h.session.send('plain', []);
    await tick(0);
    expect(h.session.store.getState().thread?.messages[0]).not.toHaveProperty('attachedImages');
    h.backend.end();
    await sent;
  });

  it('refuses more than five images with an error and sends nothing', async () => {
    const h = makeSession(makeAgentThread());
    await h.session.send('many', [], ['1', '2', '3', '4', '5', '6'].map(image));
    expect(h.backend.inputs).toHaveLength(0);
    expect(h.session.store.getState().error).toBeTruthy();
  });

  it('carries images through the queue to the later turn', async () => {
    const h = makeSession(makeAgentThread());
    const first = h.session.send('one', []);
    await tick(0);
    await h.session.send('two', [], [image('q1')]);
    expect(h.session.store.getState().queuedPrompts[0]?.images).toEqual([image('q1')]);

    h.backend.end();
    await tick(0);
    expect(h.backend.inputs).toHaveLength(2);
    expect(h.backend.inputs[1]?.images).toEqual([image('q1')]);
    expect(h.session.store.getState().thread?.messages.find((m) => m.content === 'two')?.attachedImages).toEqual([image('q1')]);
    h.backend.end();
    await tick();
    await first;
  });

  it('keeps images when a user message is regenerated', async () => {
    const h = makeSession(makeAgentThread());
    const first = h.session.send('look', [], [image('i1')]);
    await tick(0);
    h.backend.end();
    await first;

    const id = h.session.store.getState().thread?.messages[0]?.id ?? '';
    const again = h.session.regenerate(id);
    await tick(0);
    expect(h.backend.inputs[1]?.images).toEqual([image('i1')]);
    h.backend.end();
    await again;
  });
});

describe('ChatSession elicitation', () => {
  async function start(): Promise<{ h: ReturnType<typeof makeSession>; sent: Promise<void>; pending: Promise<ElicitationResult> }> {
    const h = makeSession(makeAgentThread());
    const sent = h.session.send('go', []);
    await tick(0);
    const pending = h.backend.inputs[0]?.requestElicitation(FORM) as Promise<ElicitationResult>;
    return { h, sent, pending };
  }

  it('exposes the question while the turn waits, then resolves with the answer', async () => {
    const { h, sent, pending } = await start();
    const state = h.session.store.getState();
    expect(state.pendingElicitations).toHaveLength(1);
    expect(state.status).toBe('awaiting-permission');

    const request: ElicitationRequest = state.pendingElicitations[0] as ElicitationRequest;
    h.session.resolveElicitation(request.id, { action: 'accept', content: { a: 'x' } });
    await expect(pending).resolves.toEqual({ action: 'accept', content: { a: 'x' } });
    expect(h.session.store.getState()).toMatchObject({ pendingElicitations: [], status: 'running' });

    h.backend.end();
    await sent;
  });

  it.each([{ action: 'decline' as const }, { action: 'cancel' as const }])('passes %j through', async (result) => {
    const { h, sent, pending } = await start();
    h.session.resolveElicitation(h.session.store.getState().pendingElicitations[0]?.id ?? '', result);
    await expect(pending).resolves.toEqual(result);
    h.backend.end();
    await sent;
  });

  it('cancels open questions when the turn is stopped', async () => {
    const { h, sent, pending } = await start();
    h.session.stop();
    await expect(pending).resolves.toEqual({ action: 'cancel' });
    expect(h.session.store.getState().pendingElicitations).toEqual([]);
    await tick();
    await sent;
  });

  it('answers cancel right away when the turn is already aborted', async () => {
    const { h, sent } = await start();
    h.session.stop();
    await tick();
    await sent;
    const late = await h.backend.inputs[0]?.requestElicitation(FORM);
    expect(late).toEqual({ action: 'cancel' });
    expect(h.session.store.getState().pendingElicitations).toEqual([]);
  });

  it('ignores an unknown question id', async () => {
    const { h, sent } = await start();
    h.session.resolveElicitation('nope', { action: 'decline' });
    expect(h.session.store.getState().pendingElicitations).toHaveLength(1);
    h.backend.end();
    h.session.stop();
    await tick();
    await sent;
  });

  it('keeps awaiting while a permission is still open after the question is answered', async () => {
    const { h, sent } = await start();
    void h.backend.inputs[0]?.requestPermission({ toolCallId: 't', title: 'x', options: [{ id: 'a', label: 'A', kind: 'allow_once' }] });
    await tick(0);
    h.session.resolveElicitation(h.session.store.getState().pendingElicitations[0]?.id ?? '', { action: 'decline' });
    expect(h.session.store.getState().status).toBe('awaiting-permission');
    h.session.stop();
    await tick();
    await sent;
  });
});

describe('ChatSession agent state', () => {
  it('stores the config options and capabilities the agent reports', async () => {
    const h = makeSession(makeAgentThread());
    const sent = h.session.send('go', []);
    await tick(0);
    h.backend.push({
      type: 'agent-state',
      configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue: 'opus', options: [] }],
      supportsImages: true,
    });
    await tick(0);
    const backend = h.session.store.getState().thread?.backend;
    expect(backend?.type === 'agent' && backend.configOptions?.[0]?.currentValue).toBe('opus');
    expect(backend?.type === 'agent' && backend.supportsImages).toBe(true);
    h.backend.end();
    await sent;
  });
});

describe('ChatSession setConfigOption', () => {
  function configured(setter: ScriptedBackend['setConfigOption']) {
    const thread = makeAgentThread();
    if (thread.backend?.type !== 'agent') throw new Error('agent');
    thread.backend.configOptions = [MODEL];
    const backend = new ScriptedBackend('agent');
    backend.setConfigOption = setter;
    return makeSession(thread, { backend });
  }

  const selected = (h: ReturnType<typeof makeSession>) => {
    const backend = h.session.store.getState().thread?.backend;
    return backend?.type === 'agent' ? backend.configOptions?.[0]?.currentValue : undefined;
  };

  it('applies the value optimistically, adopts the agent list and persists', async () => {
    const reported: AgentConfigOption[] = [{ ...MODEL, currentValue: 'opus' }];
    let seenWhileWaiting: unknown;
    let release: () => void = () => undefined;
    const h = configured(async () => {
      seenWhileWaiting = selected(h);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return reported;
    });

    const pending = h.session.setConfigOption('model', 'opus');
    await tick(0);
    expect(seenWhileWaiting).toBe('opus');
    release();
    await pending;
    await tick(0);

    expect(selected(h)).toBe('opus');
    const saved = h.storage.last.backend;
    expect(saved?.type === 'agent' && saved.configOptions?.[0]?.currentValue).toBe('opus');
  });

  it('rolls back and reports the error when the agent refuses', async () => {
    const h = configured(async () => {
      throw new Error('model unavailable');
    });
    await h.session.setConfigOption('model', 'opus');
    expect(selected(h)).toBe('sonnet');
    expect(h.session.store.getState().error).toBe('model unavailable');
  });

  it('ignores unknown option ids', async () => {
    const setter = jest.fn();
    const h = configured(setter);
    await h.session.setConfigOption('nope', 'x');
    expect(setter).not.toHaveBeenCalled();
  });
});
