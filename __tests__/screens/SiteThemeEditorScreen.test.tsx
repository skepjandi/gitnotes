import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import SiteThemeEditorScreen from '../../src/screens/SiteThemeEditorScreen';
import { createDefaultSiteConfig } from '../../src/services/site/siteThemes';
import { useSitePublishStore } from '../../src/stores/sitePublishStore';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../src/stores/noteStore', () => ({
  useNoteStore: (selector: (s: { notes: unknown[] }) => unknown) => selector({ notes: [] }),
}));
jest.mock('../../src/utils/gitnotesImageResolver', () => ({
  resolveGitnotesImageUris: async (content: string) => content,
}));
jest.mock('../../src/components/site/SitePreviewFrame', () => ({ __esModule: true, default: () => null, PREVIEW_ORIGIN: 'https://x/' }));

const config = () => useSitePublishStore.getState().config;

beforeEach(() => {
  useSitePublishStore.setState({ config: createDefaultSiteConfig(), noteIds: [], hasHydrated: true });
});

describe('SiteThemeEditorScreen', () => {
  it('applies a preset, replacing the design', () => {
    const { getByTestId } = render(<SiteThemeEditorScreen />);
    fireEvent.press(getByTestId('site-theme.preset.terminal'));
    expect(config().presetId).toBe('terminal');
    expect(config().bodyFont).toBe('mono');
  });

  it('edits typography, layout and details through the controls', () => {
    const { getByTestId } = render(<SiteThemeEditorScreen />);
    const before = config().fontScale;
    fireEvent.press(getByTestId('site-theme.font-scale.increase'));
    expect(config().fontScale).toBeCloseTo(before + 0.05, 2);

    fireEvent.press(getByTestId('site-theme.index-layout.grid'));
    expect(config().indexLayout).toBe('grid');

    fireEvent.press(getByTestId('site-theme.color-mode.dark'));
    expect(config().colorMode).toBe('dark');

    fireEvent(getByTestId('site-theme.show-toc'), 'valueChange', true);
    expect(config().showToc).toBe(true);
  });

  it('stops steppers at their limits', () => {
    useSitePublishStore.getState().updateConfig({ radius: 0 });
    const { getByTestId } = render(<SiteThemeEditorScreen />);
    fireEvent.press(getByTestId('site-theme.radius.decrease'));
    expect(config().radius).toBe(0);
  });

  it('commits custom CSS on blur', () => {
    const { getByTestId } = render(<SiteThemeEditorScreen />);
    const input = getByTestId('site-theme.custom-css');
    fireEvent.changeText(input, 'h1 { letter-spacing: 2px; }');
    expect(config().customCss).toBe('');
    fireEvent(input, 'endEditing');
    expect(config().customCss).toBe('h1 { letter-spacing: 2px; }');
  });
});
