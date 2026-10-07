import { GitHubService } from './GitHubService';
import { CanvasScene, slugifyCanvasTitle } from '../models/Canvas';
import { parseRepoPath } from '../utils/gitPathParser';
import { AuthService } from './AuthService';
import { CloneSyncService } from './cloneSyncServiceImpl';
import { resolveDefaultFolder, resolveDefaultRepo } from './git/defaultsPolicy';
import { resolveBranch } from './git/resolveBranch';

async function resolveToken(accountId?: string): Promise<string | undefined> {
  if (!accountId) return undefined;
  const t = await AuthService.getTokenById(accountId);
  return t ?? undefined;
}

export interface CanvasGitHubSyncResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export async function syncCanvasToGitHub(params: {
  repo: string;
  branch?: string;
  filePath?: string;
  title: string;
  scene: CanvasScene;
  accountId?: string;
}): Promise<CanvasGitHubSyncResult> {
  const { repo, branch, filePath, title, scene, accountId } = params;
  let repoPath: string;
  try {
    repoPath = repo ?? await resolveDefaultRepo();
  } catch {
    return { success: false, error: 'No repository configured' };
  }
  const tokenOverride = await resolveToken(accountId);

  if (!tokenOverride && !(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const repoInfo = parseRepoPath(repoPath);
  if (!repoInfo) {
    return { success: false, error: `Invalid repo path: ${repoPath}` };
  }

  // Updates preserve stored branch; creates use HEAD.
  const targetBranch = filePath && branch ? branch : await resolveBranch(repoPath);

  let targetPath = filePath;
  if (!targetPath) {
    const slug = slugifyCanvasTitle(title);
    targetPath = `${resolveDefaultFolder('canvas')}${slug}.json`;
  }

  const content = JSON.stringify(scene, null, 2);
  const message = filePath
    ? `Update canvas: ${title}`
    : `Create canvas: ${title}`;

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath: targetPath,
    content,
    message,
    intent: 'upsert',
  });
  // 'queued' means local commit succeeded but push was deferred — the
  // canvas IS saved locally, which is the expected clone-mode outcome.
  if (saveResult.success || saveResult.error === 'queued') {
    return { success: true, filePath: targetPath };
  }
  return { success: false, error: saveResult.error };
}

export async function deleteCanvasFromGitHub(params: {
  repo: string;
  branch?: string;
  filePath: string;
  title?: string;
  accountId?: string;
}): Promise<CanvasGitHubSyncResult> {
  const { repo: repoPath, branch, filePath, title, accountId } = params;
  const tokenOverride = await resolveToken(accountId);

  if (!tokenOverride && !(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const repoInfo = parseRepoPath(repoPath);
  if (!repoInfo) {
    return { success: false, error: `Invalid repo path: ${repoPath}` };
  }

  const targetBranch = branch ?? (await resolveBranch(repoPath));
  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath,
    message: `Delete canvas: ${title || filePath}`,
    intent: 'delete',
  });
  if (saveResult.success || saveResult.error === 'queued') {
    return { success: true, filePath };
  }
  return { success: false, error: saveResult.error };
}
