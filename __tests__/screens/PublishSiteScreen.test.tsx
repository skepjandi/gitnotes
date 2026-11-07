import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import PublishSiteScreen from '../../src/screens/PublishSiteScreen';
import { SiteProRequiredError, shareSiteZip } from '../../src/services/site/siteExport';
import type { SiteArtifact } from '../../src/services/site/siteTypes';
import { createDefaultSiteConfig } from '../../src/services/site/siteThemes';
import { useSitePublishStore } from '../../src/stores/sitePublishStore';
import type { Note } from '../../src/models/Note';

const mockNavigate = jest.fn();
const mockNotes: Note[] = [
  { id: 'n1', title: 'First note', content: 'Hello **world**', createdAt: 1, updatedAt: 2, tags: ['a'] },
  { id: 'n2', title: 'Second note', content: 'Another', createdAt: 3, updatedAt: 4, tags: [] },
  { id: 'n3', title: 'A PDF', content: '', createdAt: 5, updatedAt: 6, tags: [], format: 'pdf' },
];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true }),
  useFocusEffect: jest.fn(),
}));

jest.mock('@/components/ui/flat-list', () => {
  const { View } = require('react-native');
  return {
    FlatList: ({
      data,
      renderItem,
      ListHeaderComponent,
      ListFooterComponent,
      ListEmptyComponent,
    }: {
      data: Note[];
      renderItem: (info: { item: Note }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) => (
      <View>
        {ListHeaderComponent}
        {data.length ? data.map((item) => <View key={item.id}>{renderItem({ item })}</View>) : ListEmptyComponent}
        {ListFooterComponent}
      </View>
    ),
  };
});

jest.mock('../../src/stores/noteStore', () => ({
  useNoteStore: (selector: (s: { notes: Note[] }) => unknown) => selector({ notes: mockNotes }),
}));

jest.mock('../../src/utils/gitnotesImageResolver', () => ({
  resolveGitnotesImageUris: async (content: string) => content,
}));

jest.mock('../../src/services/site/siteExport', () => {
  const actual = jest.requireActual('../../src/services/site/siteExport');
  return { ...actual, shareSiteZip: jest.fn(async () => undefined) };
});

const shareMock = shareSiteZip as jest.MockedFunction<typeof shareSiteZip>;

async function exportEnabled(getByTestId: (id: string) => { props: { accessibilityState?: { disabled?: boolean } } }) {
  await waitFor(() => expect(getByTestId('publish-site.export').props.accessibilityState?.disabled).toBeFalsy());
}

beforeEach(() => {
  jest.clearAllMocks();
  useSitePublishStore.setState({ config: { ...createDefaultSiteConfig(), title: 'Field Notes' }, noteIds: [], hasHydrated: true });
});

describe('PublishSiteScreen', () => {
  it('lists publishable notes only and keeps export disabled until one is selected', () => {
    const { getByTestId, queryByTestId, getByText } = render(<PublishSiteScreen />);
    expect(getByTestId('publish-site.note.n1')).toBeTruthy();
    expect(getByTestId('publish-site.note.n2')).toBeTruthy();
    expect(queryByTestId('publish-site.note.n3')).toBeNull();
    expect(getByText('0 of 2 selected')).toBeTruthy();
    expect(getByTestId('publish-site.export').props.accessibilityState?.disabled).toBe(true);
  });

  it('exports only the selected notes using the site title', async () => {
    const { getByTestId } = render(<PublishSiteScreen />);
    fireEvent.press(getByTestId('publish-site.note.n2'));
    await exportEnabled(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId('publish-site.export'));
    });

    expect(shareMock).toHaveBeenCalledTimes(1);
    const [artifact, title] = shareMock.mock.calls[0] as [SiteArtifact, string];
    expect(title).toBe('Field Notes');
    expect(artifact.pages.map((p) => p.title)).toEqual(['Second note']);
  });

  it('offers an upgrade when entitlement is lost between opening the screen and exporting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    shareMock.mockRejectedValueOnce(new SiteProRequiredError());
    const { getByTestId } = render(<PublishSiteScreen />);
    fireEvent.press(getByTestId('publish-site.select-all'));
    await exportEnabled(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId('publish-site.export'));
    });

    expect(alert).toHaveBeenCalledWith('Pro Feature', expect.any(String), expect.any(Array));
    alert.mockRestore();
  });

  it('opens the design editor and the preview', () => {
    const { getByTestId } = render(<PublishSiteScreen />);
    fireEvent.press(getByTestId('publish-site.customize-design'));
    expect(mockNavigate).toHaveBeenCalledWith('SiteThemeEditor');
    fireEvent.press(getByTestId('publish-site.preview'));
    expect(mockNavigate).toHaveBeenCalledWith('SitePreview');
  });
});
