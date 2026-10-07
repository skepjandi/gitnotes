import { GitHubService } from './GitHubService';
import { Todo } from '../models/Todo';
import { parseRepoPath } from '../utils/gitPathParser';
import { AuthService } from './AuthService';
import { CloneSyncService } from './cloneSyncServiceImpl';
import { resolveDefaultFolder, resolveDefaultRepo } from './git/defaultsPolicy';
import { GitFsService } from './git/GitFsService';
import { resolveBranch } from './git/resolveBranch';

async function resolveToken(accountId?: string): Promise<string | undefined> {
  if (!accountId) return undefined;
  const t = await AuthService.getTokenById(accountId);
  return t ?? undefined;
}

export interface TodoGitHubSyncResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

function serializeTodo(todo: Partial<Todo>): string {
  const data = {
    text: todo.text ?? '',
    completed: todo.completed ?? false,
    priority: todo.priority,
    notes: todo.notes,
    tags: todo.tags ?? [],
    dueDate: todo.dueDate,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
  return JSON.stringify(data, null, 2);
}

export async function syncTodoToGitHub(params: {
  repo: string;
  branch?: string;
  filePath?: string;
  text: string;
  todo: Partial<Todo>;
  accountId?: string;
}): Promise<TodoGitHubSyncResult> {
  const { repo, branch, filePath, text, todo, accountId } = params;
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
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      || 'untitled';
    targetPath = `${resolveDefaultFolder('todo')}${slug}.json`;
  }

  const content = serializeTodo(todo);

  // Determine create-vs-update by querying actual remote/clone state rather
  // than trusting the caller-supplied filePath. Callers (TodoListScreen)
  // pre-derive the path from the slug at draft time, so a brand-new todo
  // always carried filePath, which made every first-create commit say
  // "Update todo:" (#626). Falling back to caller's filePath only on lookup
  // failure preserves current behavior on transient errors.
  let fileExists: boolean | null;
  try {
    const cloned = await GitFsService.isCloned({ repoPath });
    if (cloned) {
      const existing = await GitFsService.readFile({ repoPath, ref: targetBranch, filepath: targetPath });
      fileExists = existing !== null;
    } else {
      fileExists = false;
    }
  } catch (error) {
    console.warn('[TodoGitHubSyncService] fileExists check failed:', error);
    fileExists = null;
  }
  const useUpdateVerb = fileExists ?? !!filePath;
  const message = useUpdateVerb ? `Update todo: ${text}` : `Create todo: ${text}`;

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath: targetPath,
    content,
    message,
    intent: 'upsert',
  });
  if (saveResult.success) {
    return { success: true, filePath: targetPath };
  }
  return { success: false, error: saveResult.error };
}

export async function deleteTodoFromGitHub(params: {
  repo: string;
  branch?: string;
  filePath: string;
  text?: string;
  accountId?: string;
}): Promise<TodoGitHubSyncResult> {
  const { repo: repoPath, branch, filePath, text } = params;

  const repoInfo = parseRepoPath(repoPath);
  if (!repoInfo) {
    return { success: false, error: `Invalid repo path: ${repoPath}` };
  }

  // Use the entity's stored branch for deletes.
  const targetBranch = branch ?? (await resolveBranch(repoPath));
  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath,
    message: `Delete todo: ${text || filePath}`,
    intent: 'delete',
  });
  if (saveResult.success) {
    return { success: true, filePath };
  }
  return { success: false, error: saveResult.error };
}
