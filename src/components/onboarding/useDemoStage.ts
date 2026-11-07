import { useEffect, useState } from 'react';

interface DemoStageOptions {
  readonly stages: number;
  readonly stepMs: number;
  readonly endDwellMs?: number;
  /** Stage shown, and held, when reduced motion is on. Defaults to the last. */
  readonly restStage?: number;
  readonly reduceMotion: boolean;
}

/**
 * Drives a looping scripted demo. Returns the current stage index in
 * `[0, stages)`; the last stage dwells for `endDwellMs` before the loop
 * restarts. With reduced motion the demo holds `restStage`, which each demo
 * draws as a complete, self-explanatory state.
 */
export function useDemoStage({
  stages,
  stepMs,
  endDwellMs = 1800,
  restStage = stages - 1,
  reduceMotion,
}: DemoStageOptions): number {
  const lastStage = stages - 1;
  const [stage, setStage] = useState(reduceMotion ? restStage : 0);

  useEffect(() => {
    if (reduceMotion) {
      setStage(restStage);
      return undefined;
    }
    const delay = stage === lastStage ? endDwellMs : stepMs;
    const timer = setTimeout(() => setStage((current) => (current + 1) % stages), delay);
    return () => clearTimeout(timer);
  }, [stage, stages, stepMs, endDwellMs, reduceMotion, lastStage, restStage]);

  return stage;
}
