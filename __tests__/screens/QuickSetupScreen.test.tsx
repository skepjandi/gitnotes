import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockRouteParams: { oauthState?: string | null } = {};
const mockInitiate = jest.fn();
const mockOpenAuthorizationUrl = jest.fn();
const mockPendingOAuthFlows = new Map<string, Record<string, unknown>>();
const mockCreateRepository = jest.fn();
const mockAddRepository = jest.fn();
const mockCreateNote = jest.fn();
const mockRepositories: Array<{ path: string }> = [];
const mockNotes: Array<{ title: string; repo: string }> = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      text: '#000',
      textSecondary: '#666',
      accent: '#06f',
      border: '#ddd',
    },
  }),
  useTokens: () => ({
    colors: {
      background: '#fff',
      text: '#000',
      textSecondary: '#666',
      accent: '#06f',
      border: '#ddd',
    },
    radii: { md: 8, pill: 9999 },
    type: { xs: 12, sm: 14, md: 16 },
    spacing: { 2: 8, 3: 12 },
  }),
}));

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({ refreshAccounts: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('@/services/GitHubOAuthService', () => ({
  GitHubOAuthService: {
    initiate: (...args: unknown[]) => mockInitiate(...args),
    openAuthorizationUrl: (...args: unknown[]) => mockOpenAuthorizationUrl(...args),
  },
  pendingOAuthFlows: {
    get: (state: string) => mockPendingOAuthFlows.get(state),
    values: () => mockPendingOAuthFlows.values(),
    entries: () => mockPendingOAuthFlows.entries(),
    delete: (state: string) => mockPendingOAuthFlows.delete(state),
  },
}));

jest.mock('@/services/GitHubService', () => ({
  GitHubService: { createRepository: (...args: unknown[]) => mockCreateRepository(...args) },
}));

jest.mock('@/stores/repoStore', () => ({
  useRepoStore: {
    getState: () => ({
      addRepository: (...args: unknown[]) => mockAddRepository(...args),
      repositories: mockRepositories,
    }),
  },
}));

jest.mock('@/stores/noteStore', () => ({
  useNoteStore: {
    getState: () => ({
      createNote: (...args: unknown[]) => mockCreateNote(...args),
      notes: mockNotes,
    }),
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import QuickSetupScreen from '@/screens/QuickSetupScreen';

describe('QuickSetupScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockInitiate.mockReset();
    mockOpenAuthorizationUrl.mockReset();
    mockCreateRepository.mockReset();
    mockAddRepository.mockReset();
    mockCreateNote.mockReset();
    mockRepositories.length = 0;
    mockNotes.length = 0;
    mockPendingOAuthFlows.clear();
    delete mockRouteParams.oauthState;
    process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
  });

  it('keeps OAuth failures on a retryable OAuth page and starts fresh flows', async () => {
    let attempt = 0;
    const states: string[] = [];
    mockInitiate.mockImplementation(async () => {
      attempt += 1;
      states.push(`state-${attempt}`);
      return {
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        state: `state-${attempt}`,
      };
    });
    mockOpenAuthorizationUrl.mockResolvedValue({ outcome: 'cancelled' });

    const { getByTestId } = render(<QuickSetupScreen onComplete={jest.fn()} />);
    fireEvent.press(getByTestId('quick-setup.button.sign-in'));

    await waitFor(() => {
      expect(getByTestId('quick-setup.button.retry-oauth')).toBeTruthy();
    });

    fireEvent.press(getByTestId('quick-setup.button.retry-oauth'));
    await waitFor(() => expect(mockInitiate).toHaveBeenCalledTimes(2));
    fireEvent.press(getByTestId('quick-setup.button.retry-oauth'));
    await waitFor(() => expect(mockInitiate).toHaveBeenCalledTimes(3));
    expect(states).toEqual(['state-1', 'state-2', 'state-3']);
  });

  it('advances to repository naming for the state-specific successful callback', async () => {
    mockRouteParams.oauthState = 'success-state';
    mockPendingOAuthFlows.set('success-state', {
      returnTo: 'quick-setup',
      githubLogin: 'octocat',
      oauthResult: { outcome: 'success', credential: { hostId: 'host-1' } },
    });

    const { getByTestId } = render(<QuickSetupScreen onComplete={jest.fn()} />);

    await waitFor(() => {
      expect(getByTestId('quick-setup.input.repo-name')).toBeTruthy();
    });
    expect(getByTestId('quick-setup.input.repo-name').props.value).toBe('gitnotes-octocat');
  });

  it('creates, clones, and seeds the repository before completing', async () => {
    mockRouteParams.oauthState = 'success-state';
    mockPendingOAuthFlows.set('success-state', {
      returnTo: 'quick-setup',
      githubLogin: 'octocat',
      oauthResult: { outcome: 'success', credential: { hostId: 'host-1' } },
    });
    mockCreateRepository.mockResolvedValue({
      full_name: 'octocat/gitnotes-octocat',
      name: 'gitnotes-octocat',
      default_branch: 'main',
    });
    mockAddRepository.mockImplementation(async () => {
      mockRepositories.push({ path: 'octocat/gitnotes-octocat' });
      return { id: 'repo-1' };
    });
    mockCreateNote.mockResolvedValue({ id: 'note-1' });
    const onComplete = jest.fn();

    const { getByTestId } = render(<QuickSetupScreen onComplete={onComplete} />);
    await waitFor(() => expect(getByTestId('quick-setup.input.repo-name')).toBeTruthy());

    fireEvent.press(getByTestId('quick-setup.button.create'));
    await waitFor(() => expect(getByTestId('quick-setup.button.done')).toBeTruthy());

    expect(mockCreateRepository).toHaveBeenCalledWith({ name: 'gitnotes-octocat' });
    expect(mockAddRepository).toHaveBeenCalledWith(
      'octocat/gitnotes-octocat',
      'gitnotes-octocat',
      'github',
      { allowUnverifiedWrite: true },
      'host-1',
    );
    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'octocat/gitnotes-octocat',
        branch: 'main',
        filePath: 'notes/welcome-to-gitnotes.md',
      }),
    );

    fireEvent.press(getByTestId('quick-setup.button.done'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
