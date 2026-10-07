import { GitHubService } from './GitHubService';
import { NoteColor, NoteFormat } from '../models/Note';
import * as FileSystem from 'expo-file-system/legacy';
import { parseRepoPath } from '../utils/gitPathParser';
import { AuthService } from './AuthService';
import { CloneSyncService } from './cloneSyncServiceImpl';
import { GitFsService } from './git/GitFsService';
import { resolveBranch } from './git/resolveBranch';


import type { GitHostProvider } from './git/GitHost';

async function resolveToken(accountId?: string): Promise<string | undefined> {
  if (!accountId) return undefined;
  const t = await AuthService.getTokenById(accountId);
  return t ?? undefined;
}

export interface NoteGitHubSyncResult {
  success: boolean;
  filePath?: string;
  finalContent?: string;
  error?: string;
  status?: number;
}

export function canPersistNoteTags(format?: string): boolean {
  return format === 'markdown' || format === 'neorg' || format === 'org';
}

function joinTags(tags: string[]): string {
  return tags.map((tag) => tag.trim()).filter(Boolean).join(', ');
}

function splitLines(value: string): string[] {
  return value.length === 0 ? [] : value.split('\n');
}

function upsertMarkdownTags(content: string, tags: string[]): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return tags.length > 0 ? `---\ntags: [${joinTags(tags)}]\n---\n\n${content}` : content;
  }

  const body = content.slice(match[0].length);
  const lines = splitLines(match[1]).filter((line) => !/^tags\s*:/i.test(line.trim()));
  if (tags.length > 0) {
    lines.push(`tags: [${joinTags(tags)}]`);
  }

  if (lines.length === 0) {
    return body.replace(/^\n+/, '');
  }

  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

// Mutates / inserts a `color: <value>` line in the markdown frontmatter.
// `color === null/undefined` removes the field. Adds a frontmatter block
// when none exists and the color is set; leaves un-fronted notes untouched
// when clearing.
function upsertMarkdownColor(content: string, color: NoteColor | null | undefined): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    if (!color) return content;
    return `---\ncolor: ${color}\n---\n\n${content}`;
  }

  const body = content.slice(match[0].length);
  const lines = splitLines(match[1]).filter((line) => !/^color\s*:/i.test(line.trim()));
  if (color) {
    lines.push(`color: ${color}`);
  }

  if (lines.length === 0) {
    return body.replace(/^\n+/, '');
  }

  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

function upsertOrgColor(content: string, color: NoteColor | null | undefined): string {
  const lines = splitLines(content);
  const index = lines.findIndex((line) => /^#\+COLOR:/i.test(line.trim()));

  if (index === -1) {
    if (!color) return content;
    return `#+COLOR: ${color}\n${content}`;
  }

  if (!color) {
    lines.splice(index, 1);
    return lines.join('\n').replace(/^\n+/, '');
  }

  lines[index] = `#+COLOR: ${color}`;
  return lines.join('\n');
}

function upsertNeorgColor(content: string, color: NoteColor | null | undefined): string {
  const lines = splitLines(content);
  const startIndex = lines.findIndex((line) => line.trim() === '@document.meta');

  if (startIndex === -1) {
    if (!color) return content;
    return `@document.meta\ncolor: ${color}\n@end\n\n${content}`;
  }

  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim() === '@end');
  if (endIndex === -1) return content;

  const metaLines = lines.slice(startIndex + 1, endIndex).filter((line) => !/^color\s*:/i.test(line.trim()));
  if (color) {
    metaLines.push(`color: ${color}`);
  }

  return [
    ...lines.slice(0, startIndex + 1),
    ...metaLines,
    ...lines.slice(endIndex),
  ].join('\n');
}

export function applyNoteColorToContent(
  content: string,
  format: NoteFormat | undefined,
  color: NoteColor | null | undefined,
): string {
  if (!canPersistNoteTags(format)) return content;
  if (format === 'markdown') return upsertMarkdownColor(content, color);
  if (format === 'org') return upsertOrgColor(content, color);
  if (format === 'neorg') return upsertNeorgColor(content, color);
  return content;
}

