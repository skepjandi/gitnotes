import { mapSessionUpdate, mapToolCallPatch } from '../../../src/services/agent/acpMapper';
import type { AcpSessionUpdate } from '../../../src/services/agent/acpTypes';

describe('mapSessionUpdate', () => {
  it('maps text and thought chunks, replacing non-text blocks with short placeholders', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi ' } })).toEqual([
      { type: 'text-delta', text: 'Hi ' },
    ]);
    expect(mapSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } })).toEqual([
      { type: 'thought-delta', text: 'hmm' },
    ]);
    expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } })).toEqual([
      { type: 'text-delta', text: '[image]' },
    ]);
    expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'resource_link', uri: 'file:///a.ts', name: 'a.ts' } })).toEqual([
      { type: 'text-delta', text: '[resource: a.ts]' },
    ]);
  });

  it('drops empty chunks and variants the app does not render', () => {
    const ignored: AcpSessionUpdate[] = [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } },
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'replayed' } },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'config_option_update', configOptions: [] },
      { sessionUpdate: 'something_from_the_future', payload: 1 },
    ];
    for (const update of ignored) expect(mapSessionUpdate(update)).toEqual([]);
  });

  it('maps a tool call with kind, status, diffs, locations and output text', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Edit src/a.ts',
      kind: 'edit',
      status: 'in_progress',
      rawInput: { path: '/work/src/a.ts' },
      locations: [{ path: '/work/src/a.ts', line: 3 }, { path: '/work/src/b.ts', line: null }],
      content: [
        { type: 'diff', path: '/work/src/a.ts', oldText: 'a', newText: 'b' },
        { type: 'diff', path: '/work/src/new.ts', newText: 'fresh' },
        { type: 'content', content: { type: 'text', text: 'done' } },
        { type: 'terminal', terminalId: 't1' },
      ],
    });
    expect(events).toEqual([
      {
        type: 'tool-start',
        toolCallId: 'call_1',
        patch: {
          name: 'Edit src/a.ts',
          title: 'Edit src/a.ts',
          kind: 'edit',
          status: 'running',
          args: { path: '/work/src/a.ts' },
          diffs: [
            { path: '/work/src/a.ts', oldText: 'a', newText: 'b' },
            { path: '/work/src/new.ts', oldText: null, newText: 'fresh' },
          ],
          result: 'done\n[terminal]',
          locations: [{ path: '/work/src/a.ts', line: 3 }, { path: '/work/src/b.ts' }],
        },
      },
    ]);
  });

  it('prefers the tool name over the title and falls back to the kind', () => {
    const named = mapSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'a', name: 'read_file', title: 'Reading', kind: 'read' });
    expect(named[0]).toMatchObject({ patch: { name: 'read_file', title: 'Reading' } });
    const untitled = mapSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'b', kind: 'search' });
    expect(untitled[0]).toMatchObject({ patch: { name: 'search' } });
    const bare = mapSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c' });
    expect(bare[0]).toMatchObject({ patch: { name: 'tool' } });
  });

  it('only patches the fields a tool_call_update carries', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed' })).toEqual([
      { type: 'tool-update', toolCallId: 'call_1', patch: { status: 'completed' } },
    ]);
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'failed', title: null })).toEqual([
      { type: 'tool-update', toolCallId: 'call_1', patch: { status: 'failed' } },
    ]);
  });

  it('replaces the result and diffs when content is present and falls back to rawOutput', () => {
    const cleared = mapSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'x', content: [] });
    expect(cleared).toEqual([{ type: 'tool-update', toolCallId: 'x', patch: { diffs: [], result: '' } }]);

    const raw = mapSessionUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'x', rawOutput: { exitCode: 0 } });
    expect(raw).toEqual([{ type: 'tool-update', toolCallId: 'x', patch: { result: '{\n  "exitCode": 0\n}' } }]);
  });

  it('normalises unknown tool kinds and statuses', () => {
    const [event] = mapSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'x',
      kind: 'teleport' as never,
      status: 'exploded' as never,
    });
    expect(event).toEqual({ type: 'tool-update', toolCallId: 'x', patch: { kind: 'other' } });
  });

  it('truncates very large tool output', () => {
    const patch = mapToolCallPatch({
      toolCallId: 'big',
      content: [{ type: 'content', content: { type: 'text', text: 'x'.repeat(50_000) } }],
    });
    expect(patch.result?.length).toBeLessThan(21_000);
    expect(patch.result?.endsWith('[truncated]')).toBe(true);
  });

  it('wraps non-object raw input so args stay a record', () => {
    expect(mapToolCallPatch({ toolCallId: 'a', rawInput: 'ls -la' }).args).toEqual({ input: 'ls -la' });
    expect(mapToolCallPatch({ toolCallId: 'a', rawInput: ['a'] }).args).toEqual({ input: ['a'] });
    expect(mapToolCallPatch({ toolCallId: 'a', rawInput: null }).args).toBeUndefined();
  });

  it('maps plans, defaulting bad statuses and dropping bad priorities', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'plan',
        entries: [
          { content: 'Read code', status: 'completed', priority: 'high' },
          { content: 'Write fix', status: 'weird' as never, priority: 'urgent' as never },
          { status: 'pending' } as never,
        ],
      }),
    ).toEqual([
      {
        type: 'plan',
        entries: [
          { content: 'Read code', status: 'completed', priority: 'high' },
          { content: 'Write fix', status: 'pending' },
        ],
      },
    ]);
  });

  it('maps a mode change to agent state', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toEqual([
      { type: 'agent-state', modeId: 'plan' },
    ]);
    expect(mapSessionUpdate({ sessionUpdate: 'current_mode_update' })).toEqual([]);
  });

  it('ignores tool updates without an id instead of throwing', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call', title: 'no id' })).toEqual([]);
    expect(mapSessionUpdate({ sessionUpdate: 'tool_call_update' })).toEqual([]);
  });
});
