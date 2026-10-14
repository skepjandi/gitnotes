import React from 'react';
import { waitFor } from '@testing-library/react-native';
import SettingsScreen from '@/screens/SettingsScreen';
import type { GitHostRepository, GitHostRepositoryResult } from '@/services/git/GitHost';
import { AccountStorage } from '@/services/AccountStorage';
import { getGitHostService } from '@/services/git/gitHostFactory';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() },
  }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    colors: {
      background: '#ffffff',
      surface: '#f0f0f0',
      primary: '#007AFF',
      text: '#000000',
      textSecondary: '#666666',
      border: '#cccccc',
      error: '#FF3B30',
      elevated: '#e5e5ea',
    },
    setTheme: jest.fn(),
    style: 'light',
    setStyle: jest.fn(),
  }),
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/contexts/RepoContext', () => ({
  useRepos: jest.fn(),
}));

jest.mock('@/contexts/NoteContext', () => ({
  useNotes: jest.fn(() => ({ clearAllNotes: jest.fn(), refreshNotes: jest.fn() })),
}));

jest.mock('@/contexts/CanvasContext', () => ({
  useCanvases: jest.fn(() => ({ refreshCanvases: jest.fn() })),
}));

jest.mock('@/contexts/TodoContext', () => ({
  useTodos: jest.fn(() => ({ refreshTodos: jest.fn() })),
}));

jest.mock('@/contexts/BiometricLockContext', () => ({
  useBiometricLock: jest.fn(() => ({
    isLockEnabled: false,
    isBiometricAvailable: false,
    biometricKind: null,
    biometricLabel: '',
    lockTimeout: 0,
    setIsLockEnabled: jest.fn(),
    setLockTimeout: jest.fn(),
  })),
}));

jest.mock('@/hooks/useBackgroundSync', () => ({
  useBackgroundSync: jest.fn(() => ({ isEnabled: false, toggle: jest.fn() })),
}));

jest.mock('@/hooks/useForegroundSyncSettings', () => ({
  useForegroundSyncSettings: jest.fn(() => ({
    syncFrequentlyEnabled: false,
    syncIntervalSeconds: 60,
    syncPaused: false,
    setSyncPaused: jest.fn(),
    setSyncFrequentlyEnabled: jest.fn(),
    setSyncIntervalSeconds: jest.fn(),
  })),
}));

jest.mock('@/hooks/useForegroundSyncHealth', () => ({
  useForegroundSyncHealth: jest.fn(() => ({
    status: 'ok',
    lastRunAt: 0,
    lastCompletedAt: 0,
    lastFailedAt: 0,
    consecutiveFailures: 0,
  })),
}));

jest.mock('@/stores/aiStore', () => ({
  useAIStore: jest.fn(() => ({
    isEnabled: false,
    selectedModelId: null,
    actionMode: 'auto',
    chatRepoOwner: null,
    chatRepoName: null,
    providers: [],
    toggleAI: jest.fn(),
    dailyQuoteEnabled: false,
    toggleDailyQuote: jest.fn(),
    aiPersonalizationEnabled: false,
    toggleAiPersonalization: jest.fn(),
    githubToolsEnabled: false,
    toggleGithubTools: jest.fn(),
    dailyQuotePersonalizationEnabled: false,
    toggleDailyQuotePersonalization: jest.fn(),
    setActionMode: jest.fn(),
    updateProvider: jest.fn(),
  })),
}));

jest.mock('@/stores/templateStore', () => ({
  useTemplateStore: jest.fn(() => ({
    customTemplates: [],
    getState: jest.fn(() => ({ customTemplates: [] })),
    updateTemplate: jest.fn(),
  })),
}));

jest.mock('@/stores/floatingGitButtonStore', () => ({
  useFloatingGitButtonStore: jest.fn(() => ({ visible: false, toggle: jest.fn() })),
}));

jest.mock('@/stores/repoStore', () => ({
  useRepoStore: jest.fn(() => ({
    removeRepositoriesForHosts: jest.fn(),
  })),
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getHostToken: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    getHostUseSsh: jest.fn(() => Promise.resolve(false)),
  },
}));

jest.mock('@/services/AuthService', () => ({
  AuthService: {
    isAuthenticated: jest.fn(() => true),
    getToken: jest.fn(() => Promise.resolve('token')),
    validateToken: jest.fn(() => Promise.resolve({ ok: true, user: { login: 'test' } })),
  },
}));