function upsertOrgTags(content: string, tags: string[]): string {
  const lines = splitLines(content);
  const index = lines.findIndex((line) => /^#\+FILETAGS:/i.test(line.trim()));

  if (index === -1) {
    if (tags.length === 0) return content;
    return `#+FILETAGS: :${tags.map((tag) => tag.trim()).filter(Boolean).join(':')}:\n\n${content}`;
  }

  if (tags.length === 0) {
    lines.splice(index, 1);
    return lines.join('\n').replace(/^\n+/, '');
  }

  lines[index] = `#+FILETAGS: :${tags.map((tag) => tag.trim()).filter(Boolean).join(':')}:`;
  return lines.join('\n');
}

function upsertNeorgTags(content: string, tags: string[]): string {
  const lines = splitLines(content);
  const startIndex = lines.findIndex((line) => line.trim() === '@document.meta');

  if (startIndex === -1) {
    if (tags.length === 0) return content;
    return `@document.meta\ncategories: [${joinTags(tags)}]\n@end\n\n${content}`;
  }

  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim() === '@end');
  if (endIndex === -1) return content;

  const metaLines = lines.slice(startIndex + 1, endIndex).filter((line) => !/^categories\s*:/i.test(line.trim()));
  if (tags.length > 0) {
    metaLines.push(`categories: [${joinTags(tags)}]`);
  }

  if (metaLines.length === 0) {
    return content;
  }

  return [
    ...lines.slice(0, startIndex + 1),
    ...metaLines,
    ...lines.slice(endIndex),
  ].join('\n');
}

export function applyNoteTagsToContent(content: string, format?: NoteFormat, tags: string[] = []): string {
  if (!canPersistNoteTags(format)) return content;
  if (format === 'markdown') return upsertMarkdownTags(content, tags);
  if (format === 'org') return upsertOrgTags(content, tags);
  if (format === 'neorg') return upsertNeorgTags(content, tags);
  return content;
}

function getExtension(format?: NoteFormat): string {
  switch (format) {
    case 'neorg': return '.norg';
    case 'org': return '.org';
    default: return '.md';
  }
}

function slugify(title: string): string {
  // Cap the slug at 60 chars so a runaway title (#624 / #628 — body text
  // accidentally appended to the title field) can't produce a 200-char
  // filename on GitHub.
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';
  return slug.length > 60 ? slug.slice(0, 60).replace(/-$/, '') || 'untitled' : slug;
}

function isLocalUri(uri: string): boolean {
  return uri.startsWith('file://') ||
    uri.startsWith('asset://') ||
    uri.startsWith('ph://') ||
    uri.startsWith('content://');
}

function sanitizeImageName(uri: string): string {
  const segments = uri.split('/');
  const rawName = segments[segments.length - 1] || `image-${Date.now()}.jpg`;
  const cleaned = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (cleaned.includes('.')) return cleaned;
  return `${cleaned}.jpg`;
}

