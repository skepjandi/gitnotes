import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OAuthPermissionModal } from '../../../src/components/settings/OAuthPermissionModal';

jest.mock('../../../src/contexts/ThemeContext', () => ({
  useTokens: () => ({
    colors: {
      text: '#111',
      textSecondary: '#666',
      border: '#ddd',
    },
  }),
}));

jest.mock('../../../src/components/ui', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? <View testID="oauth-modal">{children}</View> : null,
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <TouchableOpacity testID={testID} onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    Toggle: ({ value, onValueChange, testID }: { value: boolean; onValueChange: (value: boolean) => void; testID?: string }) => (
      <TouchableOpacity testID={testID} accessibilityState={{ checked: value }} onPress={() => onValueChange(!value)} />
    ),
  };
});

describe('OAuthPermissionModal', () => {
  test('confirms profile and repository scopes by default', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <OAuthPermissionModal visible onClose={jest.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.press(getByTestId('oauth-permissions.continue'));

    expect(onConfirm).toHaveBeenCalledWith(['read:user', 'repo']);
  });

  test('allows repository access to be removed before continuing', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <OAuthPermissionModal visible onClose={jest.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.press(getByTestId('oauth-permissions.repositories'));
    fireEvent.press(getByTestId('oauth-permissions.continue'));

    expect(onConfirm).toHaveBeenCalledWith(['read:user']);
  });
});
