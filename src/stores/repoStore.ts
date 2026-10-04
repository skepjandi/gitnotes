import { create } from 'zustand';
import { GitRepository, GitService } from '../services/GitService';
import { StorageService } from '../services/StorageService';
import { TemplateRepoPreferenceService } from '../services/TemplateRepoPreferenceService';
import { LastUsedRepoService } from '../services/LastUsedRepoService';
import { GitFsService } from '../services/git/GitFsService';
import { AccountStorage } from '../services/AccountStorage';
import { resolveGitHubRepoToken } from '../services/git/NativeCredentialBridge';
import { useAIStore } from './aiStore';
import { useNoteStore } from './noteStore';
import { useCanvasStore } from './canvasStore';
import { useTodoStore } from './todoStore';
import { GIT_HOST_LABELS, type GitHostProvider } from '../services/git/GitHost';
import { getActiveGitHost } from '../services/git/activeHost';
import {
  checkGitHubRepoAccess,
  RepoAccessPreflightError,
} from '../services/git/repoAccessPreflight';
import { reposAffectedByRemovedHosts, type RemovedHostRef } from '../services/git/repoRemovalCascade';
import { initializeForRepo, removeForRepo } from '../services/git/activeBranchStore';
import { setCredential } from '../services/git/engine/GitEngine';

interface RepoState {
  repositories: GitRepository[];
  isLoading: boolean;
}

export type AddRepositoryOptions = {
  readonly allowUnverifiedWrite?: boolean;
};

interface RepoActions {
  loadRepos: () => Promise<void>;
  addRepository: (
    path: string,
    nameOrOptions?: string | AddRepositoryOptions,
    provider?: GitHostProvider,
    options?: AddRepositoryOptions,
    hostId?: string,
  ) => Promise<GitRepository>;
  removeRepository: (path: string, provider?: GitHostProvider) => Promise<void>;
  removeRepositoriesForHosts: (
    removedHosts: RemovedHostRef[],
    providerAccountCount: ReadonlyMap<GitHostProvider, number>,
  ) => Promise<number>;
  refreshRepos: () => Promise<void>;
}

