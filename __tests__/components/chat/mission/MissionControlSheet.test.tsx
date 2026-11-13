import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { MissionControlContent, MissionControlSheet } from '@/components/chat/mission/MissionControlSheet';
import type { Mission } from '@/components/chat/mission/selectMission';

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
});
