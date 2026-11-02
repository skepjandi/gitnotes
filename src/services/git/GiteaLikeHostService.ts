import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccountStorage } from '../AccountStorage';
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

export interface GiteaLikeUser {
  id: number;
  login: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
}

export interface GiteaLikeRepo {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch?: string;
  size?: number;
  owner?: { login?: string };
}

export interface ForgejoRepositoryTokenTarget {
  owner: string;
  repo: string;
  username: string;
}

export interface GiteaLikeBranch {
  name: string;
}

export interface GiteaLikeContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha?: string;
  download_url?: string | null;
  encoding?: string;
  content?: string;
}

export interface GiteaLikeTreeEntry {
  path: string;
  type: 'tree' | 'blob';
  sha: string;
}

export interface GiteaLikeLabel {
  id: number;
  name: string;
  color?: string;
}

export interface GiteaLikePR {
  number: number;
  title: string;
  state: 'open' | 'closed' | string;
  html_url: string;
  head?: { ref?: string };
  base?: { ref?: string };
  user?: { login?: string };
  draft?: boolean;
  created_at: string;
}

export interface GiteaLikeIssue {
  number: number;
  title: string;
  state: 'open' | 'closed' | string;
  html_url: string;
  labels?: GiteaLikeLabel[];
  user?: { login?: string };
  created_at: string;
  updated_at?: string;
  pull_request?: { url?: string } | null;
}

/**
 * Shared Gitea / Forgejo implementation. Their REST APIs are 1:1 — the
 * Forgejo project is a Gitea fork and keeps the same endpoints — so we
 * share one class and only differentiate by `provider` label and base
 * URL.
 */
export class GiteaLikeHostService implements GitHostService, GitHostWriteService {
  readonly provider: 'gitea' | 'forgejo';

  private token: string | null = null;
  private user: GiteaLikeUser | null = null;
  private baseUrl: string;
  private readonly hostTokenMap = new Map<string, string>();
  private readonly hostBaseUrlMap = new Map<string, string>();

