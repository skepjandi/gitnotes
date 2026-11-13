import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { bridgeTools } from '@/services/agent/bridgeTools';

import { MissionControlContent, MissionControlSheet } from '@/components/chat/mission/MissionControlSheet';
import type { Mission } from '@/components/chat/mission/selectMission';

jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: { features: jest.fn(), listPorts: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const mission: Mission = {
  sections: [
    {
      type: 'needsYou',
      requests: [
        {
          id: 'perm-1',
          title: 'Run build',
          options: [
            { id: 'allow', label: 'Allow', kind: 'allow_once' },
            { id: 'deny', label: 'Deny', kind: 'reject_once' },
          ],
        },
      ],
    },
    {
      type: 'changes',
      changes: [
        {
          path: 'a.ts',
          status: 'edited',
          added: 1,
          removed: 1,
          messageId: 't1',
          diff: { path: 'a.ts', oldText: 'x', newText: 'y' },
        },
      ],
    },
  ],
};

describe('MissionControlSheet', () => {
  it('resolves permissions from the needs-you buttons', () => {
    const onResolve = jest.fn();
    const { getByTestId } = render(
      <MissionControlSheet visible onClose={jest.fn()} mission={mission} onResolvePermission={onResolve} />,
    );
    fireEvent.press(getByTestId('chat-mission.button.perm-1.deny'));
    expect(onResolve).toHaveBeenCalledWith('perm-1', { optionId: 'deny' });
  });

  it('expands a change row into an inline diff', () => {
    const { getByTestId, queryByTestId } = render(
      <MissionControlSheet visible onClose={jest.fn()} mission={mission} onResolvePermission={jest.fn()} />,
    );
    expect(queryByTestId('chat-tool.diffs')).toBeNull();
    fireEvent.press(getByTestId('chat-mission.change-toggle.a.ts'));
    expect(getByTestId('chat-tool.diffs')).toBeTruthy();
  });

  it('shows a quiet empty line for an empty mission', () => {
    const { getByTestId } = render(
      <MissionControlSheet visible onClose={jest.fn()} mission={{ sections: [] }} onResolvePermission={jest.fn()} />,
    );
    expect(getByTestId('chat-mission.empty')).toBeTruthy();
  });

  it('renders MissionControlContent alone without a modal', () => {
    const onResolve = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <MissionControlContent mission={mission} onResolvePermission={onResolve} />,
    );
    expect(queryByTestId('chat-mission.sheet')).toBeNull();
    fireEvent.press(getByTestId('chat-mission.button.perm-1.allow'));
    expect(onResolve).toHaveBeenCalledWith('perm-1', { optionId: 'allow' });
  });

  it('renders agents and background sections with an expandable output tail', () => {
    const rich: Mission = {
      sections: [
        { type: 'agents', agents: [{ id: 'a1', description: 'Find usages', status: 'running', resultSummary: null }] },
        { type: 'background', commands: [{ id: 'b1', command: 'npm run dev', elapsedMs: 65_000, tail: 'ready on 3000' }] },
      ],
    };
    const { getByTestId, queryByTestId, getByText } = render(
      <MissionControlContent mission={rich} onResolvePermission={jest.fn()} />,
    );
    expect(getByTestId('chat-mission.subagent.a1')).toBeTruthy();
    expect(getByText('1m 5s')).toBeTruthy();
    expect(queryByTestId('chat-mission.background-tail.b1')).toBeNull();
    fireEvent.press(getByTestId('chat-mission.background-toggle.b1'));
    expect(getByTestId('chat-mission.background-tail.b1').props.children).toBe('ready on 3000');
  });

  it('offers Open in Review and a footer button only when wired to a bridge', () => {
    const onOpenReview = jest.fn();
    const bridge = { bridgeId: 'b', cwd: '/w' };
    const wired = render(
      <MissionControlContent mission={mission} onResolvePermission={jest.fn()} bridge={bridge} onOpenReview={onOpenReview} />,
    );
    fireEvent.press(wired.getByTestId('chat-mission.change-review.a.ts'));
    expect(onOpenReview).toHaveBeenCalledWith('a.ts');
    fireEvent.press(wired.getByTestId('chat-mission.review'));
    expect(onOpenReview).toHaveBeenLastCalledWith();
    wired.unmount();

    const bare = render(<MissionControlContent mission={mission} onResolvePermission={jest.fn()} onOpenReview={onOpenReview} />);
    expect(bare.queryByTestId('chat-mission.review')).toBeNull();
    expect(bare.queryByTestId('chat-mission.change-review.a.ts')).toBeNull();
  });

  it('shows listening ports from the bridge and copies the port number', async () => {
    (bridgeTools.features as jest.Mock).mockResolvedValue(['ports']);
    (bridgeTools.listPorts as jest.Mock).mockResolvedValue([{ port: 5173, process: 'vite' }]);
    const { findByTestId, getByTestId } = render(
      <MissionControlContent
        mission={{ sections: [] }}
        onResolvePermission={jest.fn()}
        bridge={{ bridgeId: 'b', cwd: '/w', connectionId: 'c1' }}
      />,
    );
    await act(async () => { /* noop */ });
    await findByTestId('chat-mission.port.5173');
    fireEvent.press(getByTestId('chat-mission.port.5173'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('5173');
  });
});
