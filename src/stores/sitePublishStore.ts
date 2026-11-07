import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { applySiteAccent, applySitePreset, createDefaultSiteConfig } from '../services/site/siteThemes';
import { normalizeSiteConfig, SiteConfig, SitePaletteKey, SitePresetId } from '../services/site/siteTypes';

export const SITE_PUBLISH_STORAGE_KEY = '@gitnotes:publish_site';

interface PersistedSitePublish {
  config: SiteConfig;
  noteIds: string[];
}

interface SitePublishState {
  config: SiteConfig;
  /** Notes chosen for publishing. Ids of deleted notes are ignored at build time. */
  noteIds: string[];
  hasHydrated: boolean;
}

interface SitePublishActions {
  hydrate: () => Promise<void>;
  updateConfig: (patch: Partial<SiteConfig>) => void;
  setPreset: (presetId: SitePresetId) => void;
  setAccent: (hex: string) => void;
  setPaletteColor: (mode: 'light' | 'dark', key: SitePaletteKey, hex: string) => void;
  toggleNote: (noteId: string) => void;
  setNoteIds: (noteIds: string[]) => void;
}

function persist(state: SitePublishState): void {
  const payload: PersistedSitePublish = { config: state.config, noteIds: state.noteIds };
  void AsyncStorage.setItem(SITE_PUBLISH_STORAGE_KEY, JSON.stringify(payload)).catch((error) => {
    console.warn('[sitePublishStore] persist failed', error);
  });
}

export const useSitePublishStore = create<SitePublishState & SitePublishActions>((set, get) => {
  const commit = (next: Partial<SitePublishState>) => {
    set(next);
    persist(get());
  };

  return {
    config: createDefaultSiteConfig(),
    noteIds: [],
    hasHydrated: false,

    hydrate: async () => {
      if (get().hasHydrated) return;
      try {
        const raw = await AsyncStorage.getItem(SITE_PUBLISH_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedSitePublish>;
          set({
            config: normalizeSiteConfig(parsed.config, createDefaultSiteConfig()),
            noteIds: Array.isArray(parsed.noteIds) ? parsed.noteIds.filter((id) => typeof id === 'string') : [],
          });
        }
      } catch (error) {
        console.warn('[sitePublishStore] hydrate failed; using defaults', error);
      }
      set({ hasHydrated: true });
    },

    updateConfig: (patch) => commit({ config: normalizeSiteConfig({ ...get().config, ...patch }, get().config) }),

    setPreset: (presetId) => commit({ config: applySitePreset(get().config, presetId) }),

    setAccent: (hex) => commit({ config: applySiteAccent(get().config, hex) }),

    setPaletteColor: (mode, key, hex) => {
      const { config } = get();
      commit({
        config: normalizeSiteConfig(
          { ...config, colors: { ...config.colors, [mode]: { ...config.colors[mode], [key]: hex } } },
          config,
        ),
      });
    },

    toggleNote: (noteId) => {
      const current = get().noteIds;
      commit({ noteIds: current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId] });
    },

    setNoteIds: (noteIds) => commit({ noteIds: Array.from(new Set(noteIds)) }),
  };
});