  constructor(provider: 'gitea' | 'forgejo', baseUrl: string) {
    this.provider = provider;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = (url || this.baseUrl).replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  isAuthenticated(): boolean {
    return this.token !== null && this.token.length > 0;
  }

  getUser(): GiteaLikeUser | null {
    return this.user;
  }

  async storeHostCredentials(hostId: string, token: string, baseUrl: string): Promise<void> {
    this.hostTokenMap.set(hostId, token);
    this.hostBaseUrlMap.set(hostId, baseUrl);
    await AsyncStorage.setItem(this.hostTokenKey(hostId), token);
    await AsyncStorage.setItem(this.hostBaseUrlKey(hostId), baseUrl);
  }

  private userKey(): string {
    return `@gitnotes:${this.provider}_user`;
  }
  private tokenKey(): string {
    return `@gitnotes:${this.provider}_token`;
  }
  private baseKey(): string {
    return `@gitnotes:${this.provider}_base_url`;
  }
  private hostTokenKey(hostId: string): string {
    return `@gitnotes:${this.provider}:${hostId}_token`;
  }
  private hostBaseUrlKey(hostId: string): string {
    return `@gitnotes:${this.provider}:${hostId}_base_url`;
  }

  async initialize(): Promise<void> {
    try {
      this.token = await AsyncStorage.getItem(this.tokenKey());
      if (!this.token) return;
      const storedBase = await AsyncStorage.getItem(this.baseKey());
      if (storedBase) this.setBaseUrl(storedBase);
      const userJson = await AsyncStorage.getItem(this.userKey());
      if (userJson) {
        this.user = JSON.parse(userJson);
      } else {
        this.user = await this.fetchUser();
        if (this.user) {
          await AsyncStorage.setItem(this.userKey(), JSON.stringify(this.user));
        }
      }
    } catch (error) {
      console.warn(`[${this.provider}] initialize failed:`, error);
    }
  }

  async setToken(
    token: string,
    baseUrl?: string,
    repositoryToken?: ForgejoRepositoryTokenTarget,
  ): Promise<GiteaLikeUser | null> {
    const nextBaseUrl = (baseUrl?.trim() || this.baseUrl).replace(/\/+$/, '');
    let user: GiteaLikeUser | null;
    if (repositoryToken) {
      const { owner, repo, username } = repositoryToken;
      if (!owner.trim() || !repo.trim() || !username.trim()) return null;
      const accessibleRepo = await this.authedFetch<GiteaLikeRepo>(
        `${nextBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        token,
      );
      user = accessibleRepo ? { id: 0, login: username, full_name: username } : null;
    } else {
      user = await this.authedFetch<GiteaLikeUser>(`${nextBaseUrl}/user`, token);
    }
    if (!user) return null;

    this.token = token;
    this.setBaseUrl(nextBaseUrl);
    await AsyncStorage.setItem(this.tokenKey(), token);
    if (baseUrl) await AsyncStorage.setItem(this.baseKey(), this.baseUrl);
    this.user = user;
    await AsyncStorage.setItem(this.userKey(), JSON.stringify(user));
    return user;
  }

  async clearToken(): Promise<void> {
    this.token = null;
    this.user = null;
    await AsyncStorage.removeItem(this.userKey());
    await AsyncStorage.removeItem(this.tokenKey());
    await AsyncStorage.removeItem(this.baseKey());
  }

  private async authedFetch<T>(url: string, tokenOverride?: string | null): Promise<T | null> {
    const effectiveToken = tokenOverride !== undefined ? tokenOverride : this.token;
    if (!effectiveToken) return null;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `token ${effectiveToken}`,
        },
      });
      if (!res.ok) {
        if (res.status !== 404) {
          console.warn(`[${this.provider}] ${res.status} ${url}`);
        }
        return null;
      }
      return (await res.json()) as T;
    } catch (error) {
      console.warn(`[${this.provider}] fetch failed:`, error);
      return null;
    }
  }

  private async authedFetchRaw(
    url: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: unknown } | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `token ${this.token}`,
          ...((init.headers as Record<string, string> | undefined) ?? {}),
        },
      });
      if (res.status === 204) return { status: 204, body: null };
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    } catch (error) {
      console.warn(`[${this.provider}] authedFetchRaw failed:`, error);
      return null;
    }
  }

  async fetchUser(): Promise<GiteaLikeUser | null> {
    if (!this.token) return null;
    return this.authedFetch<GiteaLikeUser>(`${this.baseUrl}/user`);
  }

  async getAuthenticatedUser(): Promise<GitHostUser | null> {
    const user = this.user ?? (await this.fetchUser());
    if (!user) return null;
    return {
      id: user.id,
      login: user.login,
      name: user.full_name ?? user.login,
      email: user.email ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string | null> {
    const meta = await this.authedFetch<GiteaLikeRepo>(
      `${this.baseUrl}/repos/${owner}/${repo}`,
    );
    return meta?.default_branch ?? null;
  }

  async listBranches(owner: string, repo: string): Promise<GitHostBranch[]> {
    const data = await this.authedFetch<GiteaLikeBranch[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/branches?limit=50`,
    );
    if (!data) return [];
    return data.map((b) => ({ name: b.name }));
  }

  async getTreeRecursive(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<GitHostTreeEntry[]> {
    // The Gitea tree API isn't recursive in one call; walk folder-by-folder
    // and flatten. Cap at 5 levels to avoid pathological repos.
    const collected: GitHostTreeEntry[] = [];
    const visit = async (path: string, depth: number) => {
      if (depth > 5) return;
      const data = await this.authedFetch<GiteaLikeContent[]>(
        `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      if (!data) return;
      for (const item of data) {
        if (item.type === 'dir') {
          collected.push({ path: item.path, type: 'tree', sha: item.sha ?? '' });
          await visit(item.path, depth + 1);
        } else if (item.type === 'file') {
          collected.push({ path: item.path, type: 'blob', sha: item.sha ?? '' });
        }
      }
    };
    await visit('', 0);
    return collected;
  }

  async listContents(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHostContent[]> {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    const query = params.toString();
    const url =
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}` +
      (query ? `?${query}` : '');
    const data = await this.authedFetch<GiteaLikeContent[]>(url);
    if (!data) return [];
    return data.map((item) => ({
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
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    const query = params.toString();
    const url =
      `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}` +
      (query ? `?${query}` : '');
    const data = await this.authedFetch<GiteaLikeContent>(url);
    if (!data?.content) return null;
    try {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async listPullRequests(
    owner: string,
    repo: string,
    state: GitHostItemState = 'open',
  ): Promise<GitHostPullRequest[]> {
    const data = await this.authedFetch<GiteaLikePR[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/pulls?state=${state}&limit=50`,
    );
    if (!data) return [];
    return data.map((p) => ({
      id: p.number,
      number: p.number,
      title: p.title,
      state: p.state === 'open' ? 'open' : 'closed',
      webUrl: p.html_url,
      headBranch: p.head?.ref ?? '',
      baseBranch: p.base?.ref ?? '',
      author: p.user?.login,
      draft: p.draft ?? false,
      createdAt: p.created_at,
    }));
  }

  async listIssues(
    owner: string,
    repo: string,
    state: GitHostItemState = 'open',
  ): Promise<GitHostIssue[]> {
    const data = await this.authedFetch<GiteaLikeIssue[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues?state=${state}&type=issues&limit=50`,
    );
    if (!data) return [];
    // Gitea's /issues endpoint also returns PR items; drop anything with a pull_request payload.
    return data
      .filter((i) => i.pull_request == null)
      .map((i) => ({
        id: i.number,
        number: i.number,
        title: i.title,
        state: i.state === 'open' ? 'open' : 'closed',
        webUrl: i.html_url,
        labels: (i.labels ?? []).map((l) => l.name),
        author: i.user?.login,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      }));
  }

  async listRepositories(hostId?: string): Promise<GitHostRepositoryResult[]> {
    let token = this.token;
    let baseUrl = this.baseUrl;
    if (hostId) {
      // Use AccountStorage as the source of truth for per-host credentials.
      // This matches how the token is stored by upsertHostConnection and
      // avoids depending on storeHostCredentials (which is never called in
      // the production flow) or mismatched AsyncStorage key patterns.
      const [hostToken, hostConnection] = await Promise.all([
        AccountStorage.getHostToken(hostId),
        AccountStorage.getHostConnection(hostId),
      ]);
      if (hostToken) token = hostToken;
      if (hostConnection?.instanceBaseUrl) baseUrl = hostConnection.instanceBaseUrl;
    }
    try {
      const repos = await this.authedFetch<GiteaLikeRepo[]>(`${baseUrl}/user/repos`, token);
      if (!repos) {
        return [
          {
            kind: 'unavailable',
            provider: this.provider,
            reason: 'Network error',
          },
        ];
      }
      return repos.map(
        (r): GitHostRepository => ({
          provider: this.provider,
          owner: r.owner?.login ?? '',
          repo: r.name,
          fullName: r.full_name,
          name: r.name,
          description: r.description ?? null,
          isPrivate: r.private,
          sizeKb: r.size ? Math.round(r.size / 1024) : undefined,
          defaultBranch: r.default_branch,
        }),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return [{ kind: 'unavailable', provider: this.provider, reason }];
    }
  }

  // ── Write operations (GitHostWriteService) ──────────────────────

  async getFileSha(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHostShaResult> {
    const branch = ref || (await this.getDefaultBranch(owner, repo)) || 'main';
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const result = await this.authedFetchRaw(url);
    if (!result) return { kind: 'error', message: 'Network error' };
    if (result.status === 404) return { kind: 'not-found' };
    if (result.status >= 200 && result.status < 300 && (result.body as { sha?: string })?.sha) {
      return { kind: 'found', sha: (result.body as { sha: string }).sha };
    }
    return { kind: 'error', message: `Unexpected status: ${result.status}` };
  }

  async getFileShaOrNull(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    const result = await this.getFileSha(owner, repo, path, ref);
    return result.kind === 'found' ? (result.sha ?? null) : null;
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
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    let currentSha: string | null = knownSha ?? null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const body: Record<string, string> = {
        content: base64Content,
        message: commitMessage,
        branch,
      };
      if (currentSha) body.sha = currentSha;

      const result = await this.authedFetchRaw(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (result && result.status >= 200 && result.status < 300) {
        if ((result.body as { content?: { sha?: string } })?.content?.sha) {
          return (result.body as { content: { sha: string } }).content.sha;
        }
        throw new Error(`${this.provider} updateFile succeeded but no sha in response`);
      }

      if (result?.status === 409 && attempt < 2) {
        const shaResult = await this.getFileSha(owner, repo, path, branch);
        currentSha = shaResult.kind === 'found' ? (shaResult.sha ?? null) : null;
        continue;
      }

      throw new Error(`${this.provider} updateFile failed: ${result?.status ?? 'unknown'}`);
    }

    throw new Error(`${this.provider} updateFile exhausted retries`);
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    commitMessage: string,
    sha: string,
    branch: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const result = await this.authedFetchRaw(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, sha, branch }),
    });
    if (!result || result.status >= 400) {
      throw new Error(`${this.provider} deleteFile failed: ${result?.status ?? 'unknown'}`);
    }
  }

  async uploadBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    commitMessage: string,
    branch: string,
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const body: Record<string, string> = {
      content: base64Content,
      message: commitMessage,
      branch,
    };
    const shaResult = await this.getFileSha(owner, repo, path, branch);
    if (shaResult.kind === 'found' && shaResult.sha) body.sha = shaResult.sha;

    const result = await this.authedFetchRaw(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!result || result.status >= 400) {
      throw new Error(`${this.provider} uploadBinaryFile failed: ${result?.status ?? 'unknown'}`);
    }
    const base = this.baseUrl.replace(/\/api\/v1$/, '');
    return `${base}/${owner}/${repo}/raw/branch/${branch}/${path}`;
  }

  async getRepoPrivacy(
    owner: string,
    repo: string,
  ): Promise<boolean | null> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    const result = await this.authedFetch<{ private: boolean }>(url);
    if (!result) return null;
    return result.private;
  }
}
