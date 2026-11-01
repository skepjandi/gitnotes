/**
 * Tests for the shared Modal surface layout contract.
 *
 * A `fullWidth` surface must carry a definite width: children laid out with
 * `flex: 1` collapse to zero width when every ancestor is width-auto, which
 * renders option rows unreadable.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { Modal } from '@/components/ui/Modal';

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flattenStyle(item) }),
      {}
    );
  }
  if (style && typeof style === 'object') {
    return style as Record<string, unknown>;
  }
  return {};
}

describe('Modal', () => {
  it('gives a fullWidth surface a definite width', () => {
    const { getByLabelText } = render(
      <Modal visible onRequestClose={() => undefined} fullWidth accessibilityLabel="surface">
        <Text>content</Text>
      </Modal>
    );

    const style = flattenStyle(getByLabelText('surface').props.style);
    expect(style.width).toBe('100%');
  });
});
