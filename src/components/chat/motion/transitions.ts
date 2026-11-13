import { useMemo } from 'react';
import { FadeIn, FadeOut, LinearTransition, ReduceMotion, useReducedMotion } from 'react-native-reanimated';

export const TRANSITION_MS = 180;

/** Shared enter/exit/layout animations for chat rows; all `undefined` when the OS asks for reduced motion. */
export function useChatTransitions() {
  const reduced = useReducedMotion();
  return useMemo(
    () =>
      reduced
        ? { reduced, entering: undefined, exiting: undefined, layout: undefined }
        : {
            reduced,
            entering: FadeIn.duration(TRANSITION_MS).reduceMotion(ReduceMotion.System),
            exiting: FadeOut.duration(TRANSITION_MS).reduceMotion(ReduceMotion.System),
            layout: LinearTransition.duration(TRANSITION_MS).reduceMotion(ReduceMotion.System),
          },
    [reduced],
  );
}
