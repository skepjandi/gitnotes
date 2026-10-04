import {
  GitHubService,
  GitHubServiceStatic,
  GitHubUser,
  GitHubContent,
  GitHubIssue,
  ShaResult,
} from '../GitHubService';
import type {
  GitHostBranch,
  GitHostContent,
  GitHostIssue,
  GitHostItemState,
  GitHostPullRequest,
  GitHostRepository,
  GitHostRepositoryResult,
  GitHostService,
  GitHostShaResult,
  GitHostTreeEntry,
  GitHostUser,
  GitHostWriteService,
} from './GitHost';
import { AccountStorage } from '../AccountStorage';

interface GitHubBranch {
  name: string;
}

interface GitHubRepoMeta {
  default_branch?: string;
}

interface GitHubIssueWithAuthor extends GitHubIssue {
  user?: { login?: string } | null;
}

/**
 * Adapts the existing GitHubService to the GitHostService interface.
 *
 * The adapter is intentionally thin: it only translates types and does
 * not duplicate the heavy lifting (auth, request signing, sha cache,
 * tree walker). All state lives on `GitHubService`.
 */
export class GitHubHostService implements GitHostService, GitHostWriteService {
  readonly provider = 'github' as const;

  async getAuthenticatedUser(): Promise<GitHostUser | null> {
    const user: GitHubUser | null = GitHubService.getUser();
    if (!user) return null;
    return {
      id: user.id,
      login: user.login,
      name: user.name ?? null,
      email: user.email ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string | null> {
    try {
      const data = await GitHubServiceStatic.getRepoMeta(owner, repo);
      return data?.default_branch ?? null;
    } catch {
      return null;
    }
  }

  async listBranches(owner: string, repo: string): Promise<GitHostBranch[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const [branches, repoMeta] = await Promise.all([
      GitHubServiceStatic.rawGet<GitHubBranch[]>(
        `https://api.github.com/repos/${owner}/${repo}/branches`,
      ),
      GitHubServiceStatic.rawGet<GitHubRepoMeta>(url).catch(() => null),
    ]);
    if (!branches) return [];
    const defaultBranch = repoMeta?.default_branch;
    return branches.map((b: GitHubBranch) => ({
      name: b.name,
      isDefault: defaultBranch ? b.name === defaultBranch : false,
    }));
  }

  async getTreeRecursive(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<GitHostTreeEntry[]> {
    try {
      // Delegate to GitHubService.getTreeRecursive so the tree walker
      // uses the active auth token (GitHubService.rawGet is
      // unauthenticated and would fail for private repos).
      const tree = await GitHubService.getTreeRecursive(owner, repo, ref);
      if (!Array.isArray(tree)) return [];
      return tree
        .filter((e) => (e.type === 'tree' || e.type === 'blob') && Boolean(e.path))
        .map((e) => ({ path: e.path, type: e.type as 'tree' | 'blob', sha: e.sha, size: e.size }));
    } catch (error) {
      console.warn('[GitHubHostService] getTreeRecursive failed:', error);
      return [];
    }
  }

  async listContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHostContent[]> {
    const items: GitHubContent[] = await GitHubService.getRepoContents(
      owner,
      repo,
      path,
      ref,
    );
    return items.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      sha: item.sha,
      downloadUrl: item.download_url ?? null,
    }));
  }

