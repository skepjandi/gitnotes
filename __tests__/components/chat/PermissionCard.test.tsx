import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { PermissionCard } from '@/components/chat/PermissionCard';
import type { PermissionRequest } from '@/services/chat/types';

const request: PermissionRequest = {
  id: 'perm-1',
  toolCallId: 'tool-1',
  title: 'Run `rm -rf build`',
  description: 'The agent wants to delete the build directory.',
  options: [
    { id: 'allow-once', label: 'Allow once', kind: 'allow_once' },
    { id: 'allow-always', label: 'Always allow', kind: 'allow_always' },
    { id: 'reject-once', label: 'Reject', kind: 'reject_once' },
  ],
};

describe('PermissionCard', () => {
  it('shows the title, the description and one button per option', () => {
    const { getByTestId, getByText, queryAllByTestId } = render(
      <PermissionCard request={request} onResolve={jest.fn()} />,
    );

    expect(getByTestId('chat-permission.title').props.children).toBe('Run `rm -rf build`');
    expect(getByText('The agent wants to delete the build directory.')).toBeTruthy();
    expect(queryAllByTestId(/^chat-permission\.button\./)).toHaveLength(3);
  });

  it.each([
    ['allow-once', 'allow-once'],
    ['allow-always', 'allow-always'],
    ['reject-once', 'reject-once'],
  ])('resolves the request with the id of the pressed option (%s)', (testIdSuffix, optionId) => {
    const onResolve = jest.fn();
    const { getByTestId } = render(<PermissionCard request={request} onResolve={onResolve} />);

    fireEvent.press(getByTestId(`chat-permission.button.${testIdSuffix}`));

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith('perm-1', { optionId });
  });

  it('works for model tool confirmations that have no description', () => {
    const onResolve = jest.fn();
    const confirmation: PermissionRequest = {
      id: 'perm-2',
      title: 'Create note "Ideas"',
      options: [
        { id: 'apply', label: 'Apply', kind: 'allow_once' },
        { id: 'cancel', label: 'Cancel', kind: 'reject_once' },
      ],
    };
    const { getByTestId, queryByTestId } = render(<PermissionCard request={confirmation} onResolve={onResolve} />);

    expect(queryByTestId('chat-permission.description')).toBeNull();
    fireEvent.press(getByTestId('chat-permission.button.cancel'));
    expect(onResolve).toHaveBeenCalledWith('perm-2', { optionId: 'cancel' });
  });
});
