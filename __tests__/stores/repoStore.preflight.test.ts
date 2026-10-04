/**
 * Regression tests for repoStore.addRepository preflight boundary.
 *
 * Exercises the actual Zustand action with mocked dependencies to verify:
 * - Preflight failures (no_access, transient, write_unverified without override)
 *   throw BEFORE GitService.addRepository, GitFsService.cloneExclusive, and
 *   initializeForRepo are called.
 * - write_unverified with { allowUnverifiedWrite: true } proceeds to registration.
 * - ok case proceeds to registration and clone.
 */

import { RepoAccessPreflightError } from '@/services/git/repoAccessPreflight';

jest.mock('@/services/git/repoAccessPreflight', () => ({
  ...jest.requireActual('@/services/git/repoAccessPreflight'),
  checkGitHubRepoAccess: jest.fn(),
}));

jest.mock('@/services/GitService', () => ({
  GitService: {
    addRepository: jest.fn(),
  },
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: {
    cloneExclusive: jest.fn(),
    removeRepo: jest.fn(),
  },
}));

jest.mock('@/services/git/activeBranchStore', () => ({
  initializeForRepo: jest.fn(),
  removeForRepo: jest.fn(),
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
    addRepository: jest.fn(),
    removeRepository: jest.fn(),
    purgeRepoData: jest.fn(),
  },
}));

jest.mock('@/services/git/activeHost', () => ({
  getActiveGitHost: jest.fn(),
}));

jest.mock('@/stores/noteStore', () => ({
  useNoteStore: {
    getState: jest.fn(() => ({
      refreshNotes: jest.fn(),
    })),
  },
}));

jest.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: jest.fn(() => ({
      refreshCanvases: jest.fn(),
    })),
  },
}));

jest.mock('@/stores/todoStore', () => ({
  useTodoStore: {
    getState: jest.fn(() => ({
      refreshTodos: jest.fn(),
    })),
  },
}));

jest.mock('@/stores/aiStore', () => ({
  useAIStore: {
    getState: jest.fn(() => ({
      chatRepoOwner: null,
      chatRepoName: null,
      setChatRepo: jest.fn(),
    })),
  },
}));

