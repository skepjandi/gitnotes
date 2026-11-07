import { useEffect, useState } from 'react';

import { Note } from '../models/Note';
import { buildSite } from '../services/site/siteBuilder';
import { SiteArtifact, SiteConfig } from '../services/site/siteTypes';

export interface SiteArtifactState {
  artifact: SiteArtifact | null;
  building: boolean;
  error: string | null;
}

/**
 * Builds the site whenever notes or config change (debounced so slider/color edits don't rebuild per frame).
 * Callers must pass a referentially stable `notes` array.
 */
export function useSiteArtifact(notes: Note[], config: SiteConfig, debounceMs = 250): SiteArtifactState {
  const [state, setState] = useState<SiteArtifactState>({ artifact: null, building: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, building: true }));
    const timer = setTimeout(() => {
      buildSite(notes, config)
        .then((artifact) => {
          if (!cancelled) setState({ artifact, building: false, error: null });
        })
        .catch((error: unknown) => {
          if (!cancelled) setState({ artifact: null, building: false, error: error instanceof Error ? error.message : String(error) });
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [notes, config, debounceMs]);

  return state;
}
