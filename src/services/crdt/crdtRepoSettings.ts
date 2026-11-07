import { StorageService } from '../StorageService';

/** Whether CRDT merge is switched on for the repo saved under `repoPath` (`owner/name`). Off by default. */
export async function isCrdtMergeEnabled(repoPath: string): Promise<boolean> {
  const repos = await StorageService.getSavedRepositories();
  return repos.some((repo) => repo.path === repoPath && repo.crdtMergeEnabled === true);
}
