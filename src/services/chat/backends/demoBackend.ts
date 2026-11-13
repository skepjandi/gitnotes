import type { ChatBackend, ChatEvent, ChatRunInput } from '../types';
import { DEMO_SCENARIOS, type DemoScenario } from './demoScript';

const DEFAULT_DELAY_MS = 25;
let delayMs = DEFAULT_DELAY_MS;

/** Test hook: overrides the pause between scripted events. */
export function setDemoDelay(ms: number): void {
  delayMs = ms;
}

function pause(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish);
  });
}

function scenarioFor(input: ChatRunInput): DemoScenario {
  const userTurns = input.thread.messages.filter((message) => message.role === 'user').length;
  return DEMO_SCENARIOS[Math.max(0, userTurns - 1) % DEMO_SCENARIOS.length];
}

async function* runScenario(input: ChatRunInput): AsyncGenerator<ChatEvent> {
  const { signal } = input;
  const scenario = scenarioFor(input);
  const turn = input.thread.messages.length;
  const readId = `demo-read-${turn}`;
  const editId = `demo-edit-${turn}`;
  const execId = `demo-exec-${turn}`;

  const step = async function* (events: ChatEvent[]): AsyncGenerator<ChatEvent, boolean> {
    await pause(signal);
    if (signal.aborted) return false;
    yield* events;
    return true;
  };

  const steps: ChatEvent[][] = [
    [{ type: 'thought-delta', text: scenario.thought }],
    [{ type: 'plan', entries: scenario.plan }],
    [
      {
        type: 'tool-start',
        toolCallId: readId,
        patch: {
          name: 'read',
          title: `Read ${scenario.read.path}`,
          kind: 'read',
          status: 'running',
          locations: [{ path: scenario.read.path }],
        },
      },
    ],
    [{ type: 'tool-update', toolCallId: readId, patch: { status: 'completed', result: scenario.read.content } }],
    [
      {
        type: 'tool-start',
        toolCallId: editId,
        patch: {
          name: 'edit',
          title: scenario.edit.title,
          kind: 'edit',
          status: 'running',
          locations: [{ path: scenario.edit.path }],
        },
      },
    ],
    [{ type: 'tool-update', toolCallId: editId, patch: { status: 'completed', diffs: [scenario.edit.diff] } }],
  ];

  for (const events of steps) {
    if (!(yield* step(events))) {
      yield { type: 'turn-end', stopReason: 'cancelled' };
      return;
    }
  }

  yield {
    type: 'tool-start',
    toolCallId: execId,
    patch: {
      name: 'execute',
      title: `Run ${scenario.command}`,
      kind: 'execute',
      status: 'awaiting-approval',
      args: { command: scenario.command },
    },
  };
  const decision = await input.requestPermission({
    toolCallId: execId,
    title: `Run ${scenario.command}`,
    description: scenario.command,
    options: [
      { id: 'allow', label: 'Allow', kind: 'allow_once' },
      { id: 'deny', label: 'Deny', kind: 'reject_once' },
    ],
  });
  if (signal.aborted || decision.optionId === null) {
    yield { type: 'tool-update', toolCallId: execId, patch: { status: 'rejected' } };
    yield { type: 'turn-end', stopReason: 'cancelled' };
    return;
  }
  const allowed = decision.optionId === 'allow';
  if (allowed) {
    yield { type: 'tool-update', toolCallId: execId, patch: { status: 'running' } };
    await pause(signal);
    yield {
      type: 'tool-update',
      toolCallId: execId,
      patch: { status: 'completed', result: 'Tests: 4 passed, 4 total' },
    };
  } else {
    yield { type: 'tool-update', toolCallId: execId, patch: { status: 'rejected' } };
  }

  for (const chunk of scenario.reply) {
    await pause(signal);
    if (signal.aborted) {
      yield { type: 'turn-end', stopReason: 'cancelled' };
      return;
    }
    yield { type: 'text-delta', text: chunk };
  }
  if (!allowed) yield { type: 'text-delta', text: ' (Skipped running the tests.)' };
  yield { type: 'turn-end', stopReason: signal.aborted ? 'cancelled' : 'end_turn' };
}

export const demoBackend: ChatBackend = {
  type: 'demo',
  run: runScenario,
};
