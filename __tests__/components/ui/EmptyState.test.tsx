import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { EmptyState } from '../../../src/components/ui/EmptyState';

jest.unmock('../../../src/components/ui/EmptyState');

jest.mock('../../../src/contexts/ThemeContext', () => {
  const { FLAT_LIGHT: colors, RADII: radii, SPACING: spacing, TYPE: type } = jest.requireActual(
    '../../../src/theme/tokens',
  );
  return {
    useTheme: () => ({ colors, isDark: false, style: 'flat' }),
    useTokens: () => ({ colors, radii, spacing, type }),
  };
});

jest.mock('../../../src/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

describe('EmptyState', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(<EmptyState icon="document-text" title="No notes yet" subtitle="Create one" />);
    expect(getByText('No notes yet')).toBeTruthy();
    expect(getByText('Create one')).toBeTruthy();
  });

  it('announces title and subtitle as one text element', () => {
    const { getByLabelText } = render(<EmptyState icon="document-text" title="No notes yet" subtitle="Create one" />);
    expect(getByLabelText('No notes yet. Create one')).toBeTruthy();
  });

  it('fires onAction from the call-to-action', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <EmptyState icon="document-text" title="No notes yet" actionLabel="New Note" onAction={onAction} />,
    );
    fireEvent.press(getByText('New Note'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the call-to-action unless both label and handler are given', () => {
    const { queryByText, rerender } = render(
      <EmptyState icon="document-text" title="No notes yet" actionLabel="New Note" />,
    );
    expect(queryByText('New Note')).toBeNull();
    rerender(<EmptyState icon="document-text" title="No notes yet" onAction={jest.fn()} />);
    expect(queryByText('New Note')).toBeNull();
  });
});