  async getFileText(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      // Delegate to GitHubService.getFileContent so the read uses the
      // active auth token. rawGet is unauthenticated and would fail
      // for private repos (#733 image uploads rely on this path).
      // getFileContent already returns a decoded string, or null
      // when the path is missing / a directory / unreadable.
      return await GitHubService.getFileContent(owner, repo, path, ref);
    } catch (error) {
      console.warn('[GitHubHostService] getFileText failed:', error);
      return null;
    }
  }

  async listPullRequests(
    owner: string,
    repo: string,
    state: GitHostItemState = 'open',
  ): Promise<GitHostPullRequest[]> {
    const prs = await GitHubService.getPullRequests(owner, repo, state);
    return prs.map(
      (p): GitHostPullRequest => ({
        id: p.id,
        number: p.number,
        title: p.title,
        state: p.state === 'open' ? 'open' : 'closed',
        webUrl: p.html_url,
        headBranch: '',
        baseBranch: '',
        author: p.user?.login,
        draft: p.draft,
        createdAt: p.created_at,
      }),
    );
  }

  async listIssues(
    owner: string,
    repo: string,
    state: GitHostItemState = 'open',
  ): Promise<GitHostIssue[]> {
    const issues = (await GitHubService.getIssues(owner, repo, state)) as GitHubIssueWithAuthor[];
    return issues.map(
      (i): GitHostIssue => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state === 'open' ? 'open' : 'closed',
        webUrl: i.html_url,
        labels: (i.labels ?? []).map((label) => label.name),
        author: i.user?.login ?? undefined,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      }),
    );
  }

  async listRepositories(hostId?: string): Promise<GitHostRepositoryResult[]> {
    const results: GitHostRepository[] = [];
    const seen = new Map<string, number>();

    const addRepo = (repo: GitHostRepository) => {
      const key = repo.fullName.toLowerCase();
      const existingIndex = seen.get(key);
      if (existingIndex === undefined) {
        seen.set(key, results.length);
        results.push(repo);
        return;
      }

      const existing = results[existingIndex];
      results[existingIndex] = {
        ...existing,
        description: existing.description ?? repo.description,
        defaultBranch: existing.defaultBranch ?? repo.defaultBranch,
        sizeKb: existing.sizeKb ?? repo.sizeKb,
      };
    };

    // Track which sources failed
    let appSourceFailed = false;
    let oauthSourceFailed = false;
    let patSourceFailed = false;
    let lastError: Error | null = null;

    // 1. App repos (always include if available)
    if (hostId) {
      const appCred = await AccountStorage.getGitHubAppCredential(hostId);
      if (appCred && appCred.selectedRepositories.length > 0) {
        for (const r of appCred.selectedRepositories) {
          addRepo({
            provider: 'github',
            owner: r.owner,
            repo: r.repo,
            fullName: `${r.owner}/${r.repo}`,
            name: r.repo,
            description: null,
            isPrivate: true,
            hostId,
          });
        }
      } else {
        appSourceFailed = true;
      }
    } else {
      appSourceFailed = true;
    }

    // 2. OAuth repos via credentialKind='oauth'
    if (hostId) {
      const oauthCred = await AccountStorage.getOAuthCredential(hostId);
      if (oauthCred) {
        try {
          const repos = await GitHubService.getRepositories({ credentialKind: 'oauth', hostId });
          for (const r of repos) {
            addRepo({
              provider: 'github',
              owner: r.owner.login,
              repo: r.name,
              fullName: r.full_name,
              name: r.name,
              description: r.description ?? null,
              isPrivate: r.private,
              sizeKb: r.size,
              hostId,
            });
          }
        } catch (error) {
          oauthSourceFailed = true;
          if (!lastError) {
            lastError = error instanceof Error ? error : null;
          }
        }
      } else {
        oauthSourceFailed = true;
      }
    } else {
      oauthSourceFailed = true;
    }

    // 3. PAT repos via getHostToken (if different from OAuth token)
    if (hostId) {
      const patToken = await AccountStorage.getHostToken(hostId);
      const oauthCred = await AccountStorage.getOAuthCredential(hostId);
      const oauthTokenValue = oauthCred?.accessToken ?? null;
      if (patToken && patToken !== oauthTokenValue) {
        try {
          const repos = await GitHubService.getRepositories({ tokenOverride: patToken });
          for (const r of repos) {
            addRepo({
              provider: 'github',
              owner: r.owner.login,
              repo: r.name,
              fullName: r.full_name,
              name: r.name,
              description: r.description ?? null,
              isPrivate: r.private,
              sizeKb: r.size,
              hostId,
            });
          }
        } catch (error) {
          patSourceFailed = true;
          if (!lastError) {
            lastError = error instanceof Error ? error : null;
          }
        }
      } else if (!patToken) {
        patSourceFailed = true;
      }
    }

    // 4. No hostId: use singleton token (preserve existing behavior)
    if (!hostId) {
      try {
        const repos = await GitHubService.getRepositories();
        for (const r of repos) {
          addRepo({
            provider: 'github',
            owner: r.owner.login,
            repo: r.name,
            fullName: r.full_name,
            name: r.name,
            description: r.description ?? null,
            isPrivate: r.private,
            sizeKb: r.size,
            hostId: undefined,
          });
        }
      } catch (error) {
        lastError = error instanceof Error ? error : null;
      }
    }

    // Return unavailable only when ALL sources failed
    const allSourcesFailed =
      appSourceFailed &&
      oauthSourceFailed &&
      patSourceFailed &&
      results.length === 0;

    if (allSourcesFailed) {
      const reason = lastError?.message ?? 'No credential available';
      return [{ kind: 'unavailable', provider: 'github', reason }];
    }

    return results;
  }

  // ── Write operations (GitHostWriteService) ──────────────────────

  async getFileSha(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHostShaResult> {
    const result: ShaResult = await GitHubService.getFileSha(
      owner,
      repo,
      path,
      ref,
    );
    return result;
  }

  async getFileShaOrNull(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    return GitHubService.getFileShaOrNull(owner, repo, path, ref);
  }

  async updateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    commitMessage: string,
    branch: string,
    knownSha?: string,
  ): Promise<string> {
    const result = await GitHubService.updateFile(
      owner,
      repo,
      path,
      content,
      commitMessage,
      branch,
      { expectExists: !!knownSha },
    );
    if (!result?.content?.sha) {
      throw new Error('GitHub updateFile returned no sha');
    }
    return result.content.sha;
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    commitMessage: string,
    sha: string,
    branch: string,
  ): Promise<void> {
    await GitHubService.deleteFile(
      owner,
      repo,
      path,
      commitMessage,
      sha,
      branch,
    );
  }

  async uploadBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    commitMessage: string,
    branch: string,
  ): Promise<string> {
    const result = await GitHubService.uploadBinaryFile(
      owner,
      repo,
      path,
      base64Content,
      commitMessage,
      branch,
    );
    if (!result) {
      throw new Error('GitHub uploadBinaryFile failed');
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  async getRepoPrivacy(
    owner: string,
    repo: string,
  ): Promise<boolean | null> {
    return GitHubService.getRepoPrivacy(owner, repo);
  }
}

export const gitHubHostService = new GitHubHostService();
