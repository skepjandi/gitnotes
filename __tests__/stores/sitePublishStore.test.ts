import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDefaultSiteConfig } from '../../src/services/site/siteThemes';
import { SITE_PUBLISH_STORAGE_KEY, useSitePublishStore } from '../../src/stores/sitePublishStore';

function resetStore() {
  useSitePublishStore.setState({ config: createDefaultSiteConfig(), noteIds: [], hasHydrated: false });
}

async function persisted() {
  return JSON.parse((await AsyncStorage.getItem(SITE_PUBLISH_STORAGE_KEY)) ?? 'null');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetStore();
});

describe('sitePublishStore', () => {
  it('hydrates saved settings but sanitizes tampered or corrupt values', async () => {
    await AsyncStorage.setItem(
      SITE_PUBLISH_STORAGE_KEY,
      JSON.stringify({
        config: { title: 'Saved', presetsId: 'x', presetId: 'terminal', colors: { dark: { accent: 'url(javascript:1)' } }, contentWidth: 99999 },
        noteIds: ['a', 7, 'b'],
      }),
    );
    await useSitePublishStore.getState().hydrate();
    const { config, noteIds, hasHydrated } = useSitePublishStore.getState();
    expect(hasHydrated).toBe(true);
    expect(config.title).toBe('Saved');
    expect(config.presetId).toBe('terminal');
    expect(config.contentWidth).toBe(1100);
    expect(config.colors.dark.accent).toBe(createDefaultSiteConfig().colors.dark.accent);
    expect(noteIds).toEqual(['a', 'b']);
  });

  it('falls back to defaults when stored JSON is unreadable', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await AsyncStorage.setItem(SITE_PUBLISH_STORAGE_KEY, '{not json');
    await useSitePublishStore.getState().hydrate();
    warn.mockRestore();
    expect(useSitePublishStore.getState().config).toEqual(createDefaultSiteConfig());
    expect(useSitePublishStore.getState().hasHydrated).toBe(true);
  });

  it('persists selection changes and de-duplicates ids', async () => {
    const { toggleNote, setNoteIds } = useSitePublishStore.getState();
    toggleNote('a');
    toggleNote('b');
    toggleNote('a');
    expect(useSitePublishStore.getState().noteIds).toEqual(['b']);
    setNoteIds(['x', 'x', 'y']);
    expect((await persisted()).noteIds).toEqual(['x', 'y']);
  });

  it('keeps the design change when only a palette color is edited, and ignores invalid hex', () => {
    const { setPaletteColor } = useSitePublishStore.getState();
    const before = useSitePublishStore.getState().config.colors.light.background;
    setPaletteColor('light', 'text', '#112233');
    expect(useSitePublishStore.getState().config.colors.light.text).toBe('#112233');
    setPaletteColor('light', 'background', 'not-a-color');
    expect(useSitePublishStore.getState().config.colors.light.background).toBe(before);
  });

  it('switching preset keeps title and header links', () => {
    const { updateConfig, setPreset } = useSitePublishStore.getState();
    updateConfig({ title: 'Mine', navLinks: [{ label: 'Home', url: 'https://me.dev' }] });
    setPreset('brutalist');
    const { config } = useSitePublishStore.getState();
    expect(config.presetId).toBe('brutalist');
    expect(config.title).toBe('Mine');
    expect(config.navLinks).toEqual([{ label: 'Home', url: 'https://me.dev' }]);
  });
});
