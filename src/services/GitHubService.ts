import AsyncStorage from '@react-native-async-storage/async-storage';
import http, { setAuthToken, clearAuthToken } from './http';
import AuthService from './AuthService';
import { extractHttpErrorDetails } from './git/syncFailure';
import { AccountStorage } from './AccountStorage';
import type { GitHubOAuthCredentialRecord } from './git/contracts';
import type { GitHubAppCredentialRecord } from './git/contracts';

const USER_KEY = '@gitnotes:github_user';

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  // Each 4 base64 chars → 3 bytes; padding "=" trims the tail.
  let outLen = (cleaned.length / 4) * 3;
  if (cleaned.endsWith('==')) outLen -= 2;
  else if (cleaned.endsWith('=')) outLen -= 1;
  const bytes = new Uint8Array(Math.max(0, outLen));
  let bi = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const c1 = chars.indexOf(cleaned[i]);
    const c2 = chars.indexOf(cleaned[i + 1]);
    const c3 = cleaned[i + 2] === '=' ? 64 : chars.indexOf(cleaned[i + 2]);
    const c4 = cleaned[i + 3] === '=' ? 64 : chars.indexOf(cleaned[i + 3]);
    if (c1 < 0 || c2 < 0) break;
    bytes[bi++] = (c1 << 2) | (c2 >> 4);
    if (c3 !== 64 && c3 >= 0) bytes[bi++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (c4 !== 64 && c4 >= 0) bytes[bi++] = ((c3 & 3) << 6) | c4;
  }
  return bytes.subarray(0, bi);
}

async function bytesToBase64Async(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  const CHUNK = 65535;
  if (bytes.length <= CHUNK) {
    return Buffer.from(bytes).toString('base64');
  }
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, Math.min(i + CHUNK, bytes.length));
    result += Buffer.from(chunk).toString('base64');
    if (i + CHUNK < bytes.length) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return result;
}

function decodeBase64(base64: string): string {
  const bytes = base64ToBytes(base64);
  // Prefer TextDecoder when available (Hermes / modern JSC). Falls back to
  // a manual UTF-8 decoder so 4-byte sequences (emoji, supplementary plane)
  // round-trip correctly. The previous implementation went through
  // String.fromCharCode + escape/decodeURIComponent, which is deprecated
  // and corrupts code points outside the BMP.
  const TD: typeof TextDecoder | undefined = (globalThis as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder;
  if (TD) {
    try {
      return new TD('utf-8').decode(bytes);
    } catch (error) {
      console.warn('[GitHubService] TextDecoder.decode failed:', error);
      // fall through to manual decoder
    }
  }
  return utf8DecodeBytes(bytes);
}

function utf8DecodeBytes(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 0x80) {
      out += String.fromCharCode(b1);
      continue;
    }
    if ((b1 & 0xe0) === 0xc0 && i < bytes.length) {
      const b2 = bytes[i++];
      out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      continue;
    }
    if ((b1 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
      continue;
    }
    if ((b1 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      const cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      // Encode astral code points as a surrogate pair.
      const cpAdj = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (cpAdj >> 10), 0xdc00 + (cpAdj & 0x3ff));
      continue;
    }
    // Invalid sequence — emit replacement character and advance one byte.
    out += '�';
  }
  return out;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name: string;
  email: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  description: string;
  private: boolean;
  /** GitHub repo size in KB (0 if unknown). Drives the large-repo warning. */
  size?: number;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  milestone: GitHubMilestone | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatar_url: string }>;
  created_at: string;
  updated_at: string;
}

export interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  description: string;
  state: 'open' | 'closed';
  html_url: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string };
  draft: boolean;
  created_at: string;
}

export interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
  download_url: string | null;
  content?: string;
  encoding?: string;
  sha?: string;
}

export interface GitHubCreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface GitHubCreateRepositoryInput {
  name: string;
}

export interface GitHubCreatedRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: { login: string; id: number };
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string;
}

export interface GitHubPullRequestDiff {
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export interface GitHubReviewInput {
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
}

export interface GitHubReview {
  id: number;
  user: { login: string };
  body: string;
  state: string;
  submitted_at: string;
  html_url?: string;
}

export interface GitHubFileCommit {
  content: { sha: string } | null;
  commit: { sha: string };
}

/** Entry of a Git tree listing / explicit `POST /git/trees` payload. */
export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export interface GitHubPathCommitDates {
  updatedAt?: number;
  createdAt?: number;
}

export type GitHubItemState = 'open' | 'closed' | 'all';

export const GITHUB_ITEM_STATES: GitHubItemState[] = ['open', 'closed', 'all'];

/**
 * Tristate result of a sha lookup so callers can distinguish
 * "definitely gone" from "couldn't tell". Critical for delete paths —
 * see `deleteNoteFromGitHub`: when the lookup itself errors we must
 * propagate so the local row stays put, otherwise the next pull
 * resurrects the file we thought we'd cleaned up.
 */
export type ShaResult =
  | { kind: 'found'; sha: string }
  | { kind: 'not-found' }
  | { kind: 'error'; status?: number; message: string };

class GitHubServiceClass {
  private token: string | null = null;
  private user: GitHubUser | null = null;

