import { isAbsolute, normalize, sep } from 'node:path';
import { exec, type ExecResult } from './exec.js';
import type { GitFileChange, GitFileStatus, GitOp, GitResult } from './protocol.js';
import { RequestError } from './requestError.js';

export const MAX_PATCH_BYTES = 200 * 1024;
const STDERR_LIMIT = 500;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };

const queues = new Map<string, Promise<unknown>>();

/** Runs git ops for one working directory strictly one after another. */
export function runGitOp(cwd: string, op: GitOp): Promise<GitResult> {
  const previous = queues.get(cwd) ?? Promise.resolve();
  const next = previous.then(
    () => execOp(cwd, op),
    () => execOp(cwd, op),
  );
  const tail = next.catch(() => undefined);
  queues.set(cwd, tail);
  void tail.then(() => {
    if (queues.get(cwd) === tail) queues.delete(cwd);
  });
  return next;
}

async function git(cwd: string, args: string[], maxBuffer?: number): Promise<ExecResult> {
  return exec('git', args, { cwd, env: GIT_ENV, maxBuffer });
}

function failure(result: ExecResult): RequestError {
  if (result.spawnFailed) return new RequestError('unsupported', 'git is not installed on the bridge host');
  const text = result.stderr || result.stdout.toString('utf8').trim() || 'git failed';
  return new RequestError('git-failed', text.slice(0, STDERR_LIMIT));
}

function mustSucceed(result: ExecResult): ExecResult {
  if (result.code !== 0) throw failure(result);
  return result;
}

async function repoRoot(cwd: string): Promise<string> {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    if (result.spawnFailed) throw failure(result);
    throw new RequestError('not-a-repo', `${cwd} is not inside a git repository`);
  }
  return result.stdout.toString('utf8').trim();
}

/** Accepts repo-relative paths only: no absolute paths, `..`, NUL bytes or option-looking names. */
export function validateRepoPath(path: unknown): string {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) {
    throw new RequestError('bad-request', 'path must be a non-empty string');
  }
  if (path.startsWith('-') || isAbsolute(path)) {
    throw new RequestError('bad-request', `path must be relative to the repository: ${path}`);
  }
  const normalized = normalize(path);
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.split(/[\\/]/).includes('..')) {
    throw new RequestError('bad-request', `path escapes the repository: ${path}`);
  }
  if (normalized.startsWith('-')) {
    throw new RequestError('bad-request', `path must be relative to the repository: ${path}`);
  }
  return normalized;
}

function validatePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new RequestError('bad-request', 'paths must be a non-empty array');
  }
  return paths.map(validateRepoPath);
}

async function execOp(cwd: string, op: GitOp): Promise<GitResult> {
  const root = await repoRoot(cwd);
  switch (op.kind) {
    case 'status':
      return status(root);
    case 'diff':
      return diff(root, validateRepoPath(op.path), op.staged === true);
    case 'stage': {
      const paths = validatePaths(op.paths);
      mustSucceed(await git(root, ['add', '--', ...paths]));
      return { kind: 'ok' };
    }
    case 'unstage': {
      const paths = validatePaths(op.paths);
      const restored = await git(root, ['restore', '--staged', '--', ...paths]);
      if (restored.code !== 0) {
        const hasHead = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
        if (hasHead) throw failure(restored);
        mustSucceed(await git(root, ['rm', '--cached', '-r', '-q', '--', ...paths]));
      }
      return { kind: 'ok' };
    }
    case 'commit':
      return commit(root, op.message);
    default:
      throw new RequestError('bad-request', 'Unknown git op');
  }
}

async function status(root: string): Promise<GitResult> {
  const result = mustSucceed(
    await git(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']),
  );
  const tokens = result.stdout.toString('utf8').split('\0');
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token === '') continue;
    if (token.startsWith('# branch.head ')) {
      const head = token.slice('# branch.head '.length);
      branch = head === '(detached)' ? null : head;
    } else if (token.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(token);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (token.startsWith('? ')) {
      files.push({ path: token.slice(2), status: 'untracked', staged: false, unstaged: true });
    } else if (token.startsWith('1 ')) {
      const fields = splitFields(token, 9);
      files.push(change(fields[8] as string, fields[1] as string));
    } else if (token.startsWith('2 ')) {
      const fields = splitFields(token, 10);
      const from = tokens[index + 1];
      index += 1;
      files.push({ ...change(fields[9] as string, fields[1] as string), status: 'renamed', from });
    } else if (token.startsWith('u ')) {
      const fields = splitFields(token, 11);
      files.push({ path: fields[10] as string, status: 'conflicted', staged: false, unstaged: true });
    }
  }
  return { kind: 'status', branch, ahead, behind, files };
}

function splitFields(token: string, count: number): string[] {
  const fields: string[] = [];
  let rest = token;
  while (fields.length < count - 1) {
    const space = rest.indexOf(' ');
    if (space === -1) break;
    fields.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  fields.push(rest);
  return fields;
}

function change(path: string, xy: string): GitFileChange {
  const staged = xy[0] !== '.';
  const unstaged = xy[1] !== '.';
  let status: GitFileStatus = 'modified';
  if (xy.includes('A')) status = 'added';
  else if (xy.includes('D')) status = 'deleted';
  return { path, status, staged, unstaged };
}

async function diff(root: string, path: string, staged: boolean): Promise<GitResult> {
  let args: string[];
  if (staged) {
    args = ['diff', '--cached', '--no-color', '--no-ext-diff', '--', path];
  } else {
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', path]);
    args =
      untracked.code === 0 && untracked.stdout.length > 0
        ? ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', path]
        : ['diff', '--no-color', '--no-ext-diff', '--', path];
  }
  const result = await git(root, args, MAX_PATCH_BYTES * 4);
  const noIndexDifference = args.includes('--no-index') && result.code === 1;
  if (result.code !== 0 && !noIndexDifference && !result.overflow) throw failure(result);
  const truncated = result.overflow || result.stdout.length > MAX_PATCH_BYTES;
  const patch = result.stdout.subarray(0, MAX_PATCH_BYTES).toString('utf8');
  return { kind: 'diff', path, staged, patch, truncated };
}

async function commit(root: string, message: unknown): Promise<GitResult> {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new RequestError('bad-request', 'Commit message must not be empty');
  }
  mustSucceed(await git(root, ['commit', '-m', message]));
  const log = mustSucceed(await git(root, ['log', '-1', '--format=%h%x00%s']));
  const [hash = '', summary = ''] = log.stdout.toString('utf8').trim().split('\0');
  return { kind: 'commit', hash, summary };
}