export const useRepoStore = create<RepoState & RepoActions>()((set, get) => ({
  repositories: [],
  isLoading: true,

  loadRepos: async () => {
    try {
      set({ isLoading: true });
      const repos = await StorageService.getSavedRepositories();
      set({ repositories: repos, isLoading: false });
    } catch (error) {
      console.error('[RepoStore] Failed to load repositories:', error);
      set({ isLoading: false });
    }
  },

  addRepository: async (path, nameOrOptions, provider, options, hostId) => {
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : undefined;
    const resolvedOptions = typeof nameOrOptions === 'object' ? nameOrOptions : options;
    const activeHost = await getActiveGitHost();
    const resolvedProvider = provider ?? activeHost?.provider ?? 'github';

    let hostToken: string | null = null;
    let hostInstanceBaseUrl: string | null = null;
    let hostLogin: string | null = null;

    if (hostId) {
      const hostConnection = await AccountStorage.getHostConnection(hostId);
      if (!hostConnection) {
        throw new Error(
          `No connected ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'} account. Add a ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'} connection first.`,
        );
      }
      hostToken = await AccountStorage.getHostToken(hostId);
      hostInstanceBaseUrl = hostConnection.instanceBaseUrl;
      hostLogin = hostConnection.hostLogin;
      // Use the host's actual provider for the preflight decision — not the
      // passed-in resolvedProvider.  This prevents a Forgejo hostId from ever
      // triggering GitHub preflight even when GitHub is the active host.
      if (hostConnection.provider === 'github') {
        hostToken = (await resolveGitHubRepoToken({
          repoId: path,
          hostId,
          repoFullName: path,
        })).token;
        const access = await checkGitHubRepoAccess(path, hostToken);
        switch (access.kind) {
          case 'ok':
            break;
          case 'write_unverified':
            if (!resolvedOptions?.allowUnverifiedWrite) {
              throw new RepoAccessPreflightError(access, true);
            }
            break;
          case 'no_access':
            throw new RepoAccessPreflightError(access);
          case 'transient':
            throw new RepoAccessPreflightError(access, true);
          default: {
            const exhaustiveCheck: never = access;
            return exhaustiveCheck;
          }
        }
      }
      if (!hostToken) {
        throw new Error(
          `No auth token for ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'}. Re-connect your ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'} account.`,
        );
      }
    } else if (activeHost) {
      hostToken = activeHost.token;
      hostInstanceBaseUrl = activeHost.instanceBaseUrl;
      const activeHostConnection = await AccountStorage.getHostConnection(activeHost.hostId);
      hostLogin = activeHostConnection?.hostLogin ?? null;
      if (resolvedProvider === 'github') {
        const access = await checkGitHubRepoAccess(path, activeHost.token);
        switch (access.kind) {
          case 'ok':
            break;
          case 'write_unverified':
            if (!resolvedOptions?.allowUnverifiedWrite) {
              throw new RepoAccessPreflightError(access, true);
            }
            break;
          case 'no_access':
            throw new RepoAccessPreflightError(access);
          case 'transient':
            throw new RepoAccessPreflightError(access, true);
          default: {
            const exhaustiveCheck: never = access;
            return exhaustiveCheck;
          }
        }
      }
    } else {
      throw new Error(
        `No connected ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'} account. Add a ${GIT_HOST_LABELS[resolvedProvider] ?? 'host'} connection first.`,
      );
    }

    const repo = await GitService.addRepository(path, name, resolvedProvider, hostId ?? activeHost?.hostId);

    try {
      await setCredential(repo.id, {
        kind: 'token',
        username: resolvedProvider === 'github' ? 'x-access-token' : hostLogin ?? 'git',
        token: hostToken,
      });
      await GitFsService.cloneExclusive({
        repoPath: repo.path,
        branch: repo.branch ?? 'main',
        token: hostToken,
        repoId: repo?.id,
        provider: repo.provider,
        instanceBaseUrl: hostInstanceBaseUrl,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Clone failed: ${msg}`);
    }

    await initializeForRepo(repo);

    const updated = await StorageService.getSavedRepositories();
    set({ repositories: updated });
    return repo;
  },

  removeRepository: async (path, provider = 'github') => {
    const repos = await StorageService.getSavedRepositories();
    const repo = repos.find((r) => r.path === path && (r.provider ?? 'github') === provider);
    if (repo) {
      await removeForRepo(repo.id);
    }
    await StorageService.removeRepository(path, provider);
    await StorageService.purgeRepoData(path);

    const template = await TemplateRepoPreferenceService.get();
    if (template?.repoPath === path) {
      await TemplateRepoPreferenceService.clear();
    }

    const lastUsed = await LastUsedRepoService.get();
    if (lastUsed === path) {
      await LastUsedRepoService.clear();
    }

    await GitFsService.removeRepo({ repoPath: path }).catch(() => undefined);

    const { chatRepoOwner, chatRepoName } = useAIStore.getState();
    if (chatRepoOwner && chatRepoName && `${chatRepoOwner}/${chatRepoName}` === path) {
      await useAIStore.getState().setChatRepo(null, null, 'main', null);
    }

    set((state) => ({
      repositories: state.repositories.filter(
        (r) => !(r.path === path && (r.provider ?? 'github') === provider),
      ),
    }));
    await Promise.all([
      useNoteStore.getState().refreshNotes(),
      useCanvasStore.getState().refreshCanvases(),
      useTodoStore.getState().refreshTodos(),
    ]);
  },

  removeRepositoriesForHosts: async (removedHosts, providerAccountCount) => {
    const targets = reposAffectedByRemovedHosts(get().repositories, removedHosts, providerAccountCount);
    for (const repo of targets) {
      await get().removeRepository(repo.path, repo.provider);
    }
    return targets.length;
  },

  refreshRepos: async () => {
    await get().loadRepos();
  },
}));