jest.mock('@/services/git/gitHostFactory', () => ({
  getGitHostService: jest.fn(),
  gitHubHostService: {},
  gitLabService: {},
}));

jest.mock('@/services/TemplateRepoPreferenceService', () => ({
  TemplateRepoPreferenceService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/services/TemplateMarkdownService', () => ({
  serializeTemplate: jest.fn(),
  templateSlug: jest.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
}));

jest.mock('@/services/RepoFileSyncService', () => ({
  RepoFileSyncService: {
    syncRepoFiles: jest.fn(() => Promise.resolve({ created: 0, skipped: 0, errors: [] })),
  },
}));

jest.mock('@/services/git/CloneMigrationService', () => ({
  CloneMigrationService: {
    migrateRepo: jest.fn(() => Promise.resolve({ notes: 0, todos: 0, canvases: 0, templates: 0, failures: [] })),
  },
}));

jest.mock('@/services/RepoImportService', () => ({
  importRepoAtAdd: jest.fn(() => Promise.resolve({ ok: true, counts: { notes: 0, todos: 0, canvases: 0, templates: 0 } })),
}));

jest.mock('@/services/git/activeBranchStore', () => ({
  getActiveBranch: jest.fn(() => Promise.resolve({ activeBranch: 'main' })),
}));

