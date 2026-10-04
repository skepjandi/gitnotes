import type { GitRepository } from '@/services/GitService';
import { reposAffectedByRemovedCredential } from '@/services/git/repoRemovalCascade';

const HOST_ID = 'account:github:default';

const repositories: GitRepository[] = [
  { id: 'selected', path: 'octo/notes', full_name: 'octo/notes', name: 'notes', hostId: HOST_ID, provider: 'github' },
  { id: 'other', path: 'octo/private', full_name: 'octo/private', name: 'private', hostId: HOST_ID, provider: 'github' },
  { id: 'legacy', path: 'octo/legacy', full_name: 'octo/legacy', name: 'legacy', provider: 'github' },
];

describe('reposAffectedByRemovedCredential', () => {
  it('preserves every host repository while a host-wide credential remains', () => {
    expect(reposAffectedByRemovedCredential(repositories, HOST_ID, {
      hasHostWideCredential: true,
      appRepositories: [],
    })).toEqual([]);
  });

  it('preserves App-selected repositories and removes other stamped repos', () => {
    expect(reposAffectedByRemovedCredential(repositories, HOST_ID, {
      hasHostWideCredential: false,
      appRepositories: [{ owner: 'octo', repo: 'notes' }],
    }).map((repo) => repo.id)).toEqual(['other']);
  });

  it('removes all stamped repos when the last credential is removed', () => {
    expect(reposAffectedByRemovedCredential(repositories, HOST_ID, {
      hasHostWideCredential: false,
      appRepositories: [],
    }).map((repo) => repo.id)).toEqual(['selected', 'other']);
  });

  it('does not guess ownership for legacy repositories', () => {
    expect(reposAffectedByRemovedCredential(repositories, HOST_ID, {
      hasHostWideCredential: false,
      appRepositories: [],
    })).not.toContainEqual(expect.objectContaining({ id: 'legacy' }));
  });
});
