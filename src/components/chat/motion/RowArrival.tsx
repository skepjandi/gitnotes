import React, { type ReactNode } from 'react';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

export const ARRIVAL_MS = 180;

/** A transcript row fades in place when it first mounts; skipped when the OS asks for reduced motion. */
export function RowArrival({ children }: { children: ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(ARRIVAL_MS).reduceMotion(ReduceMotion.System)}>{children}</Animated.View>
  );
}
