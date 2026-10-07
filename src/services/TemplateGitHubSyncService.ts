import { GitHubService } from './GitHubService';
import { serializeTemplate, templateSlug } from './TemplateMarkdownService';
import type { NoteTemplate } from './TemplateService';
import { CloneSyncService } from './cloneSyncServiceImpl';
import { resolveDefaultFolder } from './git/defaultsPolicy';
import { resolveDefaultRepo } from './git/defaultsPolicy';

export interface TemplateSyncResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export async function syncTemplateToGitHub(params: {
  repoPath: string;
  branch: string;
  template: NoteTemplate;
}): Promise<TemplateSyncResult> {
  const { repoPath: inputRepoPath, branch, template } = params;
  let repoPath: string;
  try {
    repoPath = inputRepoPath ?? await resolveDefaultRepo();
  } catch {
    return { success: false, error: 'No repository configured' };
  }

  if (!(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const targetPath = template.filePath || `${resolveDefaultFolder('template')}${templateSlug(template.name)}.md`;
  const isUpdate = Boolean(template.filePath);
  const message = `${isUpdate ? 'Update' : 'Add'} template ${template.name}`;
  const body = serializeTemplate({ ...template, filePath: undefined });

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch,
    filePath: targetPath,
    content: body,
    message,
    intent: 'upsert',
  });
  if (saveResult.success) return { success: true, filePath: targetPath };
  return { success: false, error: saveResult.error };
}

export async function deleteTemplateFromGitHub(params: {
  repoPath: string;
  branch: string;
  filePath: string;
  name: string;
  sha?: string;
}): Promise<TemplateSyncResult> {
  const { repoPath, branch, filePath, name } = params;

  if (!(await GitHubService.isAuthenticatedAsync())) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const saveResult = await CloneSyncService.save({
    repoPath,
    branch,
    filePath,
    message: `Delete template ${name}`,
    intent: 'delete',
  });
  if (saveResult.success) return { success: true, filePath };
  return { success: false, error: saveResult.error };
}
