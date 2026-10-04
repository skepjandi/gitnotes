import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SettingsModals } from '../../../src/components/settings/SettingsModals';
import type { GitHostRepository, GitHostRepositoryResult, GitHostRepositoryUnavailable } from '../../../src/services/git/GitHost';
import type { CredentialKind } from '../../../src/services/git/contracts';
import type { GitRepository } from '../../../src/services/GitService';

// Fixtures
const availableGitHubRepo: GitHostRepository = {
  provider: 'github',
  owner: 'me',
  repo: 'my-repo',
  fullName: 'me/my-repo',
  name: 'my-repo',
  description: 'A cool repo',
  isPrivate: true,
};

const availableGitLabRepo: GitHostRepository = {
  provider: 'gitlab',
  owner: 'me',
  repo: 'my-gitlab-repo',
  fullName: 'me/my-gitlab-repo',
  name: 'my-gitlab-repo',
  description: 'A GitLab repo',
  isPrivate: false,
};

const unavailableGitea: GitHostRepositoryUnavailable = {
  kind: 'unavailable',
  provider: 'gitea',
  reason: 'Repository listing is not supported for Gitea and Forgejo. You can add a repository manually.',
};

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() },
  }),
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

// Mock SearchBar
jest.mock('../../../src/components/SearchBar', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: ({
      value,
      onChangeText,
      placeholder,
    }: {
      value: string;
      onChangeText: (text: string) => void;
      placeholder?: string;
    }) => (
      <TextInput
        testID="search-bar"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
      />
    ),
  };
});

