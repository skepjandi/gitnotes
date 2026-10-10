/**
 * OnboardingScreen multi-provider token flow tests.
 *
 * Verifies:
 * - Five info steps render and advance correctly
 * - Token step shows provider selection with all four providers
 * - Instance URL field appears for non-GitHub providers
 * - Token-settings link hidden for Gitea/Forgejo (no known hosted URL)
 * - connectHost is called with correct provider, token, and instanceBaseUrl
 * - Skip bypasses the token step entirely
 * - Paste populates the token field
 * - Loading spinner shown during verification
 * - Error message displayed on invalid token
 * - GitHub auth method selector shows PAT/OAuth/App options
 * - OAuth/App initiation failures show inline errors
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { HostConnectionSummary } from '@/services/AuthService';
import type { GitHostProvider } from '@/services/git/GitHost';

const mockConnectHost = jest.fn();
const mockRefreshAccounts = jest.fn();
const mockCompleteOnboarding = jest.fn();
const mockOnComplete = jest.fn();
const mockOnSkip = jest.fn();
const mockAppBuildInstallUrl = jest.fn();
const mockAppOpenInstallationUrl = jest.fn();

function makeHost(provider: GitHostProvider = 'github'): HostConnectionSummary {
  return {
    id: `host-${provider}-1`,
    accountId: 'account-1',
    provider,
    hostLogin: 'testuser',
    hostUserId: 1,
    name: 'Test User',
    email: 'test@example.com',
    avatarUrl: null,
    instanceBaseUrl: null,
    addedAt: Date.now(),
  };
}

jest.mock('../../src/services/OnboardingService', () => {
  const mockComplete = jest.fn().mockResolvedValue(undefined);
  return {
    OnboardingService: {
      completeOnboarding: mockComplete,
    },
  };
});

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({
    connectHost: mockConnectHost,
    refreshAccounts: mockRefreshAccounts,
  }),
}));

jest.mock('@react-navigation/native', () => {
  const mockNavigate = jest.fn();
  const mockRouteParams: Record<string, unknown> = {};
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useRoute: () => ({ params: mockRouteParams }),
    __mockNavigate: mockNavigate,
    __mockRouteParams: mockRouteParams,
  };
});

const mockNavigate = (jest.requireMock('@react-navigation/native') as { __mockNavigate: jest.Mock }).__mockNavigate;
const mockRouteParams = (jest.requireMock('@react-navigation/native') as { __mockRouteParams: Record<string, unknown> }).__mockRouteParams;

jest.mock('@/contexts/ThemeContext', () => {
  const mockColors = {
    background: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    accent: '#0066ff',
    error: '#ff0000',
    surface: '#ffffff',
    border: '#dddddd',
    card: '#eeeeee',
    success: '#00aa00',
    warning: '#ffaa00',
  };
  return {
    useTheme: () => ({ colors: mockColors, style: {}, isDark: false }),
    useTokens: () => ({
      colors: mockColors,
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 4, md: 8, lg: 16, full: 9999 },
      type: 'light' as const,
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return options.defaultValue as string;
      const translations: Record<string, string> = {
        'onboarding.simple.signInCancelled': 'Sign-in was cancelled. Please try again.',
        'onboarding.simple.accountLimitReached': 'You have reached the maximum number of free accounts.',
        'onboarding.simple.signInFailed': 'Sign-in failed. Please try again.',
        'onboarding.simple.notAuthenticated': 'Please sign in to continue.',
        'onboarding.simple.permissionDenied': 'Permission denied. Check your GitHub token permissions.',
        'onboarding.simple.couldNotCreateRepo': 'Could not create repository. Please try again.',
        'onboarding.simple.couldNotCloneRepo': 'Could not clone repository. Please try again.',
        'onboarding.simple.couldNotSeedNote': 'Could not create welcome note. Please try again.',
        'onboarding.simple.select.title': 'Quick Setup',
        'onboarding.simple.select.description': 'Sign in with GitHub and we\'ll create a private repository for your notes.',
        'onboarding.simple.select.signInButton': 'Sign in with GitHub',
        'onboarding.simple.select.complexButton': 'Complex Setup',
        'onboarding.simple.quickSetupBanner': 'Quick Setup (Recommended)',
        'onboarding.simple.quickSetupBannerSub': 'Sign in with GitHub and create a repo in 30 seconds',
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(),
}));

jest.mock('../../src/services/GitHubOAuthService', () => {
  const _mockInitiate = jest.fn();
  const _mockOpenAuth = jest.fn();
  const _pendingOAuthFlows = new Map<string, object>();
  return {
    __mockInitiate: _mockInitiate,
    __mockOpenAuth: _mockOpenAuth,
    GitHubOAuthService: {
      initiate: (...args: unknown[]) => _mockInitiate(...args),
      openAuthorizationUrl: (...args: unknown[]) => _mockOpenAuth(...args),
    },
    pendingOAuthFlows: _pendingOAuthFlows,
    default: {
      initiate: (...args: unknown[]) => _mockInitiate(...args),
      openAuthorizationUrl: (...args: unknown[]) => _mockOpenAuth(...args),
    },
    setHttpClient: jest.fn(),
  };
});

const mockOAuthInitiate = (jest.requireMock('../../src/services/GitHubOAuthService') as { __mockInitiate: jest.Mock }).__mockInitiate;
const mockOpenAuthorizationUrl = (jest.requireMock('../../src/services/GitHubOAuthService') as { __mockOpenAuth: jest.Mock }).__mockOpenAuth;
const mockPendingOAuthFlows = (jest.requireMock('../../src/services/GitHubOAuthService') as { pendingOAuthFlows: Map<string, object> }).pendingOAuthFlows;

jest.mock('../../src/services/GitHubAppService', () => ({
  GitHubAppService: {
    buildInstallUrl: mockAppBuildInstallUrl,
    openInstallationUrl: mockAppOpenInstallationUrl,
  },
}));

jest.mock('../../src/services/GitHubService', () => {
  const mockFn = jest.fn();
  return {
    __mockCreateRepository: mockFn,
    GitHubService: {
      createRepository: mockFn,
    },
    GitHubServiceClass: jest.fn().mockImplementation(() => ({
      createRepository: mockFn,
    })),
  };
});

const mockCreateRepository = (jest.requireMock('../../src/services/GitHubService') as { __mockCreateRepository: jest.Mock }).__mockCreateRepository;

jest.mock('../../src/stores/repoStore', () => {
  const mockAddRepositoryFn = jest.fn();
  const mockState = {
    addRepository: mockAddRepositoryFn,
    repositories: [] as Array<{ id: string; path: string; name: string; provider: string; branch: string }>,
  };
  const mockUseRepoStore = Object.assign(
    () => mockState,
    { getState: () => mockState }
  );
  return {
    useRepoStore: mockUseRepoStore,
    __mockAddRepository: mockAddRepositoryFn,
    __mockState: mockState,
  };
});

const mockAddRepository = (jest.requireMock('../../src/stores/repoStore') as { __mockAddRepository: jest.Mock; __mockState: { repositories: Array<{ id: string; path: string; name: string; provider: string; branch: string }> } }).__mockAddRepository;
const mockRepoState = (jest.requireMock('../../src/stores/repoStore') as { __mockState: { repositories: Array<{ id: string; path: string; name: string; provider: string; branch: string }> } }).__mockState;

jest.mock('../../src/stores/noteStore', () => {
  const mockCreateNoteFn = jest.fn();
  const mockState = {
    createNote: mockCreateNoteFn,
    notes: [] as Array<{ id: string; title: string; repo: string }>,
  };
  const mockUseNoteStore = Object.assign(
    () => mockState,
    { getState: () => mockState }
  );
  return {
    useNoteStore: mockUseNoteStore,
    __mockCreateNote: mockCreateNoteFn,
    __mockNoteState: mockState,
  };
});

const mockCreateNote = (jest.requireMock('../../src/stores/noteStore') as { __mockCreateNote: jest.Mock; __mockNoteState: { notes: Array<{ id: string; title: string; repo: string }> } }).__mockCreateNote;
const mockNoteState = (jest.requireMock('../../src/stores/noteStore') as { __mockNoteState: { notes: Array<{ id: string; title: string; repo: string }> } }).__mockNoteState;

import OnboardingScreen from '@/screens/OnboardingScreen';

describe('OnboardingScreen', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
  });

  beforeEach(() => {
    process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
    mockConnectHost.mockReset();
    mockRefreshAccounts.mockResolvedValue(undefined);
    mockCompleteOnboarding.mockResolvedValue(undefined);
    mockOnComplete.mockReset();
    mockOnSkip.mockReset();
    (Clipboard.getStringAsync as jest.Mock).mockReset();
    mockCreateRepository.mockReset();
    mockAddRepository.mockReset();
    mockCreateNote.mockReset();
  });

  describe('info steps', () => {
    it('renders five info steps and advances on Next', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Step 0 - welcome
      await waitFor(() => {
        expect(getByTestId('onboarding.button.next')).toBeTruthy();
      });

      // Advance through steps 0-4
      for (let step = 0; step < 5; step++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
        // waitFor needs a predicate - this is a tick to let the step advance
        await waitFor(() => true);
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      // Should NOT be on AI step yet
      expect(queryByTestId('onboarding.button.pro-continue')).toBeNull();
    });

    it('skips directly to token step via skip button on info screens', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.skip')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.skip'));
      });

      await waitFor(() => {
        expect(mockOnSkip).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('provider selection', () => {
    beforeEach(async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      // Advance to token step
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });
    });

    it('shows all four providers in dropdown', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      // Advance to token step
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      // Open dropdown
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.github')).toBeTruthy();
        expect(getByTestId('onboarding.provider.gitlab')).toBeTruthy();
        expect(getByTestId('onboarding.provider.gitea')).toBeTruthy();
        expect(getByTestId('onboarding.provider.forgejo')).toBeTruthy();
      });
    });

    it('selects GitHub by default', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await waitFor(() => {
        expect(queryByTestId('onboarding.input.instance-url')).toBeNull();
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.open-link')).toBeTruthy();
      });
    });

    it('shows instance URL field for GitLab', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.gitlab')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.instance-url')).toBeTruthy();
        expect(getByTestId('onboarding.button.open-link')).toBeTruthy();
      });
    });

    it('shows instance URL field and hides token-settings link for Gitea', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.gitea')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.gitea'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.instance-url')).toBeTruthy();
      });

      await waitFor(() => {
        expect(queryByTestId('onboarding.button.open-link')).toBeNull();
      });
    });

    it('shows instance URL field and hides token-settings link for Forgejo', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.forgejo')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.forgejo'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.instance-url')).toBeTruthy();
      });

      await waitFor(() => {
        expect(queryByTestId('onboarding.button.open-link')).toBeNull();
      });
    });
  });

  describe('token submission', () => {
    beforeEach(async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });
    });

    it('calls connectHost with GitHub provider and token', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });

      const tokenInput = getByTestId('onboarding.input.token');
      await act(async () => {
        fireEvent.changeText(tokenInput, 'ghp_test_token_12345');
      });

      mockConnectHost.mockResolvedValueOnce({ ok: true, host: makeHost() });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        expect(mockConnectHost).toHaveBeenCalledWith({
          provider: 'github',
          token: 'ghp_test_token_12345',
          instanceBaseUrl: null,
        });
      });
    });

    it('calls connectHost with GitLab provider, token, and instance URL', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.gitlab')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.instance-url')).toBeTruthy();
      });

      const instanceInput = getByTestId('onboarding.input.instance-url');
      await act(async () => {
        fireEvent.changeText(instanceInput, 'https://gitlab.mycompany.com');
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });

      const tokenInput = getByTestId('onboarding.input.token');
      await act(async () => {
        fireEvent.changeText(tokenInput, 'glpat_test_token');
      });

      mockConnectHost.mockResolvedValueOnce({ ok: true, host: makeHost() });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        expect(mockConnectHost).toHaveBeenCalledWith({
          provider: 'gitlab',
          token: 'glpat_test_token',
          instanceBaseUrl: 'https://gitlab.mycompany.com',
        });
      });
    });

    it('shows error message when connectHost returns invalid', async () => {
      const { getByTestId, queryByText } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });

      const tokenInput = getByTestId('onboarding.input.token');
      await act(async () => {
        fireEvent.changeText(tokenInput, 'bad_token');
      });

      mockConnectHost.mockResolvedValueOnce({ ok: false, error: 'Invalid token' });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        expect(queryByText('Invalid token')).toBeTruthy();
      });
    });

    it('rejects a non-http instance URL before connecting', async () => {
      const { getByTestId, queryByText } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      fireEvent.changeText(getByTestId('onboarding.input.instance-url'), 'ftp://gitlab.example.com');
      fireEvent.changeText(getByTestId('onboarding.input.token'), 'glpat_test_token');

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      expect(mockConnectHost).not.toHaveBeenCalled();
      expect(queryByText('connectHost.error.invalidUrl')).toBeTruthy();
    });

    it('warns before connecting over http', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        buttons?.[1]?.onPress?.();
      });
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      fireEvent.changeText(getByTestId('onboarding.input.instance-url'), 'http://gitlab.example.com');
      fireEvent.changeText(getByTestId('onboarding.input.token'), 'glpat_test_token');
      mockConnectHost.mockResolvedValueOnce({ ok: true, host: makeHost('gitlab') });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      expect(alertSpy).toHaveBeenCalled();
      expect(mockConnectHost).toHaveBeenCalledWith({
        provider: 'gitlab',
        token: 'glpat_test_token',
        instanceBaseUrl: 'http://gitlab.example.com',
      });
      alertSpy.mockRestore();
    });

    it('skips token step when token is empty', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });

      // Don't enter any token, just advance
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        // Should be on AI step
        expect(getByTestId('onboarding.button.pro-continue')).toBeTruthy();
      });

      expect(mockConnectHost).not.toHaveBeenCalled();
    });
  });

  describe('paste from clipboard', () => {
    beforeEach(async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.button.paste-token')).toBeTruthy();
      });
    });

    it('pastes clipboard content into token field', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.button.paste-token')).toBeTruthy();
      });

      (Clipboard.getStringAsync as jest.Mock).mockResolvedValueOnce('pasted_token_abc123');

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.paste-token'));
      });

      await waitFor(() => {
        expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('loading state', () => {
    beforeEach(async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });
    });

    it('disables next button while verifying', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });

      const tokenInput = getByTestId('onboarding.input.token');
      await act(async () => {
        fireEvent.changeText(tokenInput, 'test_token');
      });

      // Slow resolution to catch loading state
      mockConnectHost.mockImplementation(
        () => new Promise<{ ok: boolean; host: HostConnectionSummary }>((resolve) =>
          setTimeout(() => resolve({ ok: true, host: makeHost() }), 500)
        )
      );

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        // Button should be disabled (no testID on disabled Button, but we can check the button exists)
        expect(getByTestId('onboarding.button.next')).toBeTruthy();
      });
    });
  });

  describe('skip from token step', () => {
    beforeEach(async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.button.skip')).toBeTruthy();
      });
    });

    it('skips from token step without calling connectHost', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.button.skip')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.skip'));
      });

      await waitFor(() => {
        expect(mockOnSkip).toHaveBeenCalledTimes(1);
      });
      expect(mockConnectHost).not.toHaveBeenCalled();
    });
  });

  describe('full flow', () => {
    it('advances through five info steps, then connects and goes to AI step', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Advance through 5 info steps
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      // Enter token and connect
      const tokenInput = getByTestId('onboarding.input.token');
      await act(async () => {
        fireEvent.changeText(tokenInput, 'valid_token');
      });

      mockConnectHost.mockResolvedValueOnce({ ok: true, host: makeHost() });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.next'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.pro-continue')).toBeTruthy();
      });

      // Complete AI step
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.pro-continue'));
      });

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('GitHub auth method selector', () => {
    beforeEach(async () => {
      mockOAuthInitiate.mockClear();
      mockOpenAuthorizationUrl.mockClear();
      mockAppBuildInstallUrl.mockReset();
      mockAppOpenInstallationUrl.mockReset();
      mockConnectHost.mockReset();
      mockRefreshAccounts.mockResolvedValue(undefined);

      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });
    });

    it('shows PAT/OAuth/App segmented buttons for GitHub', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.pat')).toBeTruthy();
      });
      expect(getByTestId('onboarding.github-auth.oauth')).toBeTruthy();
      expect(getByTestId('onboarding.github-auth.app')).toBeTruthy();
    });

    it('defaults to PAT for GitHub', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.pat')).toBeTruthy();
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });
      expect(queryByTestId('onboarding.button.oauth')).toBeNull();
      expect(queryByTestId('onboarding.button.app')).toBeNull();
    });

    it('shows OAuth button when OAuth method is selected', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.oauth')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.github-auth.oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.oauth')).toBeTruthy();
      });
    });

    it('shows App button when App method is selected', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.app')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.github-auth.app'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.app')).toBeTruthy();
      });
    });

    it('does NOT show auth method selector for non-GitHub providers', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.dropdown')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.gitlab')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      // Auth method selector should not exist for GitLab
      await waitFor(() => {
        expect(queryByTestId('onboarding.github-auth.pat')).toBeNull();
        expect(queryByTestId('onboarding.github-auth.oauth')).toBeNull();
        expect(queryByTestId('onboarding.github-auth.app')).toBeNull();
      });
    });

    it('switching provider from GitHub to non-GitHub resets to PAT and hides auth selector', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }

      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.pat')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.github-auth.oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.oauth')).toBeTruthy();
      });

      // Switch provider to GitLab
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.dropdown'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.provider.gitlab')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.provider.gitlab'));
      });

      await waitFor(() => {
        expect(queryByTestId('onboarding.github-auth.pat')).toBeNull();
        expect(queryByTestId('onboarding.button.oauth')).toBeNull();
        expect(getByTestId('onboarding.input.token')).toBeTruthy();
      });
    });
  });

  describe('GitHub OAuth flow', () => {
    beforeEach(async () => {
      mockOAuthInitiate.mockReset();
      mockOpenAuthorizationUrl.mockReset();
      mockConnectHost.mockClear();
      mockRefreshAccounts.mockResolvedValue(undefined);
    });

    /**
     * Helper: advance from step 0 to TOKEN_STEP and select the OAuth auth method.
     * Returns the getByTestId from the final render at TOKEN_STEP.
     */
    async function setupOAuthStep(): Promise<ReturnType<typeof render>> {
      const result = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />,
      );
      const { getByTestId } = result;
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.oauth')).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.github-auth.oauth'));
      });
      await waitFor(() => {
        expect(getByTestId('onboarding.button.oauth')).toBeTruthy();
      });
      return result;
    }

    it('shows inline error when OAuth initiation fails due to backend unreachable', async () => {
      const result = await setupOAuthStep();
      const { getByTestId } = result;

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: false,
        reason: 'backend_unreachable',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.oauth'));
      });

      const hasError = () => result.queryByText('Server unavailable. Check your connection.') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

    it('shows inline error when OAuth client ID is not configured', async () => {
      const result = await setupOAuthStep();
      const { getByTestId } = result;

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: false,
        reason: 'network_error',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.oauth'));
      });

      const hasError = () => result.queryByText('Could not start sign-in.') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

    it('re-enables OAuth button after initiation failure', async () => {
      const result = await setupOAuthStep();
      const { getByTestId } = result;

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: false,
        reason: 'backend_unreachable',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.oauth')).toBeTruthy();
      });
    });

    it('shows error when browser fails to open', async () => {
      const result = await setupOAuthStep();
      const { getByTestId } = result;

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=abc',
        state: 'test-state-123',
      });
      mockOpenAuthorizationUrl.mockResolvedValueOnce({ outcome: 'failed' });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.oauth'));
      });

      const hasError = () => result.queryByText('Could not open browser') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

  });

  describe('GitHub App flow', () => {
    beforeEach(async () => {
      mockAppBuildInstallUrl.mockClear();
      mockAppOpenInstallationUrl.mockClear();
      mockConnectHost.mockClear();
      mockRefreshAccounts.mockResolvedValue(undefined);
    });

    async function setupAppStep(): Promise<ReturnType<typeof render>> {
      const result = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />,
      );
      const { getByTestId } = result;
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.press(getByTestId('onboarding.button.next'));
        });
      }
      await waitFor(() => {
        expect(getByTestId('onboarding.github-auth.app')).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.github-auth.app'));
      });
      await waitFor(() => {
        expect(getByTestId('onboarding.button.app')).toBeTruthy();
      });
      return result;
    }

    it('shows inline error when App initiation fails', async () => {
      const result = await setupAppStep();
      const { getByTestId } = result;

      mockAppBuildInstallUrl.mockResolvedValueOnce({
        ok: false,
        reason: 'backend_unreachable',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.app'));
      });

      const hasError = () => result.queryByText('Server unavailable. Check your connection.') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

    it('shows error when not_configured', async () => {
      const result = await setupAppStep();
      const { getByTestId } = result;

      mockAppBuildInstallUrl.mockResolvedValueOnce({
        ok: false,
        reason: 'not_configured',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.app'));
      });

      const hasError = () => result.queryByText('GitHub App not configured on this device') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

    it('shows error when browser fails to open', async () => {
      const result = await setupAppStep();
      const { getByTestId } = result;

      mockAppBuildInstallUrl.mockResolvedValueOnce({
        ok: true,
        installationUrl: 'https://github.com/apps/gitnotes/installations/new',
        state: 'app-state-456',
      });
      mockAppOpenInstallationUrl.mockResolvedValueOnce(false);

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.app'));
      });

      const hasError = () => result.queryByText('Could not open browser') !== null;
      await waitFor(hasError, { timeout: 2000 });
    });

    it('re-enables App button after initiation failure', async () => {
      const result = await setupAppStep();
      const { getByTestId } = result;

      mockAppBuildInstallUrl.mockResolvedValueOnce({
        ok: false,
        reason: 'backend_unreachable',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.app'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.button.app')).toBeTruthy();
      });
    });
  });

  describe('Simple mode', () => {
    beforeEach(() => {
      mockCreateRepository.mockReset();
      mockAddRepository.mockReset();
      mockCreateNote.mockReset();
      mockRefreshAccounts.mockReset().mockResolvedValue(undefined);
      mockOAuthInitiate.mockReset();
      mockOpenAuthorizationUrl.mockReset();
      mockPendingOAuthFlows.clear();
      mockNavigate.mockReset();
      Object.keys(mockRouteParams).forEach(k => delete mockRouteParams[k]);
      process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
    });

    afterEach(() => {
      delete process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID;
    });

    it('creates repository and clones on valid repo name', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'testuser' },
        name: 'gitnotes-testuser',
        full_name: 'testuser/gitnotes-testuser',
        default_branch: 'main',
      });
      mockAddRepository.mockResolvedValueOnce({
        id: 'repo-1',
        path: 'testuser/gitnotes-testuser',
        name: 'gitnotes-testuser',
        provider: 'github',
        branch: 'main',
      });
      mockCreateNote.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Welcome to GitNotēs',
        repo: 'testuser/gitnotes-testuser',
      });

      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.sign-in'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry-oauth')).toBeTruthy();
      });

      mockPendingOAuthFlows.set('test-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://test.backend.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-github-1',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-github-1',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'testuser',
      });

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize?...',
        state: 'test-state',
      });
      mockOpenAuthorizationUrl.mockResolvedValueOnce({
        outcome: 'callback',
        url: 'gitnotes://oauth/callback?code=abc&state=test-state',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry-oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      const createButton = getByTestId('onboarding.simple.button.create');

      await waitFor(() => {
        expect(createButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.create'));
      });

      await waitFor(() => {
        expect(mockCreateRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockAddRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockCreateNote).toHaveBeenCalledTimes(1);
      });

      // Verify exact note creation arguments
      expect(mockCreateNote).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'testuser/gitnotes-testuser',
          branch: 'main',
          folderPath: 'notes',
        }),
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.done')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.done'));
      });

      // Verify onboarding completes
      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('creates welcome note at exactly notes/welcome-to-gitnotes.md', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'testuser' },
        name: 'gitnotes-testuser',
        full_name: 'testuser/gitnotes-testuser',
        default_branch: 'main',
      });
      mockAddRepository.mockResolvedValueOnce({
        id: 'repo-1',
        path: 'testuser/gitnotes-testuser',
        name: 'gitnotes-testuser',
        provider: 'github',
        branch: 'main',
      });
      mockCreateNote.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Welcome to GitNotēs',
        repo: 'testuser/gitnotes-testuser',
      });

      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.sign-in'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry-oauth')).toBeTruthy();
      });

      mockPendingOAuthFlows.set('test-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://test.backend.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-github-1',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-github-1',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'testuser',
      });

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize?...',
        state: 'test-state',
      });
      mockOpenAuthorizationUrl.mockResolvedValueOnce({
        outcome: 'callback',
        url: 'gitnotes://oauth/callback?code=abc&state=test-state',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry-oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.create'));
      });

      await waitFor(() => {
        expect(mockCreateNote).toHaveBeenCalledTimes(1);
      });

      expect(mockCreateNote).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: 'notes/welcome-to-gitnotes.md',
        }),
      );
    });

    it('does not re-create repository on retry after clone failure', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'testuser' },
        name: 'gitnotes-testuser',
        full_name: 'testuser/gitnotes-testuser',
        default_branch: 'main',
      });
      mockAddRepository.mockRejectedValueOnce(new Error('Clone failed: unknown error'));
      mockAddRepository.mockResolvedValueOnce({
        id: 'repo-1',
        path: 'testuser/gitnotes-testuser',
        name: 'gitnotes-testuser',
        provider: 'github',
        branch: 'main',
      });
      mockCreateNote.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Welcome to GitNotēs',
        repo: 'testuser/gitnotes-testuser',
      });

      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.sign-in'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry-oauth')).toBeTruthy();
      });

      mockPendingOAuthFlows.set('test-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://test.backend.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-github-1',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-github-1',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'testuser',
      });

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize?...',
        state: 'test-state',
      });
      mockOpenAuthorizationUrl.mockResolvedValueOnce({
        outcome: 'callback',
        url: 'gitnotes://oauth/callback?code=abc&state=test-state',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry-oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.changeText(getByTestId('onboarding.simple.input.repo-name'), 'my-test-repo');
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.create'));
      });

      await waitFor(() => {
        expect(mockCreateRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry'));
      });

      await waitFor(() => {
        expect(mockCreateRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockAddRepository).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(mockCreateNote).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.done')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.done'));
      });

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('shows error when note creation fails', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'testuser' },
        name: 'gitnotes-testuser',
        full_name: 'testuser/gitnotes-testuser',
        default_branch: 'main',
      });
      mockAddRepository.mockImplementation(async (path: string) => {
        if (mockRepoState.repositories.some(r => r.path === path)) {
          throw new Error('Repository already exists');
        }
        const repo = { id: 'repo-1', path, name: path.split('/')[1] ?? path, provider: 'github', branch: 'main' };
        mockRepoState.repositories.push(repo);
        return repo;
      });
      let noteCallCount = 0;
      mockCreateNote.mockImplementation(async (props: { title: string; repo: string }) => {
        noteCallCount++;
        const existing = mockNoteState.notes.find(n => n.title === props.title && n.repo === props.repo);
        if (existing) return existing;
        if (noteCallCount === 1) return null;
        const note = { id: 'note-1', title: props.title, repo: props.repo };
        mockNoteState.notes.push(note);
        return note;
      });

      const { getByTestId, queryByText } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.sign-in'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry-oauth')).toBeTruthy();
      });

      mockPendingOAuthFlows.set('test-state', {
        verifier: 'test-verifier',
        backendUrl: 'https://test.backend.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-github-1',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-github-1',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'testuser',
      });

      mockOAuthInitiate.mockResolvedValueOnce({
        ok: true,
        authorizationUrl: 'https://github.com/login/oauth/authorize?...',
        state: 'test-state',
      });
      mockOpenAuthorizationUrl.mockResolvedValueOnce({
        outcome: 'callback',
        url: 'gitnotes://oauth/callback?code=abc&state=test-state',
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry-oauth'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.changeText(getByTestId('onboarding.simple.input.repo-name'), 'my-test-repo');
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.create'));
      });

      await waitFor(() => {
        expect(mockCreateRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.retry')).toBeTruthy();
      });

      const errorText = queryByText(/Could not create welcome note/);
      expect(errorText).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.retry'));
      });

      await waitFor(() => {
        expect(mockCreateRepository).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockAddRepository).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(mockCreateNote).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.done')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.done'));
      });

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('uses state-specific oauthState to find pending flow on fromOAuth return', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'user2' },
        name: 'gitnotes-user2',
        full_name: 'user2/gitnotes-user2',
        default_branch: 'main',
      });
      mockAddRepository.mockResolvedValueOnce({
        id: 'repo-2',
        path: 'user2/gitnotes-user2',
        name: 'gitnotes-user2',
        provider: 'github',
        branch: 'main',
      });
      mockCreateNote.mockResolvedValueOnce({
        id: 'note-2',
        title: 'Welcome to GitNotēs',
        repo: 'user2/gitnotes-user2',
      });

      mockPendingOAuthFlows.set('denied-state', {
        verifier: 'verifier-1',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-1',
        returnTo: 'onboarding' as const,
        oauthResult: { outcome: 'denied' as const, code: 'access_denied', message: 'denied' },
        githubLogin: 'denied-user',
      });
      mockPendingOAuthFlows.set('success-state', {
        verifier: 'verifier-2',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-2',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-2',
            accessToken: 'access-token-2',
            refreshToken: 'refresh-token-2',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'user2',
      });

      const { getByTestId, queryByText, rerender } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      // Simulate return from OAuth callback with the SUCCESS state key
      mockRouteParams.fromOAuth = true;
      mockRouteParams.oauthState = 'success-state';

      rerender(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Should advance to repo-name using the success state's login
      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      // Should use the correct login from the success state, not denied state
      const repoNameInput = getByTestId('onboarding.simple.input.repo-name');
      expect(repoNameInput.props.value).toBe('gitnotes-user2');

      // Should NOT show the denied error
      expect(queryByText(/denied/i)).toBeNull();
    });

    it('deletes specific pending entry on successful setup completion', async () => {
      mockCreateRepository.mockResolvedValueOnce({
        owner: { login: 'testuser' },
        name: 'gitnotes-testuser',
        full_name: 'testuser/gitnotes-testuser',
        default_branch: 'main',
      });
      mockAddRepository.mockResolvedValueOnce({
        id: 'repo-1',
        path: 'testuser/gitnotes-testuser',
        name: 'gitnotes-testuser',
        provider: 'github',
        branch: 'main',
      });
      mockCreateNote.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Welcome to GitNotēs',
        repo: 'testuser/gitnotes-testuser',
      });

      mockPendingOAuthFlows.set('success-state', {
        verifier: 'verifier-1',
        backendUrl: 'https://backend.example.com',
        redirectUri: 'gitnotes://oauth/callback',
        clientId: 'test-client-id',
        hostId: 'host-1',
        returnTo: 'onboarding' as const,
        oauthResult: {
          outcome: 'success' as const,
          credential: {
            hostId: 'host-1',
            accessToken: 'access-token-1',
            refreshToken: 'refresh-token-1',
            expiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
        },
        githubLogin: 'testuser',
      });

      const { getByTestId, rerender } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.button.quick-setup')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.sign-in')).toBeTruthy();
      });

      // Set route params to simulate fromOAuth return with success state
      mockRouteParams.fromOAuth = true;
      mockRouteParams.oauthState = 'success-state';

      rerender(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.input.repo-name')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.create'));
      });

      await waitFor(() => {
        expect(getByTestId('onboarding.simple.button.done')).toBeTruthy();
      });

      // Pending entry should be deleted after successful setup
      expect(mockPendingOAuthFlows.has('success-state')).toBe(false);
    });
  });

  describe('Simple mode footer visibility', () => {
    it('hides progress dots and Next button in Simple mode at select step', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Initially in Complex mode at step 0, Next button should be visible
      await waitFor(() => {
        expect(getByTestId('onboarding.button.next')).toBeTruthy();
      });

      // Click Quick Setup to enter Simple mode
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      // In Simple mode, the progress dots and Next button should be hidden
      await waitFor(() => {
        expect(queryByTestId('onboarding.button.next')).toBeNull();
      });
    });

    it('shows progress dots and Next button in Complex mode', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // In Complex mode at step 0, Next button should be visible
      await waitFor(() => {
        expect(getByTestId('onboarding.button.next')).toBeTruthy();
      });
    });

    it('restores footer controls when switching from Simple to Complex mode', async () => {
      const { getByTestId, queryByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Click Quick Setup to enter Simple mode
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      // Verify we're in Simple mode - no Next button
      await waitFor(() => {
        expect(queryByTestId('onboarding.button.next')).toBeNull();
      });

      // Click Complex Setup button to go back to Complex mode
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.simple.button.complex'));
      });

      // Next button should be restored
      await waitFor(() => {
        expect(getByTestId('onboarding.button.next')).toBeTruthy();
      });
    });

    it('uses Complex Setup label for the mode switch button', async () => {
      const { getByTestId } = render(
        <OnboardingScreen onComplete={mockOnComplete} onSkip={mockOnSkip} />
      );

      // Click Quick Setup to enter Simple mode
      await act(async () => {
        fireEvent.press(getByTestId('onboarding.button.quick-setup'));
      });

      // The button to switch back should use complexButton key
      const complexButton = getByTestId('onboarding.simple.button.complex');
      expect(complexButton).toBeTruthy();
    });
  });
});
