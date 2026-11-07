import { isCrdtMergeEnabled } from '@/services/crdt/crdtRepoSettings';
import { StorageService } from '@/services/StorageService';
import { useRepoStore } from '@/stores/repoStore';

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
    saveRepositories: jest.fn(),
  },
}));

jest.mock('@/services/GitService', () => ({ GitService: {} }));
jest.mock('@/services/git/GitFsService', () => ({ GitFsService: {} }));
jest.mock('@/services/git/activeBranchStore', () => ({
  initializeForRepo: jest.fn(),
  removeForRepo: jest.fn(),
}));
jest.mock('@/services/git/activeHost', () => ({ getActiveGitHost: jest.fn() }));
jest.mock('@/stores/noteStore', () => ({ useNoteStore: { getState: jest.fn() } }));
jest.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: jest.fn() } }));
jest.mock('@/stores/todoStore', () => ({ useTodoStore: { getState: jest.fn() } }));
jest.mock('@/stores/aiStore', () => ({ useAIStore: { getState: jest.fn() } }));
jest.mock('@/services/TemplateRepoPreferenceService', () => ({ TemplateRepoPreferenceService: {} }));
jest.mock('@/services/LastUsedRepoService', () => ({ LastUsedRepoService: {} }));
jest.mock('@/services/AccountStorage', () => ({ AccountStorage: {} }));
jest.mock('@/services/git/engine/GitEngine', () => ({ setCredential: jest.fn() }));

const repoA = { id: 'a', name: 'a', path: 'me/a' };
const repoB = { id: 'b', name: 'b', path: 'me/b' };

describe('per-repo CRDT merge toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StorageService.getSavedRepositories as jest.Mock).mockResolvedValue([repoA, repoB]);
  });

  it('is off by default for every repo', async () => {
    await expect(isCrdtMergeEnabled('me/a')).resolves.toBe(false);
    await expect(isCrdtMergeEnabled('me/unknown')).resolves.toBe(false);
  });

  it('enables CRDT merge only for the chosen repo and persists it', async () => {
    await useRepoStore.getState().setCrdtMergeEnabled('a', true);

    const saved = (StorageService.saveRepositories as jest.Mock).mock.calls[0][0];
    expect(saved).toEqual([{ ...repoA, crdtMergeEnabled: true }, repoB]);
    expect(useRepoStore.getState().repositories).toEqual(saved);
  });

  it('reports a repo as enabled only when its saved flag is true, and off again after disabling', async () => {
    (StorageService.getSavedRepositories as jest.Mock).mockResolvedValue([
      { ...repoA, crdtMergeEnabled: true },
      repoB,
    ]);
    await expect(isCrdtMergeEnabled('me/a')).resolves.toBe(true);
    await expect(isCrdtMergeEnabled('me/b')).resolves.toBe(false);

    await useRepoStore.getState().setCrdtMergeEnabled('a', false);
    const saved = (StorageService.saveRepositories as jest.Mock).mock.calls[0][0];
    expect(saved[0].crdtMergeEnabled).toBe(false);
  });
});