async function uploadLocalImages(
  content: string,
  owner: string,
  repo: string,
  branch: string,
  noteSlug: string,
  opts?: { tokenOverride?: string; provider?: GitHostProvider },
): Promise<string> {
  const imageRegex = /(!\[[^\]]*\]\()([^)]+)(\))/g;
  let updatedContent = content;
  const matches: { fullPrefix: string; uri: string; fullSuffix: string }[] = [];

  let match: RegExpExecArray | null = imageRegex.exec(content);
  while (match !== null) {
    const uri = match[2];
    if (isLocalUri(uri)) {
      matches.push({ fullPrefix: match[1], uri, fullSuffix: match[3] });
    }
    match = imageRegex.exec(content);
  }

  if (matches.length === 0) return updatedContent;

  // Resolve once per save: a public repo gets the cheap raw URL (works
  // unauthenticated, cacheable on CDNs); a private repo gets a stable
  // `gitnotes://repo-image/...` scheme that the renderer resolves to a
  // `data:` URI via the authenticated Contents API at view time. We can't
  // pin a `?token=` raw URL because GitHub's signed download URLs expire
  // after a few minutes — once persisted in markdown they 404 forever
  // (#733).
  const isPrivate = await GitHubService.getRepoPrivacy(owner, repo, opts);
  // Conservative default on lookup failure: assume private. A public repo
  // misclassified as private still renders correctly via the auth path; the
  // reverse silently 404s for the user.
  const usePrivateScheme = isPrivate !== false;

  for (const img of matches) {
    try {
      const base64 = await FileSystem.readAsStringAsync(img.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!base64) {
        console.warn('[NoteGitHubSync] Empty base64 for image:', img.uri);
        continue;
      }

      const imageName = sanitizeImageName(img.uri);
      const imagePath = `notes/images/${noteSlug}/${imageName}`;

      const uploadResult = await GitHubService.uploadBinaryFile(
        owner,
        repo,
        imagePath,
        base64,
        `Upload image: ${imageName}`,
        branch,
      );

      if (uploadResult) {
        const persistedUrl = usePrivateScheme
          ? `gitnotes://repo-image/${owner}/${repo}/${encodeURIComponent(branch)}/${imagePath}`
          : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${imagePath}`;
        updatedContent = updatedContent.replace(
          `${img.fullPrefix}${img.uri}${img.fullSuffix}`,
          `${img.fullPrefix}${persistedUrl}${img.fullSuffix}`,
        );
      } else {
        console.warn('[NoteGitHubSync] Failed to upload image:', imageName);
      }
    } catch (error) {
      console.warn('[NoteGitHubSync] Error uploading image:', img.uri, error);
    }
  }

  return updatedContent;
}

export async function deleteNoteFromGitHub(params: {
  repo: string;
  branch?: string;
  filePath: string;
  title?: string;
  accountId?: string;
  provider?: GitHostProvider;
  /**
   * Clone-mode only. When false, the local deletion is left unstaged and
   * the push to origin is deferred. The drain in `NoteSyncQueueService`
   * uses this to coalesce delete+upsert pushes into one round-trip per
   * `(repo, branch)` group (issue #565 phases B.1 + A). Ignored on the
   * Contents-API path.
   */
  push?: boolean;
}): Promise<NoteGitHubSyncResult> {
  const { repo: repoPath, branch, filePath, title, accountId } = params;
  const tokenOverride = await resolveToken(accountId);

  if (!tokenOverride && !(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const repoInfo = parseRepoPath(repoPath);
  if (!repoInfo) {
    return { success: false, error: `Invalid repo path: ${repoPath}` };
  }

  // Use the entity's stored branch for deletes (to target the correct branch
  // where the file exists), falling back to HEAD only if not available.
  const targetBranch = branch ?? (await resolveBranch(repoPath));

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath,
    message: `Delete note: ${title || filePath}`,
    intent: 'delete',
  });
  return saveResult.success
    ? { success: true, filePath }
    : { success: false, error: saveResult.error };
}

export async function syncNoteToGitHub(params: {
  repo: string;
  branch?: string;
  filePath?: string;
  title: string;
  content: string;
  format?: NoteFormat;
  accountId?: string;
  provider?: GitHostProvider;
  tags?: string[];
  color?: NoteColor | null;
  /**
   * Clone-mode only. When false, the local working tree is updated and a
   * commit is created but the push to origin is deferred. The drain in
   * `NoteSyncQueueService` uses this to coalesce N writes into 1 push round-
   * trip per `(repo, branch)` group (issue #565 phase B.1). Ignored on the
   * Contents-API path — every API call is its own round-trip.
   */
  push?: boolean;
  knownSha?: string;
}): Promise<NoteGitHubSyncResult> {
  const { repo: repoPath, branch, filePath, title, content, format, accountId, tags = [], color, knownSha } = params;
  const tokenOverride = await resolveToken(accountId);

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (content.length > MAX_FILE_SIZE) {
    return { success: false, error: `Refusing to write file exceeding 5 MB (${Math.round(content.length / 1024 / 1024)} MB) — possible data corruption` };
  }

  if (!tokenOverride && !(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const repoInfo = parseRepoPath(repoPath);
  if (!repoInfo) {
    return { success: false, error: `Invalid repo path: ${repoPath}` };
  }

  // For updates (knownSha from conflict guard, or entity already has a filePath),
  // use the entity's stored branch to preserve branch identity.
  // For creates, resolve HEAD.
  const isUpdate = !!(knownSha || filePath);
  const targetBranch = isUpdate && branch ? branch : await resolveBranch(repoPath);

  const ext = getExtension(format);
  const opts = tokenOverride ? { tokenOverride } : undefined;

  let targetPath = filePath;
  if (!targetPath) {
    const slug = slugify(title);
    targetPath = `notes/${slug}${ext}`;
  }

  const noteSlug = slugify(title);

  let finalContent = applyNoteTagsToContent(content, format, tags);
  finalContent = applyNoteColorToContent(finalContent, format, color);
  try {
    finalContent = await uploadLocalImages(finalContent, repoInfo.owner, repoInfo.repo, targetBranch, noteSlug, { ...opts, provider: params.provider });
  } catch (error) {
    console.warn('[NoteGitHubSync] Image upload failed, syncing note without images:', error);
  }

  // Determine create-vs-update by querying remote/clone state rather than
  // trusting the caller-supplied filePath. The note editor pre-derives the
  // path from `folderPath/slug.ext` at draft time, which made the commit
  // message read "Update note:" the very first time a note was pushed
  // (#615 / #626 family). `knownSha` from the conflict guard (#617) is
  // also a strong "this is an update" signal. Fall back to caller intent
  // on lookup failure so a transient error doesn't flip a real update into
  // a "Create".
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
    const code = (error as Error & { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'NotFoundError' || /NotFoundError|Could not find object|not foundobject/i.test(message)) {
      fileExists = false;
    } else {
      console.warn('[NoteGitHubSync] fileExists check failed:', error);
      fileExists = null;
    }
  }
  const useUpdateVerb = fileExists ?? !!(knownSha || filePath);
  const message = useUpdateVerb ? `Update note: ${title}` : `Create note: ${title}`;

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch: targetBranch,
    filePath: targetPath,
    content: finalContent,
    message,
    intent: 'upsert',
  });
  if (saveResult.success) {
    return { success: true, filePath: targetPath, finalContent };
  }
  return { success: false, error: saveResult.error };
}
