/**
 * Tests for the SortPicker popup contract.
 *
 * The popup renders three field groups, each with two direction buttons laid
 * out with `flex: 1`. Those buttons only resolve to equal halves when the
 * shared modal surface carries a definite width, which the shared Modal
 * component guarantees for its fullWidth variant.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import SortPicker from '@/components/SortPicker';

const INITIAL_SORT = { field: 'modified', direction: 'desc' } as const;

const modalCalls: Record<string, unknown>[] = [];

jest.mock('@/components/ui', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const actual = jest.requireActual('@/components/ui');
  return {
    ...actual,
    Modal: (props: { visible: boolean; children?: React.ReactNode }) => {
      modalCalls.push(props as unknown as Record<string, unknown>);
      if (!props.visible) return null;
      return ReactActual.createElement(View, { testID: 'sort-picker-modal' }, props.children);
    },
  };
});

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

function renderPicker() {
  const onSortChange = jest.fn();
  modalCalls.length = 0;
  const view = render(
    <SortPicker
      currentSort={INITIAL_SORT}
      onSortChange={onSortChange}
      entityType="notes"
      size="bar"
      iconOnly
    />
  );
  return { ...view, onSortChange };
}

describe('SortPicker popup', () => {
  it('opens the popup as a full-width surface', async () => {
    const { getByTestId } = renderPicker();

    fireEvent.press(getByTestId('sort-picker-trigger'));

    await waitFor(() => expect(getByTestId('sort-option-modified-desc')).toBeTruthy());

    const openModal = modalCalls.find((call) => call.visible === true);
    expect(openModal).toBeDefined();
    expect(openModal?.fullWidth).toBe(true);
  });

  it('gives each direction button a flexible, centered hit target', async () => {
    const { getByTestId } = renderPicker();

    fireEvent.press(getByTestId('sort-picker-trigger'));

    await waitFor(() => expect(getByTestId('sort-option-modified-desc')).toBeTruthy());

    const optionStyle = flattenStyle(getByTestId('sort-option-modified-desc').props.style);
    expect(optionStyle.flex).toBe(1);
    expect(optionStyle.alignItems).toBe('center');
  });

  it('offers both directions for every sort field', async () => {
    const { getByTestId } = renderPicker();

    fireEvent.press(getByTestId('sort-picker-trigger'));

    await waitFor(() => expect(getByTestId('sort-option-modified-desc')).toBeTruthy());

    for (const field of ['modified', 'created', 'title']) {
      expect(getByTestId(`sort-option-${field}-asc`)).toBeTruthy();
      expect(getByTestId(`sort-option-${field}-desc`)).toBeTruthy();
    }
  });

  it('reports the chosen direction and closes the popup', async () => {
    const { getByTestId, queryByTestId, onSortChange } = renderPicker();

    fireEvent.press(getByTestId('sort-picker-trigger'));

    await waitFor(() => expect(getByTestId('sort-option-title-asc')).toBeTruthy());

    fireEvent.press(getByTestId('sort-option-title-asc'));

    expect(onSortChange).toHaveBeenCalledWith({ field: 'title', direction: 'asc' });
    await waitFor(() => expect(queryByTestId('sort-option-title-asc')).toBeNull());
    expect(modalCalls.some((call) => call.visible === false)).toBe(true);
  });
});
