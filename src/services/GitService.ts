/**
 * GitService — provides a stable interface over Git host operations.
 *
 * Repository list lives in AsyncStorage via StorageService. Branch and tree
 * data is fetched from the GitHub/GitLab REST API and cached in memory + AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService } from './StorageService';
import { AuthService } from './AuthService';
import { parseRepoPath } from '../utils/gitPathParser';
import { fetchGitHubDefaultBranch, fetchGitLabDefaultBranch, fetchGiteaLikeDefaultBranch } from './git/branchResolver';
import type { GitHostProvider } from './git/GitHost';
import { getGitHostService } from './git/gitHostFactory';
import { getActiveGitHost } from './git/activeHost';
import { resolveGitHubRepoToken } from './git/NativeCredentialBridge';

export interface GitRepository {
  id: string;
  path: string;
  full_name?: string;
  name: string;
  branch?: string;
  provider?: GitHostProvider;
  hostId?: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
}

export interface GitRepositoryFolder {
  name: string;
  path: string;
  parentPath: string | null;
}

const GITHUB_API_BASE = 'https://api.github.com';
const CACHE_PREFIX = '@gitnotes:github_cache_';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export class GitService {
  static async addRepository(
    path: string,
    name?: string,
    provider: GitHostProvider = 'github',
    hostId?: string,
  ): Promise<GitRepository> {
    try {
      const repoName = name || path.split('/').pop() || path;
      // Use the active host's token so private repos authenticate consistently
      // throughout the addRepository flow (preflight + branch resolution).
      const activeHost = await getActiveGitHost();
       let token = activeHost?.token ?? null;
       if (provider === 'github' && hostId) {
         token = (await resolveGitHubRepoToken({
           repoId: path,
           hostId,
           repoFullName: path,
         })).token;
       }
      let branch: string | undefined;
      if (provider === 'gitlab') {
        branch = (await fetchGitLabDefaultBranch(path, token)) ?? undefined;
      } else if (provider === 'github') {
        branch = (await fetchGitHubDefaultBranch(path, token)) ?? undefined;
      } else if (provider === 'gitea' || provider === 'forgejo') {
        branch = (await fetchGiteaLikeDefaultBranch(path)) ?? undefined;
      } else {
        branch = (await fetchGitHubDefaultBranch(path, token)) ?? undefined;
      }
      const repo: GitRepository = {
        id: `${provider}:${Date.now()}`,
        name: repoName,
        path: path,
        full_name: path,
        branch,
        provider,
        hostId,
      };

      await StorageService.addRepository(repo);
      return repo;
    } catch (error) {
      console.error('[GitService] Failed to add repository:', error);
      throw new Error(
        `Failed to add repository: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static async getBranches(
    repoPath: string,
    provider: GitHostProvider = 'github',
    authToken?: string,
  ): Promise<GitBranch[]> {
    const cacheKey = `branches_${provider}_${repoPath.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const cached = await this.getCachedData<GitBranch[]>(cacheKey);
    if (cached) return cached;

    const repoInfo = parseRepoPath(repoPath);
    if (repoInfo) {
      try {
        const host = getGitHostService(provider);
        const hostBranches = await host.listBranches(repoInfo.owner, repoInfo.repo);
        if (hostBranches.length > 0) {
          const result = hostBranches.map((b) => ({
            name: b.name,
            isCurrent: b.isDefault ?? false,
          }));
          await this.setCachedData(cacheKey, result);
          return result;
        }

        const token = authToken ?? (provider === 'github' ? await AuthService.getToken() : null);
        if (provider === 'github' && !token) {
          const fetchedToken = await AuthService.getToken();
          if (fetchedToken) {
            const branchesUrl = `${GITHUB_API_BASE}/repos/${repoInfo.owner}/${repoInfo.repo}/branches`;
            const metaUrl = `${GITHUB_API_BASE}/repos/${repoInfo.owner}/${repoInfo.repo}`;
            const [ghBranches, ghMeta] = await Promise.all([
              this.fetchFromGitHub<Array<{ name: string }>>(branchesUrl, fetchedToken),
              this.fetchFromGitHub<{ default_branch?: string }>(metaUrl, fetchedToken),
            ]);
            if (ghBranches && ghBranches.length > 0) {
              const defaultBranch = ghMeta?.default_branch;
              const result = ghBranches.map((b) => ({
                name: b.name,
                isCurrent: defaultBranch ? b.name === defaultBranch : false,
              }));
              await this.setCachedData(cacheKey, result);
              return result;
            }
          }
        } else if (token) {
          const branchesUrl = `${GITHUB_API_BASE}/repos/${repoInfo.owner}/${repoInfo.repo}/branches`;
          const metaUrl = `${GITHUB_API_BASE}/repos/${repoInfo.owner}/${repoInfo.repo}`;
          const [ghBranches, ghMeta] = await Promise.all([
            this.fetchFromGitHub<Array<{ name: string }>>(branchesUrl, token),
            this.fetchFromGitHub<{ default_branch?: string }>(metaUrl, token),
          ]);
          if (ghBranches && ghBranches.length > 0) {
            const defaultBranch = ghMeta?.default_branch;
            const result = ghBranches.map((b) => ({
              name: b.name,
              isCurrent: defaultBranch ? b.name === defaultBranch : false,
            }));
            await this.setCachedData(cacheKey, result);
            return result;
          }
        }
      } catch (error) {
        console.warn('[GitService] host listBranches failed:', error);
      }
    }

    return [];
  }

  static async getRepositoryFolders(
    repoPath: string,
    branch?: string,
    provider: GitHostProvider = 'github',
  ): Promise<GitRepositoryFolder[]> {
    const branchKey = branch || 'HEAD';
    const cacheKey = `repo_folders_${provider}_${repoPath.replace(/[^a-zA-Z0-9]/g, '_')}_${branchKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const cached = await this.getCachedData<GitRepositoryFolder[]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    const repoInfo = parseRepoPath(repoPath);
    if (!repoInfo) {
      return [];
    }

    let tree: { path: string; type: 'blob' | 'tree'; sha: string }[] = [];
    try {
      const host = getGitHostService(provider);
      const hostTree = await host.getTreeRecursive(repoInfo.owner, repoInfo.repo, branchKey);
      tree = hostTree.map((e) => ({ path: e.path, type: e.type, sha: e.sha }));
    } catch (error) {
      console.warn('[GitService] host getTreeRecursive failed:', error);
    }

    if (tree.length === 0) {
      return [];
    }

    const folders = tree
      .filter((entry) => entry.type === 'tree' && Boolean(entry.path))
      .map((entry) => {
        const cleanPath = entry.path.replace(/^\/+/, '').replace(/\/+$/, '');
        const lastSlashIndex = cleanPath.lastIndexOf('/');
        const parentPath = lastSlashIndex >= 0 ? cleanPath.substring(0, lastSlashIndex) : null;

        return {
          name: lastSlashIndex >= 0 ? cleanPath.substring(lastSlashIndex + 1) : cleanPath,
          path: cleanPath,
          parentPath,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    await this.setCachedData(cacheKey, folders);
    return folders;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private static memCache = new Map<string, CacheEntry<unknown>>();
  private static readonly MEM_CACHE_MAX = 64;

  private static memCacheGet<T>(key: string): T | null {
    const entry = this.memCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      this.memCache.delete(key);
      return null;
    }
    this.memCache.delete(key);
    this.memCache.set(key, entry);
    return entry.data;
  }

  private static memCacheSet<T>(key: string, data: T): void {
    this.memCache.set(key, { data, timestamp: Date.now() });
    while (this.memCache.size > this.MEM_CACHE_MAX) {
      const oldest = this.memCache.keys().next().value;
      if (oldest === undefined) break;
      this.memCache.delete(oldest);
    }
  }

  private static async getCachedData<T>(key: string): Promise<T | null> {
    const memHit = this.memCacheGet<T>(key);
    if (memHit !== null) return memHit;
    try {
      const cached = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return null;

      const entry: CacheEntry<T> = JSON.parse(cached);
      if (Date.now() - entry.timestamp > CACHE_DURATION) {
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      this.memCacheSet(key, entry.data);
      return entry.data;
    } catch (error) {
      console.warn('[GitService] getCachedData failed:', error);
      return null;
    }
  }

  private static async setCachedData<T>(key: string, data: T): Promise<void> {
    this.memCacheSet(key, data);
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('[GitService] Failed to cache data:', error);
    }
  }

  private static async fetchFromGitHub<T>(url: string, authToken?: string): Promise<T | null> {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const response = await fetch(url, { headers });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.warn(`[GitService] GitHub API auth error: ${response.status} - missing or invalid token`);
        } else if (response.status !== 404) {
          console.warn(`[GitService] GitHub API error: ${response.status}`);
        }
        return null;
      }

      return await response.json();
    } catch (error) {
      console.warn('[GitService] GitHub API fetch failed:', error);
      return null;
    }
  }

  static async clearCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      await AsyncStorage.multiRemove(cacheKeys);
      this.memCache.clear();
    } catch (error) {
      console.warn('[GitService] Failed to clear cache:', error);
    }
  }

  static async invalidateRepoFoldersCache(
    repoPath: string,
    branch?: string,
    provider: GitHostProvider = 'github',
  ): Promise<void> {
    const branchKey = branch || 'HEAD';
    const cacheKey = `repo_folders_${provider}_${repoPath.replace(/[^a-zA-Z0-9]/g, '_')}_${branchKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
    this.memCache.delete(cacheKey);
    try {
      await AsyncStorage.removeItem(CACHE_PREFIX + cacheKey);
    } catch (error) {
      console.warn('[GitService] Failed to invalidate folders cache:', error);
    }
  }
}

export default GitService;