  /**
   * Per-process cache of `(owner/repo/path@ref) → sha`. Populated on every
   * successful read/write that surfaces a sha and invalidated on 409. Lets
   * the upsert / delete paths skip the GET-for-sha that #565 phase C calls
   * out as a fixed cost on every write. Cold on app launch (1
   * legacy GET on first touch); after that, in-session repeat saves cost
   * only the PUT/DELETE round-trip.
   */
  private shaCache = new Map<string, string>();

  /**
   * Per-process cache of `(owner/repo) → private`. Avoids a /repos/{owner}/{repo}
   * round-trip on every save when deciding whether to write a public raw URL or
   * the auth-required `gitnotes://repo-image/...` scheme for uploaded images
   * (#733). Lifetime is the JS bundle — not durable, but a flipped visibility
   * is rare enough that we accept the staleness window vs. plumbing storage.
   */
  private repoPrivacyCache = new Map<string, boolean>();

  private shaCacheKey(owner: string, repo: string, path: string, ref?: string): string {
    return `${owner}/${repo}/${path}@${ref ?? ''}`;
  }

  /**
   * Returns the `private` flag for `owner/repo`. Cached per process.
   * Falls back to `null` on lookup failure so callers can choose a safe
   * default (#733 picks "treat as private" — the worst case is a new
   * upload uses the auth-resolved scheme on a public repo, which still
   * renders correctly).
   */
  async getRepoPrivacy(
    owner: string,
    repo: string,
    opts?: TokenOpts,
  ): Promise<boolean | null> {
    const key = `${owner}/${repo}`;
    const cached = this.repoPrivacyCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const data = await this.request<{ private?: boolean }>(
        `https://api.github.com/repos/${owner}/${repo}`,
        'GET',
        undefined,
        opts,
      );
      if (typeof data?.private === 'boolean') {
        this.repoPrivacyCache.set(key, data.private);
        return data.private;
      }
      return null;
    } catch (error) {
      console.warn('[GitHubService] Failed to get repo privacy:', error);
      return null;
    }
  }

  invalidateShaCache(owner: string, repo: string, path: string, ref?: string): void {
    this.shaCache.delete(this.shaCacheKey(owner, repo, path, ref));
  }

  /**
   * Cache-first sha lookup. Hits the GET only when the entry is missing
   * (or has been invalidated by a prior 409). Same return shape as
   * `getFileSha`, so callers branch on `kind` exactly the same way.
   */
  async getFileShaCached(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<ShaResult> {
    const cached = this.shaCache.get(this.shaCacheKey(owner, repo, path, ref));
    if (cached) return { kind: 'found', sha: cached };
    const result = await this.getFileSha(owner, repo, path, ref, opts);
    if (result.kind === 'found') {
      this.shaCache.set(this.shaCacheKey(owner, repo, path, ref), result.sha);
    }
    return result;
  }

  async initialize(): Promise<void> {
    try {
      this.token = await AuthService.getToken();
      if (!this.token) return;
      setAuthToken(this.token);
      const userJson = await AsyncStorage.getItem(USER_KEY);
      if (userJson) {
        this.user = JSON.parse(userJson);
      } else {
        this.user = await this.hydrateUserFromAppCredential() ?? await this.fetchUser();
        if (this.user) {
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(this.user));
        }
      }
    } catch (error) {
      console.warn('[GitHubService] Failed to initialize:', error);
    }
  }

  /**
   * Hydrates the in-memory GitHubUser from the stored GitHub App credential
   * + active HostConnection profile, bypassing the `/user` API call that would
   * fail with 403 "Resource not accessible by integration" for installation
   * tokens.
   *
   * Returns null when no App credential is available, leaving the caller to
   * fall back to `fetchUser()` (PAT/OAuth path).
   */
  private async hydrateUserFromAppCredential(): Promise<GitHubUser | null> {
    const hostConn = await AccountStorage.getActiveHostConnection();
    if (!hostConn) return null;
    const appCred = await AccountStorage.getGitHubAppCredential(hostConn.id);
    if (!appCred) return null;
    // App installation tokens cannot call GET /user — hydrate from stored metadata.
    const avatar_url =
      appCred.accountAvatarUrl ?? hostConn.avatarUrl ?? '';
    return {
      login: appCred.accountLogin,
      id: appCred.accountId,
      avatar_url,
      html_url: `https://github.com/apps/${appCred.appSlug}`,
      name: hostConn.name,
      email: hostConn.email ?? '',
    };
  }

