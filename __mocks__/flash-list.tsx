import React, { forwardRef, useRef, useState } from 'react';
import { FlatList, type FlatListProps } from 'react-native';

export const FlashList = forwardRef<FlatList, FlatListProps<unknown>>((props, ref) => (
  <FlatList ref={ref} {...props} />
));
FlashList.displayName = 'FlashList';

/** Mirrors FlashList's contract: state resets to `initial` when `deps` change (a recycled cell got new data). */
export function useRecyclingState<T>(initial: T, deps: React.DependencyList = []): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState(initial);
  const lastDeps = useRef(deps);
  if (deps.length !== lastDeps.current.length || deps.some((dep, index) => !Object.is(dep, lastDeps.current[index]))) {
    lastDeps.current = deps;
    setState(initial);
    return [initial, setState];
  }
  return [state, setState];
}