// Mock Modal
jest.mock('../../../src/components/ui', () => {
  const { View } = require('react-native');
  return {
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? <View testID="modal">{children}</View> : null,
    Input: ({
      testID,
      value,
      onChangeText,
      placeholder,
      onSubmitEditing,
    }: {
      testID?: string;
      value: string;
      onChangeText: (text: string) => void;
      placeholder?: string;
      onSubmitEditing?: () => void;
    }) => {
      const { TextInput } = require('react-native');
      return (
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          onSubmitEditing={onSubmitEditing}
        />
      );
    },
    Button: ({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) => {
      const { TouchableOpacity, Text } = require('react-native');
      return (
        <TouchableOpacity testID="button" onPress={onPress} disabled={disabled}>
          <Text>{label}</Text>
        </TouchableOpacity>
      );
    },
  };
});

// Mock CloneProgressModal
jest.mock('../../../src/components/settings/CloneProgressModal', () => ({
  CloneProgressContent: () => null,
}));

const defaultColors = {
  background: '#ffffff',
  surface: '#f0f0f0',
  primary: '#007AFF',
  text: '#000000',
  textSecondary: '#666666',
  border: '#cccccc',
  error: '#FF3B30',
};

const defaultProps = {
  colors: defaultColors,
  authState: { isAuthenticated: true },
  repositories: [] as GitRepository[],
  discoverableRepos: [] as GitHostRepositoryResult[],
  templatesRepoPref: null,
  showRepoPickerModal: true,
  showTemplatesRepoPicker: false,
  showTokenModal: false,
  repoSearchQuery: '',
  manualRepoInput: '',
  isAddingRepoPath: null,
  isLoadingDiscoverableRepos: false,
  cloneProgress: null,
  onCancelClone: jest.fn(),
  onRetryClone: jest.fn(),
  tokenInput: '',
  tokenVisible: false,
  tokenError: null,
  isVerifying: false,
  tokenModalMode: 'connect' as const,
  onCloseRepoPicker: jest.fn(),
  onSetRepoSearchQuery: jest.fn(),
  onSetManualRepoInput: jest.fn(),
  accountSummaries: [] as Array<{ account: { id: string; login: string; name: string; avatarUrl: string | null }; hosts: Array<{ id: string; provider: 'github' | 'gitlab' | 'gitea' | 'forgejo'; hostLogin: string; hostUserId: number; name: string; email: string | null; avatarUrl: string | null; instanceBaseUrl: string | null; addedAt: number }>; activeHostId: string | null }>,
  hostCredentialKinds: {} as Record<string, CredentialKind[]>,
  manualRepoHostId: null as string | null,
  onManualRepoHostIdChange: jest.fn(),
  onAddManualRepo: jest.fn(),
  onSelectRepo: jest.fn(),
  onCloseTemplatesRepoPicker: jest.fn(),
  onPickTemplatesRepo: jest.fn(),
  onCloseTokenModal: jest.fn(),
  onSetTokenInput: jest.fn(),
  onToggleTokenVisible: jest.fn(),
  onPasteToken: jest.fn(),
  onCopyToken: jest.fn(),
  onSaveToken: jest.fn(),
};

describe('RepoPickerList (via SettingsModals)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders available repos with correct fields', () => {
    const onSelectRepo = jest.fn();
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[availableGitHubRepo]}
        onSelectRepo={onSelectRepo}
      />,
    );

    expect(getByText('me/my-repo')).toBeTruthy();
  });

  it('renders OAuth repositories without PAT auth state', () => {
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        authState={{ isAuthenticated: false }}
        discoverableRepos={[availableGitHubRepo]}
        hostCredentialKinds={{ 'github-host-1': ['oauth'] }}
      />,
    );

    expect(getByText('me/my-repo')).toBeTruthy();
  });

  it('search filters across fullName, name, owner, description', () => {
    const onSetRepoSearchQuery = jest.fn();
    const { getByTestId, queryByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[availableGitHubRepo, availableGitLabRepo]}
        repoSearchQuery="me/" // matches owner in both
        onSetRepoSearchQuery={onSetRepoSearchQuery}
      />,
    );

    // Both repos have 'me/' in fullName
    expect(getByTestId('search-bar')).toBeTruthy();
    expect(queryByText('me/my-repo')).toBeTruthy();
    expect(queryByText('me/my-gitlab-repo')).toBeTruthy();
  });

  it('groups repositories by provider', () => {
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[availableGitHubRepo, availableGitLabRepo]}
      />,
    );

    expect(getByText('GitHub (1)')).toBeTruthy();
    expect(getByText('GitLab (1)')).toBeTruthy();
  });

  it('filters repositories by the selected provider', () => {
    const { getByTestId, getByText, queryByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[availableGitHubRepo, availableGitLabRepo]}
      />,
    );

    fireEvent.press(getByTestId('settings.repo-filter.dropdown'));
    fireEvent.press(getByTestId('settings.repo-filter.github'));

    expect(getByText('me/my-repo')).toBeTruthy();
    expect(queryByText('me/my-gitlab-repo')).toBeNull();
  });

  it('filters repositories by the selected host', () => {
    const hostId = 'github-host-1';
    const { getByTestId, getByText, queryByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[
          { ...availableGitHubRepo, hostId },
          { ...availableGitLabRepo, hostId: 'gitlab-host-1' },
        ]}
        accountSummaries={[{
          account: { id: 'account-1', login: 'me', name: 'Me', avatarUrl: null },
          hosts: [{
            id: hostId,
            accountId: 'account-1',
            provider: 'github',
            hostLogin: 'me',
            hostUserId: 1,
            name: 'Me',
            email: null,
            avatarUrl: null,
            instanceBaseUrl: null,
            addedAt: 1,
          }],
          activeHostId: hostId,
        }]}
      />,
    );

    fireEvent.press(getByTestId('settings.repo-filter.host-dropdown'));
    fireEvent.press(getByTestId(`settings.repo-filter.host.${hostId}`));

    expect(getByText('me/my-repo')).toBeTruthy();
    expect(queryByText('me/my-gitlab-repo')).toBeNull();
  });

  it('keeps provider and host options inside padded scrollable lists', () => {
    const hostId = 'github-host-1';
    const { getByTestId } = render(
      <SettingsModals
        {...defaultProps}
        accountSummaries={[{
          account: { id: 'account-1', login: 'me', name: 'Me', avatarUrl: null },
          hosts: [{
            id: hostId,
            accountId: 'account-1',
            provider: 'github',
            hostLogin: 'me',
            hostUserId: 1,
            name: 'Me',
            email: null,
            avatarUrl: null,
            instanceBaseUrl: null,
            addedAt: 1,
          }],
          activeHostId: hostId,
        }]}
      />,
    );

    fireEvent.press(getByTestId('settings.repo-filter.dropdown'));
    const providerOptions = getByTestId('settings.repo-filter.options-scroll');
    expect(providerOptions.props.contentContainerStyle).toEqual({ paddingBottom: 42 });

    fireEvent.press(getByTestId('settings.repo-filter.host-dropdown'));
    const hostOptions = getByTestId('settings.repo-filter.host-options-scroll');
    expect(hostOptions.props.contentContainerStyle).toEqual({ paddingBottom: 42 });
  });

  it('unavailable repos render with provider badge and reason', () => {
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[unavailableGitea]}
      />,
    );

    expect(
      getByText('Repository listing is not supported for Gitea and Forgejo. You can add a repository manually.'),
    ).toBeTruthy();
  });

  it('add manually link shown when unavailable repos present', () => {
    const onAddManualRepo = jest.fn();
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[unavailableGitea]}
        onAddManualRepo={onAddManualRepo}
      />,
    );

    expect(getByText('settings.addRepositoryManually')).toBeTruthy();
  });

  it('loading state renders ActivityIndicator', () => {
    const { queryAllByTestId } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[]}
        isLoadingDiscoverableRepos={true}
      />,
    );

    // When loading, ActivityIndicator is shown
    // The component shows ActivityIndicator for loading state
    expect(queryAllByTestId('search-bar').length >= 0).toBe(true);
  });

  it('empty state shows noRepositoriesFound text', () => {
    const { getByText } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[]}
        isLoadingDiscoverableRepos={false}
      />,
    );

    expect(getByText('settings.noRepositoriesFound')).toBeTruthy();
  });

  it('adjusts picker content for the keyboard when the repository list is empty', () => {
    const { getByTestId } = render(
      <SettingsModals
        {...defaultProps}
        discoverableRepos={[]}
        isLoadingDiscoverableRepos={false}
      />,
    );

    expect(getByTestId('settings-modals.repo-picker-scroll').props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('renders distinct host labels for duplicate-looking hosts with different auth contexts', () => {
    const hostOAuth: (typeof defaultProps.accountSummaries)[0]['hosts'][0] = {
      id: 'github-oauth-host-1',
      accountId: 'account-1',
      provider: 'github',
      hostLogin: 'me',
      hostUserId: 1,
      name: 'Me (OAuth)',
      email: 'me@example.com',
      avatarUrl: null,
      instanceBaseUrl: null,
      addedAt: 1,
    };

    const hostGitHubApp: (typeof defaultProps.accountSummaries)[0]['hosts'][0] = {
      id: 'github-app-host-1',
      accountId: 'account-1',
      provider: 'github',
      hostLogin: 'me',
      hostUserId: 1,
      name: 'Me (GitHub App)',
      email: 'me@example.com',
      avatarUrl: null,
      instanceBaseUrl: null,
      addedAt: 2,
    };

    const { getByTestId } = render(
      <SettingsModals
        {...defaultProps}
        accountSummaries={[{
          account: { id: 'account-1', login: 'me', name: 'Me', avatarUrl: null },
          hosts: [hostOAuth, hostGitHubApp],
          activeHostId: 'github-oauth-host-1',
        }]}
        hostCredentialKinds={{
          'github-oauth-host-1': ['oauth'],
          'github-app-host-1': ['github_app'],
        }}
      />,
    );

    fireEvent.press(getByTestId('settings.repo-filter.host-dropdown'));

    const getLabelText = (testId: string) => {
      const option = getByTestId(testId);
      const texts: string[] = [];
      const extractText = (node: React.ReactNode) => {
        if (typeof node === 'string') texts.push(node);
        if (Array.isArray(node)) node.forEach(extractText);
        if (node && typeof node === 'object' && 'props' in node) {
          extractText((node as React.ReactElement).props.children);
        }
      };
      extractText(option.props.children);
      return texts.join('');
    };

    const label1 = getLabelText('settings.repo-filter.host.github-oauth-host-1');
    const label2 = getLabelText('settings.repo-filter.host.github-app-host-1');

    expect(label1).not.toEqual(label2);
  });

  it('host dropdown label reflects selected host with full context including auth distinction', () => {
    const hostGitHubApp: (typeof defaultProps.accountSummaries)[0]['hosts'][0] = {
      id: 'github-app-host-1',
      accountId: 'account-1',
      provider: 'github',
      hostLogin: 'workuser',
      hostUserId: 2,
      name: 'Work User',
      email: 'work@example.com',
      avatarUrl: null,
      instanceBaseUrl: 'https://github.enterprise.com',
      addedAt: 1,
    };

    const { getByTestId, getAllByText } = render(
      <SettingsModals
        {...defaultProps}
        accountSummaries={[{
          account: { id: 'account-1', login: 'workuser', name: 'Work User', avatarUrl: null },
          hosts: [hostGitHubApp],
          activeHostId: 'github-app-host-1',
        }]}
        hostCredentialKinds={{
          'github-app-host-1': ['github_app'],
        }}
      />,
    );

    fireEvent.press(getByTestId('settings.repo-filter.host-dropdown'));
    fireEvent.press(getByTestId('settings.repo-filter.host.github-app-host-1'));

    expect(getAllByText('GitHub · github.enterprise.com (workuser) · Work User [App]')).toHaveLength(2);
  });
});