  async setToken(token: string, user?: GitHubUser | null): Promise<GitHubUser | null> {
    this.token = token;
    setAuthToken(token);
    const resolvedUser = user === undefined ? await this.fetchUser() : user;
    if (!resolvedUser) {
      this.token = null;
      clearAuthToken();
      return null;
    }
    this.user = resolvedUser;
    const connResult = await AuthService.connectHost({ provider: 'github', token });
    if (!connResult.ok) {
      // Token was valid for /user but rejected by connectHost — clear it
      this.token = null;
      setAuthToken('');
      await AsyncStorage.removeItem(USER_KEY);
      return null;
    }
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(resolvedUser));
    return resolvedUser;
  }

  async clearToken(): Promise<void> {
    this.token = null;
    this.user = null;
    clearAuthToken();
    await AuthService.clearToken();
    await AsyncStorage.removeItem(USER_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  async isAuthenticatedAsync(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    const summaries = await AuthService.listAccountSummaries();
    const githubHosts = summaries.flatMap((summary) => summary.hosts.filter((host) => host.provider === 'github'));
    for (const host of githubHosts) {
      const availability = await AuthService.getProviderAuthAvailability(host.id, 'github');
      if (availability.isAvailable) return true;
    }
    return false;
  }

  /**
   * Resolves the OAuth access token for the active host when no singleton token
   * is available (OAuth-only users). Returns null when no OAuth credential exists.
   */
  private async resolveOAuthTokenForActiveHost(): Promise<string | null> {
    const summaries = await AuthService.listAccountSummaries();
    const githubHosts = summaries.flatMap((summary) => summary.hosts.filter((host) => host.provider === 'github'));
    for (const host of githubHosts) {
      const oauthCred = await AccountStorage.getOAuthCredential(host.id);
      if (oauthCred?.accessToken) return oauthCred.accessToken;
    }
    return null;
  }

  getUser(): GitHubUser | null {
    return this.user;
  }

  private async fetchUser(): Promise<GitHubUser | null> {
    try {
      return await this.request<GitHubUser>('https://api.github.com/user');
    } catch (error) {
      console.warn('[GitHubService] fetchUser failed:', error);
      return null;
    }
  }

  async getRepositories(opts?: TokenOpts): Promise<GitHubRepository[]> {
    const all: GitHubRepository[] = [];
    const params = new URLSearchParams({
      sort: 'updated',
      per_page: '100',
      visibility: 'all',
      affiliation: 'owner,collaborator,organization_member',
    });
    let url: string | null = `https://api.github.com/user/repos?${params.toString()}`;
    try {
      while (url) {
        const { data, nextUrl } = await this.requestPaginated(url, opts);
        if (Array.isArray(data)) all.push(...data);
        url = nextUrl;
      }
      return all;
    } catch (error) {
      console.warn('[GitHubService] Failed to get repositories:', error);
      return all;
    }
  }

  /**
   * Fetch a single repository's GitHub-reported size (KB, 0 if unknown).
   * `GET /user/repos` omits `size` when it's null; the per-repo endpoint
   * returns it consistently. Used by the clone-mode guard to refuse clone
   * for repos over LARGE_REPO_THRESHOLD_KB (native Hermes OOM on big
   * packfiles — #1037).
   */
  async getRepositorySize(owner: string, repo: string): Promise<number | null> {
    try {
      const data = await this.request<{ size?: number }>(`https://api.github.com/repos/${owner}/${repo}`);
      return typeof data?.size === 'number' ? data.size : null;
    } catch (error) {
      console.warn('[GitHubService] Failed to get repository size:', error);
      return null;
    }
  }

  async getIssues(
    owner: string,
    repo: string,
    state: GitHubItemState = 'open',
  ): Promise<GitHubIssue[]> {
    const data = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=50`
    );
    return Array.isArray(data) ? data : [];
  }

  async getPullRequests(
    owner: string,
    repo: string,
    state: GitHubItemState = 'open',
  ): Promise<GitHubPullRequest[]> {
    const data = await this.request(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=50`
    );
    return Array.isArray(data) ? data : [];
  }

  async createPullRequest(opts: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GitHubPullRequest | null> {
    try {
      const data = await this.request(
        `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`,
        'POST',
        {
          title: opts.title,
          body: opts.body,
          head: opts.head,
          base: opts.base,
        }
      );
      return data as GitHubPullRequest;
    } catch (error) {
      console.warn('[GitHubService] Failed to create pull request:', error);
      return null;
    }
  }

  async createIssue(input: GitHubCreateIssueInput): Promise<GitHubIssue | null> {
    try {
      const data = await this.request(
        `https://api.github.com/repos/${input.owner}/${input.repo}/issues`,
        'POST',
        {
          title: input.title,
          body: input.body,
          labels: input.labels,
          assignees: input.assignees,
        }
      );
      return data as GitHubIssue;
    } catch (error) {
      console.warn('[GitHubService] Failed to create issue:', error);
      return null;
    }
  }

  /**
   * Creates a private, auto-initialized repository for the authenticated user.
   * Token resolution delegates to `request()`: singleton token first, then OAuth fallback.
   * HTTP errors (401/403/422) and transport failures are re-thrown so callers can
   * present appropriate UX.
   */
  async createRepository(input: GitHubCreateRepositoryInput): Promise<GitHubCreatedRepository> {
    try {
      return await this.request<GitHubCreatedRepository>(
        'https://api.github.com/user/repos',
        'POST',
        { name: input.name, private: true, auto_init: true },
      );
    } catch (error) {
      const details = extractHttpErrorDetails(error);
      if (details.status !== undefined) {
        throw Object.assign(new Error(details.message ?? 'Repository creation failed'), {
          status: details.status,
        });
      }
      throw error;
    }
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    pull_number: number,
  ): Promise<GitHubPullRequestDiff | null> {
    try {
      const data = await this.request<
        Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
      >(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/files`);
      if (!Array.isArray(data)) return null;
      return {
        files: data.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
      };
    } catch (error) {
      console.warn('[GitHubService] Failed to get pull request diff:', error);
      return null;
    }
  }

  async reviewPullRequest(input: GitHubReviewInput): Promise<GitHubReview | null> {
    try {
      const data = await this.request(
        `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.pull_number}/reviews`,
        'POST',
        {
          body: input.body,
          event: input.event,
        }
      );
      return data as GitHubReview;
    } catch (error) {
      console.warn('[GitHubService] Failed to review pull request:', error);
      return null;
    }
  }

  async getMilestones(owner: string, repo: string): Promise<GitHubMilestone[]> {
    try {
      const data = await this.request(
        `https://api.github.com/repos/${owner}/${repo}/milestones?state=open&per_page=50`
      );
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn('[GitHubService] Failed to get milestones:', error);
      return [];
    }
  }

  async getRepoContents(owner: string, repo: string, path: string = '', ref?: string): Promise<GitHubContent[]> {
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
      if (ref) url += `?ref=${encodeURIComponent(ref)}`;
      const data = await this.request(url);
      if (Array.isArray(data)) {
        return data;
      }
      return [data];
    } catch (error) {
      if (!isNotFound(error)) {
        console.warn('[GitHubService] Failed to get repo contents:', error);
      }
      return [];
    }
  }

  async getTreeRecursive(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ path: string; type: 'blob' | 'tree'; sha: string; size?: number }[]> {
    try {
      return await this.getTreeRecursiveOrThrow(owner, repo, ref);
    } catch (error) {
      if (!isNotFound(error)) {
        console.warn('[GitHubService] Failed to get tree:', error);
      }
      return [];
    }
  }

  // Strict variant that lets the caller distinguish "tree fetched, repo has 0
  // entries" (resolves to []) from "tree fetch failed" (throws). The swallowing
  // `getTreeRecursive` returns [] for both cases, which is fine for display
  // contexts but unsafe for reconciliation logic that uses the absence of a
  // path as evidence the file was deleted on the remote.
  async getTreeRecursiveOrThrow(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ path: string; type: 'blob' | 'tree'; sha: string; size?: number }[]> {
    const entries = await this._getTreeRecursiveImpl(owner, repo, ref);
    if (!entries) {
      throw new Error('GitHub tree response missing tree array');
    }
    return entries;
  }

  /**
   * Paginated tree fetch that handles truncation for large repos (#972).
   * When GitHub returns `truncated: true`, we recursively fetch individual
   * subtree SHAs to avoid loading the entire tree into memory at once.
   */
  private async _getTreeRecursiveImpl(
    owner: string,
    repo: string,
    ref: string,
    _parentPath = '',
  ): Promise<{ path: string; type: 'blob' | 'tree'; sha: string; size?: number }[] | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const data = await this.request(url);

    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.tree)) return null;

    if (!data.truncated) {
      return data.tree.map((item: any) => ({
        path: item.path,
        type: item.type,
        sha: item.sha,
        size: typeof item.size === 'number' ? item.size : undefined,
      }));
    }

    const treeItems = data.tree as any[];
    const dirItems = treeItems.filter((i) => i.type === 'tree');

    if (dirItems.length === 0) {
      return treeItems.map((item: any) => ({
        path: item.path,
        type: item.type,
        sha: item.sha,
        size: typeof item.size === 'number' ? item.size : undefined,
      }));
    }

    const blobItems = treeItems
      .filter((i) => i.type === 'blob')
      .map((item: any) => ({
        path: item.path,
        type: item.type as 'blob' | 'tree',
        sha: item.sha,
        size: typeof item.size === 'number' ? item.size : undefined,
      }));

    const subTreeResults = await Promise.all(
      dirItems.map((d) => this._getTreeRecursiveImpl(owner, repo, d.sha, d.path)),
    );

    const subEntries = subTreeResults.flatMap((r) => r ?? []);

    // Include dirItems as 'tree' type entries so getRepositoryFolders can
    // discover folders. Without this, truncated repos have no folder entries.
    const dirEntries = dirItems.map((item) => ({
      path: item.path,
      type: 'tree' as const,
      sha: item.sha,
    }));

    return [...blobItems, ...dirEntries, ...subEntries];
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<string | null> {
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
      if (ref) url += `?ref=${encodeURIComponent(ref)}`;
      const data = await this.request(url, 'GET', undefined, opts);
      // Gate on the type + content *field presence*, not truthiness: an empty
      // file legitimately has `content === ''` and must not read as "missing"
      // (#883 — `.gitkeep` and other empty files were false-negatived by the
      // old `data.content` truthiness check).
      if (data.type === 'file' && typeof data.content === 'string') {
        const base64 = data.content.replace(/\n/g, '');
        return decodeBase64(base64);
      }
      return null;
    } catch (error) {
      console.warn('[GitHubService] Failed to get file content:', error);
      return null;
    }
  }

  async getPathCommitDates(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<GitHubPathCommitDates> {
    try {
      const params = new URLSearchParams({ path, per_page: '100' });
      if (ref) params.set('sha', ref);
      const data = await this.request<any[]>(
        `https://api.github.com/repos/${owner}/${repo}/commits?${params.toString()}`,
        'GET',
        undefined,
        opts,
      );
      if (!Array.isArray(data) || data.length === 0) return {};
      const parseDate = (value: unknown): number | undefined => {
        if (typeof value !== 'string') return undefined;
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : undefined;
      };
      const newest = parseDate(data[0]?.commit?.author?.date ?? data[0]?.commit?.committer?.date);
      const oldest = parseDate(data[data.length - 1]?.commit?.author?.date ?? data[data.length - 1]?.commit?.committer?.date);
      return {
        updatedAt: newest,
        createdAt: oldest ?? newest,
      };
    } catch (error) {
      console.warn('[GitHubService] Failed to get path commit dates:', error);
      return {};
    }
  }

  /**
   * Fetches a file via the Contents API and returns the raw base64 (no UTF-8
   * decode). Used by the renderer to inline private-repo image bytes as
   * `data:` URIs for #733. Files larger than ~1 MB return empty `content`
   * from this endpoint — for those callers should fall back to the blobs
   * API; image attachments are well under that bound in practice.
   */
  async getFileBase64(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<string | null> {
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
      if (ref) url += `?ref=${encodeURIComponent(ref)}`;
      const data = await this.request(url, 'GET', undefined, opts);
      if (data?.type === 'file' && typeof data.content === 'string' && data.content.length > 0) {
        return data.content.replace(/\n/g, '');
      }
      return null;
    } catch (error) {
      console.warn('[GitHubService] Failed to get file base64:', error);
      return null;
    }
  }

  /**
   * Typed sha lookup so callers can distinguish "remote file is gone"
   * (delete should soft-succeed) from "we couldn't reach GitHub" (delete
   * must NOT short-circuit, otherwise the local row vanishes while the
   * upstream copy lingers and gets re-synced on the next pull).
   *
   * `getFileShaOrNull` keeps the legacy `string | null` shape for the
   * upsert paths that just need a sha-or-create decision.
   */
  async getFileSha(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<ShaResult> {
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
      if (ref) url += `?ref=${encodeURIComponent(ref)}`;
      const data = await this.request(url, 'GET', undefined, opts);
      if (data?.sha) return { kind: 'found', sha: data.sha };
      return { kind: 'not-found' };
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 404) return { kind: 'not-found' };
      return { kind: 'error', status, message };
    }
  }

  /**
   * Convenience wrapper that preserves the prior `string | null` shape
   * for upsert call sites (they only care about "exists, give me the
   * sha" vs "create new"). Errors collapse to null here just like the
   * old behavior — deletes go through `getFileSha` and handle the typed
   * result themselves.
   */
  async getFileShaOrNull(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    opts?: TokenOpts,
  ): Promise<string | null> {
    const result = await this.getFileSha(owner, repo, path, ref, opts);
    return result.kind === 'found' ? result.sha : null;
  }

  /**
   * Create a remote file. HTTP errors are rethrown (rather than collapsed to
   * null) so a 401/403/409 propagates to the queue classifier with its status
   * intact — swallowing it here made bad-credential failures surface as an
   * unknown retryable and loop forever (#884).
   */
  async createFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string = 'main',
    opts?: TokenOpts,
  ): Promise<GitHubFileCommit | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const base64Content = await bytesToBase64Async(content);
    return await this.request(url, 'PUT', {
      message,
      content: base64Content,
      branch,
    }, opts);
  }

  async uploadBinaryFile(
    owner: string,
    repo: string,
    path: string,
    base64Content: string,
    message: string,
    branch: string = 'main',
  ): Promise<GitHubFileCommit | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const existingSha = await this.getFileShaOrNull(owner, repo, path, branch);
      try {
        const body: Record<string, string> = {
          message,
          content: base64Content,
          branch,
        };
        if (existingSha) body.sha = existingSha;

        return await this.request(url, 'PUT', body);
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 409 && attempt < 2) {
          continue;
        }
        if (status === 422 && existingSha) {
          return { content: { sha: existingSha }, commit: { sha: '' } } as GitHubFileCommit;
        }
        if (attempt === 2) {
          console.warn('[GitHubService] Failed to upload binary file:', error);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Delete a remote file with bounded retries. The 409 path mirrors the
   * `updateFile` recovery loop — when the upstream sha drifts mid-flight
   * we re-fetch it and re-DELETE up to 3 attempts. Transient network
   * failures get one extra retry with backoff so flaky cellular doesn't
   * leave a half-deleted note (#567 fix B).
   *
   * Throws on terminal failure so callers can distinguish "could not
   * delete" from "deleted nothing because already gone" — matters for
   * the typed sha gating in `deleteNoteFromGitHub`. Pre-existing callers
   * that want the legacy null-on-failure shape should wrap in try/catch.
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    sha: string,
    branch: string = 'main',
    opts?: TokenOpts,
  ): Promise<GitHubFileCommit | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

    const cacheKey = this.shaCacheKey(owner, repo, path, branch);
    let currentSha = sha;
    let networkRetried = false;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = (await this.request(
          url,
          'DELETE',
          { message, sha: currentSha, branch },
          opts,
        )) as GitHubFileCommit | null;
        // File is gone — drop the cache so a future create gets a fresh
        // sha instead of one pointing at a deleted blob.
        this.shaCache.delete(cacheKey);
        return result;
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number })?.status;

        if (status === 404) {
          // Already gone upstream — synthetic success so callers can
          // treat the deletion as complete.
          this.shaCache.delete(cacheKey);
          return { content: null, commit: { sha: '' } };
        }

        if (status === 409 && attempt < 2) {
          this.shaCache.delete(cacheKey);
          const refreshed = await this.getFileSha(owner, repo, path, branch, opts);
          if (refreshed.kind === 'not-found') {
            return { content: null, commit: { sha: '' } };
          }
          if (refreshed.kind === 'found') {
            currentSha = refreshed.sha;
            this.shaCache.set(cacheKey, refreshed.sha);
            continue;
          }
          // refresh itself errored — bubble up so caller doesn't soft-succeed.
          throw new Error(refreshed.message);
        }

        if (!status && !networkRetried && attempt < 2) {
          networkRetried = true;
          await new Promise<void>((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 1000));
          continue;
        }

        // No retry path applies (or we exhausted attempts). Bubble out so
        // the delete sync helper can hold the local row.
        console.warn('[GitHubService] Failed to delete file:', error);
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    return null;
  }

  async createFolder(
    owner: string,
    repo: string,
    folderPath: string,
    branch: string = 'main',
    opts?: TokenOpts,
  ): Promise<GitHubFileCommit | null> {
    const keepPath = folderPath ? `${folderPath}/.gitkeep` : '.gitkeep';
    try {
      return await this.createFile(owner, repo, keepPath, '', `Create folder ${folderPath || '/'}`, branch, opts);
    } catch (error) {
      console.warn('[GitHubService] Failed to create folder:', error);
      return null;
    }
  }

  async updateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string = 'main',
    opts?: TokenOpts & { expectExists?: boolean },
  ): Promise<GitHubFileCommit | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const base64Content = await bytesToBase64Async(content);

    const cacheKey = this.shaCacheKey(owner, repo, path, branch);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let sha: string | null = this.shaCache.get(cacheKey) ?? null;
        if (!sha) {
          sha = await this.getFileShaOrNull(owner, repo, path, branch, opts);
          if (sha) this.shaCache.set(cacheKey, sha);
        }
        if (!sha) {
          if (opts?.expectExists) {
            console.warn(`[GitHubService] Remote file deleted, aborting update to prevent resurrection: ${path}`);
            return null;
          }
          const created = await this.createFile(owner, repo, path, content, message, branch, opts);
          const createdSha = created?.content?.sha;
          if (createdSha) this.shaCache.set(cacheKey, createdSha);
          return created;
        }

        const response = (await this.request(
          url,
          'PUT',
          { message, content: base64Content, sha, branch },
          opts,
        )) as GitHubFileCommit | null;
        const newSha = response?.content?.sha;
        if (newSha) this.shaCache.set(cacheKey, newSha);
        return response;
      } catch (error) {
        const details = extractHttpErrorDetails(error);
        const status = details.status;
        if (status === 409 && attempt < 2) {
          this.shaCache.delete(cacheKey);
          let upstreamContent: string | null = null;
          try {
            upstreamContent = await this.getFileContent(owner, repo, path, branch);
          } catch {
            // getFileContent swallows its own failures; treat as unresolved.
          }
          if (upstreamContent !== null && upstreamContent !== content) {
            throw Object.assign(new Error('upstream-content-changed, pull to resolve'), { status: 409 });
          }
          continue;
        }
        if (status === 422) {
          this.shaCache.delete(cacheKey);
          return { content: { sha: '' }, commit: { sha: '' } } as GitHubFileCommit;
        }
        if (attempt === 2 && status !== undefined && status >= 400) {
          console.warn('[GitHubService] Failed to update file:', error);
          const message = details.message ?? (error instanceof Error ? error.message : 'GitHub update failed');
          throw Object.assign(new Error(message), {
            status,
            ...(details.headers ? { headers: details.headers } : {}),
          });
        }
      }
    }
    return null;
  }

  async moveFile(
    owner: string,
    repo: string,
    oldPath: string,
    newPath: string,
    content: string,
    message: string,
    oldSha: string,
    branch: string = 'main',
    opts?: TokenOpts,
  ): Promise<boolean> {
    try {
      await this.deleteFile(owner, repo, oldPath, message, oldSha, branch, opts);
    } catch (error) {
      console.warn('[GitHubService] moveFile delete failed for', oldPath, error);
      return false;
    }
    try {
      await this.createFile(owner, repo, newPath, content, message, branch, opts);
    } catch (error) {
      console.warn('[GitHubService] moveFile create failed for', newPath, error);
      return false;
    }
    return true;
  }

  /**
   * Git Data API primitives backing `src/services/git/BatchGitOperations`
   * (single-commit bulk deletes). Strict contract: HTTP errors are rethrown
   * so the batch driver can apply its own retry/fallback policy — unlike
   * the Contents-API helpers above, which swallow failures into null/[] .
   */
  async getBranchHead(
    owner: string,
    repo: string,
    branch: string,
    opts?: TokenOpts,
  ): Promise<{ sha: string }> {
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    const data = await this.request<{ object?: { sha?: string } }>(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodedBranch}`,
      'GET',
      undefined,
      opts,
    );
    if (!data?.object?.sha) {
      throw new Error(`Branch head not found for ${branch}`);
    }
    return { sha: data.object.sha };
  }

  async getCommit(
    owner: string,
    repo: string,
    sha: string,
    opts?: TokenOpts,
  ): Promise<{ treeSha: string }> {
    const data = await this.request<{ tree?: { sha?: string } }>(
      `https://api.github.com/repos/${owner}/${repo}/git/commits/${encodeURIComponent(sha)}`,
      'GET',
      undefined,
      opts,
    );
    if (!data?.tree?.sha) {
      throw new Error(`Commit tree not found for ${sha}`);
    }
    return { treeSha: data.tree.sha };
  }

  async getTreeRaw(
    owner: string,
    repo: string,
    treeSha: string,
    recursive: boolean = true,
    opts?: TokenOpts,
  ): Promise<GitHubTreeEntry[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}` +
      (recursive ? '?recursive=1' : '');
    const data = await this.request(url, 'GET', undefined, opts);
    // Same strictness as `getTreeRecursiveOrThrow`: a 200 with a malformed
    // body is not evidence of an empty tree.
    if (!Array.isArray(data?.tree)) {
      throw new Error('GitHub tree response missing tree array');
    }
    return data.tree.map((item: any) => ({
      path: item.path,
      mode: item.mode,
      type: item.type,
      sha: item.sha,
    }));
  }

  async createBlob(
    owner: string,
    repo: string,
    content: string,
    opts?: TokenOpts,
  ): Promise<{ sha: string }> {
    const data = await this.request<{ sha?: string }>(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
      'POST',
      { content: await bytesToBase64Async(content), encoding: 'base64' },
      opts,
    );
    if (!data?.sha) {
      throw new Error('GitHub create blob returned no sha');
    }
    return { sha: data.sha };
  }

  async createTree(
    owner: string,
    repo: string,
    tree: GitHubTreeEntry[],
    opts?: TokenOpts & { baseTree?: string },
  ): Promise<{ sha: string }> {
    // Explicit tree (no base_tree): omitting a path from base_tree does NOT
    // delete it, so batch deletes always send the FULL tree minus deletions.
    const baseTree = opts?.baseTree;
    const data = await this.request<{ sha?: string }>(
      `https://api.github.com/repos/${owner}/${repo}/git/trees`,
      'POST',
      { tree, ...(baseTree ? { base_tree: baseTree } : {}) },
      opts,
    );
    if (!data?.sha) {
      throw new Error('GitHub create tree returned no sha');
    }
    return { sha: data.sha };
  }

  async createCommit(
    owner: string,
    repo: string,
    input: { message: string; tree: string; parents: string[] },
    opts?: TokenOpts,
  ): Promise<{ sha: string }> {
    const data = await this.request<{ sha?: string }>(
      `https://api.github.com/repos/${owner}/${repo}/git/commits`,
      'POST',
      input,
      opts,
    );
    if (!data?.sha) {
      throw new Error('GitHub create commit returned no sha');
    }
    return { sha: data.sha };
  }

  async updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
    force: boolean = false,
    opts?: TokenOpts,
  ): Promise<void> {
    const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
    await this.request(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/${encodedRef}`,
      'PATCH',
      { sha, force },
      opts,
    );
  }

  private async request<T = any>(
    url: string,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH' = 'GET',
    data?: any,
    opts?: TokenOpts,
  ): Promise<T> {
    const override = opts?.tokenOverride;

    // Resolve the token: explicit override > credential-kind resolution > singleton.
    let resolvedToken: string | null = null;
    if (override) {
      resolvedToken = override;
    } else if (opts?.credentialKind && opts?.hostId) {
      const { resolveGitHubRepoToken } = await import('./git/NativeCredentialBridge');
      resolvedToken = (await resolveGitHubRepoToken({
        repoId: opts.repoId!,
        hostId: opts.hostId!,
        repoFullName: opts.repoFullName,
      })).token;
    } else {
      resolvedToken = this.token;
      // OAuth fallback: when singleton token is absent but the active host has
      // an OAuth credential (OAuth-only user), resolve it so default API calls
      // (request without explicit opts) continue to work.
      if (!resolvedToken && !(opts?.credentialKind)) {
        const oauthToken = await this.resolveOAuthTokenForActiveHost();
        if (oauthToken) resolvedToken = oauthToken;
      }
    }

    if (!resolvedToken) throw new Error('GitHub token is not configured');

    try {
      const response = await http.request<T>({ url, method, data, ...(resolvedToken ? { authOverride: resolvedToken } : {}) });
      return response.data;
    } catch (error) {
      // Attempt 401 recovery when using an App credential.
      if (
        opts?.credentialKind === 'github_app' &&
        opts?.hostId &&
        opts?.repoId &&
        isAppRecoverable401(error)
      ) {
        const { recoverFromApp401 } = await import('./git/NativeCredentialBridge');
        const appCred = await AccountStorage.getGitHubAppCredential(opts.hostId);
        if (appCred) {
          const renewed = await recoverFromApp401(opts.repoId, opts.hostId, appCred);
          if (renewed) {
            const retryResponse = await http.request<T>({ url, method, data, authOverride: renewed.token });
            return retryResponse.data;
          }
        }
      }
      throw error;
    }
  }

  private async requestPaginated(url: string, opts?: TokenOpts): Promise<{ data: any; nextUrl: string | null }> {
    let resolvedToken: string | null = null;

    if (opts?.tokenOverride) {
      resolvedToken = opts.tokenOverride;
    } else if (opts?.credentialKind === 'oauth' && opts?.hostId) {
      const oauthCred = await AccountStorage.getOAuthCredential(opts.hostId);
      resolvedToken = oauthCred?.accessToken ?? null;
    } else {
      resolvedToken = this.token;
      if (!resolvedToken) {
        const oauthToken = await this.resolveOAuthTokenForActiveHost();
        if (oauthToken) resolvedToken = oauthToken;
      }
    }

    if (!resolvedToken) throw new Error('GitHub token is not configured');
    const response = await http.get(url, { authOverride: resolvedToken });
    const linkHeader = response.headers['link'] as string | null;
    const nextUrl = parseNextLink(linkHeader);
    return { data: response.data, nextUrl };
  }

  /**
   * Public unauthenticated GET. Used by the GitHost adapter for read-only
   * metadata fetches that don't need to be tied to the singleton token
   * (so the adapter can be used for public GitHub repos in the future).
   * Returns `null` on any failure.
   */
  static async rawGet<T = unknown>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** Public unauthenticated GET returning the repo metadata, or null. */
  static async getRepoMeta(owner: string, repo: string): Promise<{ default_branch?: string } | null> {
    return GitHubServiceClass.rawGet<{ default_branch?: string }>(
      `https://api.github.com/repos/${owner}/${repo}`,
    );
  }

  static async registerOAuthCredentialForNative(params: {
    repoId: string;
    hostId: string;
    oauthCredential: GitHubOAuthCredentialRecord;
  }): Promise<void> {
    const { registerGitHubOAuthCredential } = await import('./git/NativeCredentialBridge');
    await registerGitHubOAuthCredential(params.repoId, params.hostId, params.oauthCredential.accessToken);
  }

  static async registerGitHubAppCredentialForNative(params: {
    repoId: string;
    hostId: string;
    appCredential: GitHubAppCredentialRecord;
  }): Promise<void> {
    const { registerGitHubAppCredential, enforceAppRepositorySelection } = await import('./git/NativeCredentialBridge');
    enforceAppRepositorySelection(params.repoId, params.appCredential);
    await registerGitHubAppCredential(params.repoId, params.hostId, params.appCredential.token);
  }

  static async clearNativeCredential(repoId: string): Promise<void> {
    const { clearRepoCredential } = await import('./git/NativeCredentialBridge');
    await clearRepoCredential(repoId);
  }

  static async clearNativeCredentialsForHost(hostId: string): Promise<void> {
    const { clearHostCredentials } = await import('./git/NativeCredentialBridge');
    await clearHostCredentials(hostId);
  }
}