jest.mock('@/services/TemplateRepoPreferenceService', () => ({
  TemplateRepoPreferenceService: {
    get: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock('@/services/LastUsedRepoService', () => ({
  LastUsedRepoService: {
    get: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock('@/services/TemplateMarkdownService', () => ({
  serializeTemplate: jest.fn(),
  templateSlug: jest.fn(),
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getHostConnection: jest.fn(),
    getHostToken: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    getOAuthCredential: jest.fn(),
  },
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  setCredential: jest.fn(),
}));

import { checkGitHubRepoAccess } from '@/services/git/repoAccessPreflight';
import { GitService } from '@/services/GitService';
import { GitFsService } from '@/services/git/GitFsService';
import { initializeForRepo } from '@/services/git/activeBranchStore';
import { StorageService } from '@/services/StorageService';
import { getActiveGitHost } from '@/services/git/activeHost';
import { useRepoStore } from '@/stores/repoStore';
import { AccountStorage } from '@/services/AccountStorage';
import * as GitEngine from '@/services/git/engine/GitEngine';

const mockHost = {
  provider: 'github' as const,
  token: 'tok_test_abc123',
  hostId: 'host1',
  instanceBaseUrl: undefined,
};

const mockRepoResult = {
  id: 'github:12345',
  name: 'my-repo',
  path: 'me/my-repo',
  branch: 'main',
  provider: 'github' as const,
  hostId: 'host1',
};

describe('repoStore.addRepository preflight boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(GitService.addRepository).mockResolvedValue(mockRepoResult);
    jest.mocked(GitFsService.cloneExclusive).mockResolvedValue(undefined);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([mockRepoResult]);
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue(mockHost.token);
    useRepoStore.setState({ repositories: [], isLoading: false });
  });

  it('registers the selected host token before cloning', async () => {
    jest.mocked(checkGitHubRepoAccess).mockResolvedValue({ kind: 'ok' });

    await useRepoStore.getState().addRepository('me/my-repo');

    expect(GitEngine.setCredential).toHaveBeenCalledWith(
      mockRepoResult.id,
      { kind: 'token', username: 'x-access-token', token: mockHost.token },
    );
  });

  it('surfaces an actionable retry error for an Expo lazy-bundle failure', async () => {
    jest.mocked(checkGitHubRepoAccess).mockResolvedValue({ kind: 'ok' });
    jest.mocked(GitFsService.cloneExclusive).mockRejectedValue(
      new TypeError("Cannot read property 'reload' of undefined"),
    );

    await expect(useRepoStore.getState().addRepository('me/my-repo')).rejects.toThrow(
      'The app is still loading. Please try again.',
    );
  });

  // -----------------------------------------------------------------------
  // no_access — terminal, throws immediately before registration
  // -----------------------------------------------------------------------
  describe('no_access preflight failure', () => {
    it('throws RepoAccessPreflightError before calling GitService.addRepository', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'This GitHub repository is not accessible.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitService.addRepository).not.toHaveBeenCalled();
    });

    it('throws before calling GitFsService.cloneExclusive', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'This GitHub repository is not accessible.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitFsService.cloneExclusive).not.toHaveBeenCalled();
    });

    it('throws before calling initializeForRepo', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'This GitHub repository is not accessible.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(initializeForRepo).not.toHaveBeenCalled();
    });

    it('error canRetry is false (terminal — no retry)', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'This GitHub repository is not accessible.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toMatchObject({ canRetry: false });
    });
  });

  // -----------------------------------------------------------------------
  // transient — retryable, throws before registration
  // -----------------------------------------------------------------------
  describe('transient preflight failure', () => {
    it('throws RepoAccessPreflightError before calling GitService.addRepository', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'transient',
        message: 'Could not verify access right now.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitService.addRepository).not.toHaveBeenCalled();
    });

    it('throws before calling GitFsService.cloneExclusive', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'transient',
        message: 'Could not verify access right now.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitFsService.cloneExclusive).not.toHaveBeenCalled();
    });

    it('throws before calling initializeForRepo', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'transient',
        message: 'Could not verify access right now.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(initializeForRepo).not.toHaveBeenCalled();
    });

    it('error canRetry is true (retryable)', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'transient',
        message: 'Could not verify access right now.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toMatchObject({ canRetry: true });
    });
  });

  // -----------------------------------------------------------------------
  // write_unverified without override — throws before registration
  // -----------------------------------------------------------------------
  describe('write_unverified preflight failure (no override)', () => {
    it('throws RepoAccessPreflightError before calling GitService.addRepository', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitService.addRepository).not.toHaveBeenCalled();
    });

    it('throws before calling GitFsService.cloneExclusive', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitFsService.cloneExclusive).not.toHaveBeenCalled();
    });

    it('throws before calling initializeForRepo', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(initializeForRepo).not.toHaveBeenCalled();
    });

    it('error canRetry is true (user can override with Add Anyway)', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await expect(
        useRepoStore.getState().addRepository('me/my-repo'),
      ).rejects.toMatchObject({ canRetry: true });
    });
  });

  // -----------------------------------------------------------------------
  // write_unverified WITH override — proceeds to registration
  // -----------------------------------------------------------------------
  describe('write_unverified with allowUnverifiedWrite override', () => {
    it('calls GitService.addRepository when override is passed', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await useRepoStore.getState().addRepository('me/my-repo', undefined, 'github', {
        allowUnverifiedWrite: true,
      });

      expect(GitService.addRepository).toHaveBeenCalledWith(
        'me/my-repo',
        undefined,
        'github',
        mockHost.hostId,
      );
    });

    it('calls GitFsService.cloneExclusive after override', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await useRepoStore.getState().addRepository('me/my-repo', undefined, 'github', {
        allowUnverifiedWrite: true,
      });

      expect(GitFsService.cloneExclusive).toHaveBeenCalled();
    });

    it('calls initializeForRepo after override', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'write_unverified',
        message: 'Write access could not be verified.',
      });

      await useRepoStore.getState().addRepository('me/my-repo', undefined, 'github', {
        allowUnverifiedWrite: true,
      });

      expect(initializeForRepo).toHaveBeenCalledWith(mockRepoResult);
    });
  });

  // -----------------------------------------------------------------------
  // ok case — proceeds to registration
  // -----------------------------------------------------------------------
  describe('ok preflight result', () => {
    it('calls GitService.addRepository', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });

      await useRepoStore.getState().addRepository('me/my-repo');

      expect(GitService.addRepository).toHaveBeenCalledWith(
        'me/my-repo',
        undefined,
        'github',
        mockHost.hostId,
      );
    });

    it('calls GitFsService.cloneExclusive', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });

      await useRepoStore.getState().addRepository('me/my-repo');

      expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: mockRepoResult.path,
          branch: 'main',
          token: mockHost.token,
          repoId: mockRepoResult.id,
          provider: 'github',
        }),
      );
    });

    it('calls initializeForRepo', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });

      await useRepoStore.getState().addRepository('me/my-repo');

      expect(initializeForRepo).toHaveBeenCalledWith(mockRepoResult);
    });

    it('updates store repositories on success', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });

      await useRepoStore.getState().addRepository('me/my-repo');

      expect(useRepoStore.getState().repositories).toEqual([mockRepoResult]);
    });
  });

  // -----------------------------------------------------------------------
  // non-github provider skips preflight entirely
  // -----------------------------------------------------------------------
  describe('non-github provider skips preflight', () => {
    it('does not call checkGitHubRepoAccess for gitlab', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'Should not be called',
      });

      await useRepoStore.getState().addRepository('me/my-gitlab-repo', undefined, 'gitlab');

      expect(checkGitHubRepoAccess).not.toHaveBeenCalled();
    });

    it('still calls GitService.addRepository for gitlab', async () => {
      await useRepoStore.getState().addRepository('me/my-gitlab-repo', undefined, 'gitlab');

      expect(GitService.addRepository).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Regression: explicit forgejo provider skips github preflight
  // handleAddManualRepo (SettingsScreen) passes explicit provider so manual
  // Forgejo/Gitea input never hits github preflight regardless of active host.
  // -----------------------------------------------------------------------
  describe('manual add uses active host provider (not github default)', () => {
    const forgejoHost = {
      provider: 'forgejo' as const,
      token: 'tok_test_forgejo',
      hostId: 'host-forgejo',
      instanceBaseUrl: null,
      baseUrl: 'https://forgejo.example/api/v1',
    };

    it('does NOT call checkGitHubRepoAccess when active host is forgejo', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'Should not be called for Forgejo host',
      });
      jest.mocked(getActiveGitHost).mockResolvedValue(forgejoHost);

      await useRepoStore.getState().addRepository('me/my-forgejo-repo');

      expect(checkGitHubRepoAccess).not.toHaveBeenCalled();
    });

    it('github active host still runs github preflight (compatibility)', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });
      jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);

      await useRepoStore.getState().addRepository('me/my-github-repo');

      expect(checkGitHubRepoAccess).toHaveBeenCalledWith('me/my-github-repo', 'tok_test_abc123');
    });

    it('explicit forgejo provider skips github preflight regardless of active host', async () => {
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'Must not be called when provider is explicitly forgejo',
      });
      jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);

      await useRepoStore.getState().addRepository('me/my-forgejo-repo', undefined, 'forgejo');

      expect(checkGitHubRepoAccess).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Regression: manual add with explicit hostId uses that host's token/URL
  // and skips GitHub preflight for non-GitHub hosts even when GitHub is active.
  // -----------------------------------------------------------------------
  describe('manual add with explicit hostId', () => {
    const FORGEJO_HOST_A = {
      id: 'acc1:forgejo:forgejo.mycompany.com',
      accountId: 'acc1',
      provider: 'forgejo' as const,
      instanceBaseUrl: 'https://forgejo.mycompany.com',
      hostLogin: 'alice',
      hostUserId: 1,
      name: 'Alice',
      email: 'alice@mycompany.com',
      avatarUrl: null,
      addedAt: Date.now(),
    };

    const FORGEJO_HOST_B = {
      id: 'acc1:forgejo:forgejo2.mycompany.com',
      accountId: 'acc1',
      provider: 'forgejo' as const,
      instanceBaseUrl: 'https://forgejo2.mycompany.com',
      hostLogin: 'alice',
      hostUserId: 1,
      name: 'Alice',
      email: 'alice@mycompany.com',
      avatarUrl: null,
      addedAt: Date.now(),
    };

    const GITHUB_HOST = {
      id: 'acc2:github:default',
      accountId: 'acc2',
      provider: 'github' as const,
      instanceBaseUrl: null,
      hostLogin: 'bob',
      hostUserId: 2,
      name: 'Bob',
      email: 'bob@example.com',
      avatarUrl: null,
      addedAt: Date.now(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(getActiveGitHost).mockResolvedValue({
        provider: 'github' as const,
        token: 'tok_active_github',
        hostId: GITHUB_HOST.id,
        instanceBaseUrl: undefined,
      });
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });
    });

    it('does NOT call checkGitHubRepoAccess when forgejo hostId is passed even if github is active', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(FORGEJO_HOST_A);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_forgejo_host_a');
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'Must not be called for Forgejo hostId',
      });

      await useRepoStore.getState().addRepository(
        'me/my-forgejo-repo',
        undefined,
        'forgejo',
        undefined,
        FORGEJO_HOST_A.id,
      );

      expect(checkGitHubRepoAccess).not.toHaveBeenCalled();
    });

    it('uses the selected forgejo host token for clone', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(FORGEJO_HOST_A);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_forgejo_host_a');
      jest.mocked(GitService.addRepository).mockResolvedValue({
        id: `${FORGEJO_HOST_A.id}:me/my-forgejo-repo`,
        name: 'my-forgejo-repo',
        path: 'me/my-forgejo-repo',
        branch: 'main',
        provider: 'forgejo',
        hostId: FORGEJO_HOST_A.id,
      });

      await useRepoStore.getState().addRepository(
        'me/my-forgejo-repo',
        undefined,
        'forgejo',
        undefined,
        FORGEJO_HOST_A.id,
      );

      expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'tok_forgejo_host_a',
          instanceBaseUrl: 'https://forgejo.mycompany.com',
          provider: 'forgejo',
        }),
      );
    });

    it('two forgejo hosts remain distinguishable by hostId', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(FORGEJO_HOST_B);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_forgejo_host_b');
      jest.mocked(GitService.addRepository).mockResolvedValue({
        id: `${FORGEJO_HOST_B.id}:me/my-forgejo-repo`,
        name: 'my-forgejo-repo',
        path: 'me/my-forgejo-repo',
        branch: 'main',
        provider: 'forgejo',
        hostId: FORGEJO_HOST_B.id,
      });

      await useRepoStore.getState().addRepository(
        'me/my-forgejo-repo',
        undefined,
        'forgejo',
        undefined,
        FORGEJO_HOST_B.id,
      );

      expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'tok_forgejo_host_b',
          instanceBaseUrl: 'https://forgejo2.mycompany.com',
          provider: 'forgejo',
        }),
      );
    });

    it('github hostId still runs github preflight', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(GITHUB_HOST);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_explicit_github');
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'ok',
        writeVerified: true,
      });

      await useRepoStore.getState().addRepository(
        'me/my-github-repo',
        undefined,
        'github',
        undefined,
        GITHUB_HOST.id,
      );

      expect(checkGitHubRepoAccess).toHaveBeenCalledWith('me/my-github-repo', 'tok_explicit_github');
    });

    it('github preflight failure blocks add even with explicit github hostId', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(GITHUB_HOST);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_explicit_github');
      jest.mocked(checkGitHubRepoAccess).mockResolvedValue({
        kind: 'no_access',
        message: 'No access',
      });

      await expect(
        useRepoStore.getState().addRepository(
          'me/my-github-repo',
          undefined,
          'github',
          undefined,
          GITHUB_HOST.id,
        ),
      ).rejects.toThrow(RepoAccessPreflightError);

      expect(GitService.addRepository).not.toHaveBeenCalled();
    });

    it('passes hostId to GitService.addRepository for repo registration', async () => {
      jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(FORGEJO_HOST_A);
      jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok_forgejo_host_a');
      jest.mocked(GitService.addRepository).mockResolvedValue({
        id: `${FORGEJO_HOST_A.id}:me/my-forgejo-repo`,
        name: 'my-forgejo-repo',
        path: 'me/my-forgejo-repo',
        branch: 'main',
        provider: 'forgejo',
        hostId: FORGEJO_HOST_A.id,
      });

      await useRepoStore.getState().addRepository(
        'me/my-forgejo-repo',
        undefined,
        'forgejo',
        undefined,
        FORGEJO_HOST_A.id,
      );

      expect(GitService.addRepository).toHaveBeenCalledWith(
        'me/my-forgejo-repo',
        undefined,
        'forgejo',
        FORGEJO_HOST_A.id,
      );
    });

    it('waits for the local clone removal before completing repository removal', async () => {
      jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
        {
          id: 'repo-forgejo',
          path: 'me/my-forgejo-repo',
          name: 'my-forgejo-repo',
          provider: 'forgejo',
          hostId: FORGEJO_HOST_A.id,
        },
      ]);
      jest.mocked(GitFsService.removeRepo).mockResolvedValue(undefined);

      await useRepoStore.getState().removeRepository('me/my-forgejo-repo', 'forgejo');

      expect(GitFsService.removeRepo).toHaveBeenCalledWith({ repoPath: 'me/my-forgejo-repo' });
    });
  });
});