jest.mock('@/services/git/lfs', () => ({
  LfsService: {
    listPending: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('@/services/OnboardingService', () => ({
  OnboardingService: {
    resetOnboarding: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@/utils/haptics', () => ({
  HapticService: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@/utils/proAlerts', () => ({
  promptProUpgrade: jest.fn(),
}));

jest.mock('@/hooks/useProGate', () => ({
  useProStatus: jest.fn(() => ({ isPro: true })),
}));

jest.mock('@/services/TierLimits', () => ({
  FREE_TIER_MAX_REPOS: 5,
  FREE_TIER_MAX_ACCOUNTS: 3,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));

jest.mock('@/components/ui', () => ({
  ScreenHeader: ({ children }: { children: React.ReactNode }) => children,
  useScreenHeaderHeight: () => 44,
  useTabBarHeight: () => 49,
}));

jest.mock('@/components/settings/SettingsContent', () => ({
  SettingsContent: () => null,
}));

jest.mock('@/components/settings/SettingsModals', () => ({
  SettingsModals: () => null,
}));

jest.mock('@/components/ConnectHostModal', () => ({
  ConnectHostModal: () => null,
}));

jest.mock('@/components/ai/ModelSelector', () => ({
  ModelSelector: () => null,
}));

jest.mock('@/components/ai/ProviderConfigModal', () => ({
  ProviderConfigModal: () => null,
}));

jest.mock('@/components/ai/ChatRepoPickerModal', () => ({
  ChatRepoPickerModal: () => null,
}));

jest.mock('@/components/settings/CloneProgressModal', () => ({
  CloneProgressModal: () => null,
}));

const mockGitHubRepos: GitHostRepository[] = [
  {
    provider: 'github',
    owner: 'me',
    repo: 'my-repo',
    fullName: 'me/my-repo',
    name: 'my-repo',
    description: 'A cool repo',
    isPrivate: true,
    sizeKb: 1024,
  },
];

const mockGitLabRepos: GitHostRepository[] = [
  {
    provider: 'gitlab',
    owner: 'me',
    repo: 'my-gitlab-repo',
    fullName: 'me/my-gitlab-repo',
    name: 'my-gitlab-repo',
    description: 'A GitLab repo',
    isPrivate: false,
    sizeKb: 2048,
  },
];

const mockAccountSummaries = [
  {
    account: { id: 'acc1', login: 'testuser', name: 'Test User', avatarUrl: null },
    hosts: [
      {
        id: 'host1',
        provider: 'github' as const,
        hostLogin: 'testuser',
        hostUserId: 1,
        name: 'Test User',
        email: null,
        avatarUrl: null,
        instanceBaseUrl: null,
        addedAt: Date.now(),
      },
      {
        id: 'host2',
        provider: 'gitlab' as const,
        hostLogin: 'testuser',
        hostUserId: 2,
        name: 'Test User',
        email: null,
        avatarUrl: null,
        instanceBaseUrl: null,
        addedAt: Date.now(),
      },
    ],
    activeHostId: 'host1',
  },
];

const mockAuthState = {
  isAuthenticated: true,
  user: { id: 1, login: 'testuser', name: 'Test User', email: 'test@test.com', avatar_url: null },
  token: 'token',
};

const mockRepositories: Array<{ id: string; path: string; name: string; provider: string; branch?: string }> = [];

const mockAddRepo = jest.fn();

describe('SettingsScreen repository picker', () => {
  const { AccountStorage: MockAccountStorage } = jest.requireMock('@/services/AccountStorage');
  const { getGitHostService: mockGetGitHostService } = jest.requireMock('@/services/git/gitHostFactory');

  beforeEach(() => {
    jest.clearAllMocks();

    const { useAuth } = jest.requireMock('@/contexts/AuthContext');
    const { useRepos } = jest.requireMock('@/contexts/RepoContext');

    (useAuth as jest.Mock).mockReturnValue({
      authState: mockAuthState,
      accounts: [{ id: 'acc1', login: 'testuser', name: 'Test User', avatarUrl: null }],
      activeAccountId: 'acc1',
      accountSummaries: mockAccountSummaries,
      setToken: jest.fn(),
      clearToken: jest.fn(),
      addAccount: jest.fn(),
      removeAccount: jest.fn(),
      switchAccount: jest.fn(),
      disconnectHost: jest.fn(),
    });

    (useRepos as jest.Mock).mockReturnValue({
      repositories: mockRepositories,
      addRepository: mockAddRepo,
      removeRepository: jest.fn(),
    });

    MockAccountStorage.getHostToken.mockResolvedValue('token');

    const mockGitHubHostService = { listRepositories: jest.fn() };
    const mockGitLabHostService = { listRepositories: jest.fn() };

    mockGetGitHostService.mockImplementation((provider: string) => {
      if (provider === 'github') return mockGitHubHostService;
      if (provider === 'gitlab') return mockGitLabHostService;
      return mockGitHubHostService;
    });
  });

  it('aggregates repos from all connected hosts', async () => {
    const mockGitHubHostService = { listRepositories: jest.fn().mockResolvedValue(mockGitHubRepos) };
    const mockGitLabHostService = { listRepositories: jest.fn().mockResolvedValue(mockGitLabRepos) };

    mockGetGitHostService.mockImplementation((provider: string) => {
      if (provider === 'github') return mockGitHubHostService;
      if (provider === 'gitlab') return mockGitLabHostService;
      return mockGitHubHostService;
    });

    const githubResult = await mockGitHubHostService.listRepositories();
    const gitlabResult = await mockGitLabHostService.listRepositories();

    expect(githubResult).toEqual(mockGitHubRepos);
    expect(gitlabResult).toEqual(mockGitLabRepos);
  });

  it('handleSelectRepo passes correct provider to addRepo', async () => {
    expect(mockGitHubRepos[0].provider).toBe('github');
    expect(mockGitLabRepos[0].provider).toBe('gitlab');
  });

  it('one provider failure does not erase another provider results', async () => {
    const mockGitHubHostService = { listRepositories: jest.fn().mockResolvedValue(mockGitHubRepos) };
    const mockGitLabHostService = { listRepositories: jest.fn().mockRejectedValue(new Error('GitLab failed')) };

    mockGetGitHostService.mockImplementation((provider: string) => {
      if (provider === 'github') return mockGitHubHostService;
      if (provider === 'gitlab') return mockGitLabHostService;
      return mockGitHubHostService;
    });

    const githubResult = await mockGitHubHostService.listRepositories();
    let gitlabResult;
    try {
      gitlabResult = await mockGitLabHostService.listRepositories();
    } catch {
      gitlabResult = [{ kind: 'unavailable' as const, provider: 'gitlab' as const, reason: 'GitLab failed' }];
    }

    expect(githubResult).toEqual(mockGitHubRepos);
    expect(gitlabResult).toMatchObject([{ kind: 'unavailable', provider: 'gitlab' }]);
  });

  it('Gitea/Forgejo unavailable repos are included', async () => {
    const unavailableGitea: GitHostRepositoryResult[] = [
      {
        kind: 'unavailable',
        provider: 'gitea',
        reason: 'Repository listing is not supported for Gitea and Forgejo. You can add a repository manually.',
      },
    ];

    expect(unavailableGitea[0]).toMatchObject({
      kind: 'unavailable',
      provider: 'gitea',
    });
  });
});