// Re-export the class under a stable name so the GitHost adapter can
// call static helpers without going through the singleton.
export const GitHubServiceStatic = GitHubServiceClass;

export interface TokenOpts {
  /** Per-call GitHub token override; bypasses the singleton active-account header. */
  tokenOverride?: string;
  /**
   * Use a specific credential kind for this request instead of the singleton token.
   * - `'github_app'`: use the GitHub App installation token (requires repo to be in selection)
   * - `'oauth'`: use the GitHub OAuth token
   * - `'token'`: use the PAT (default when not specified and no override)
   *
   * When a kind is specified, the service resolves the appropriate token from
   * AccountStorage, handles App pre-expiry renewal, and retries on recoverable 401.
   */
  credentialKind?: 'github_app' | 'oauth' | 'token';
  /**
   * Target repository for App/OAuth credential resolution (owner/repo).
   * Required when `credentialKind` is `'github_app'` or `'oauth'` and no
   * `tokenOverride` is provided.
   */
  repoId?: string;
  /**
   * Host connection id for credential resolution.
   * Required when `credentialKind` is specified.
   */
  hostId?: string;
  repoFullName?: string;
}

function parseNextLink(linkHeader: string | null | undefined): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

function isAppRecoverable401(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: number }).status;
  return status === 401;
}

export const GitHubService = new GitHubServiceClass();
