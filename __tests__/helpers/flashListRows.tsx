import React, { Fragment, forwardRef, useImperativeHandle, useState } from 'react';
import { View } from 'react-native';

/** Rows are never recycled here, so this is plain state. */
export function useRecyclingState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  return useState(initial);
}

interface RowsProps {
  data?: readonly unknown[] | null;
  renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
}

/**
 * The shared FlashList mock renders through FlatList, which jest's react-native preset turns into
 * an empty host view. Chat tests need the rows themselves, so this one renders every item.
 */
export const FlashList = forwardRef<{ scrollToEnd: () => void; scrollToIndex: () => void }, RowsProps>(
  ({ data, renderItem, keyExtractor }, ref) => {
    useImperativeHandle(ref, () => ({ scrollToEnd: jest.fn(), scrollToIndex: jest.fn() }));
    return (
      <View>
        {(data ?? []).map((item, index) => (
          <Fragment key={keyExtractor ? keyExtractor(item, index) : index}>{renderItem({ item, index })}</Fragment>
        ))}
      </View>
    );
  },
);
FlashList.displayName = 'FlashListRows';
