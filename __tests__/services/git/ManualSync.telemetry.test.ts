import { StorageService } from '../../../src/services/StorageService';
import { pullAllFromRepos, pullFromSingleRepo } from '../../../src/services/RepoPullService';
import { telemetryService } from '../../../src/services/TelemetryService';
import { syncNow } from '../../../src/services/git/ManualSync';

jest.mock('../../../src/services/RepoPullService', () => ({
  pullAllFromRepos: jest.fn(),
  pullFromSingleRepo: jest.fn(),
}));
jest.mock('../../../src/services/StorageService', () => ({
  StorageService: { getSavedRepositories: jest.fn() },
}));
jest.mock('../../../src/services/TelemetryService', () => ({
  telemetryService: { trackGitHostAction: jest.fn() },
}));
jest.mock('../../../src/utils/gitPathParser', () => ({
  parseRepoPath: jest.fn(() => ({ owner: 'owner', repo: 'repo' })),
}));
jest.mock('../../../src/services/git/GitSyncGate', () => ({
  GitSyncGate: {
    acquireCycle: jest.fn(async () => jest.fn()),
    waitForIdle: jest.fn(async () => true),
  },
}));
jest.mock('../../../src/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ refreshCanvases: jest.fn() }) },
}));
jest.mock('../../../src/stores/noteStore', () => ({
  useNoteStore: { getState: () => ({ refreshNotes: jest.fn() }) },
}));
jest.mock('../../../src/stores/todoStore', () => ({
  useTodoStore: { getState: () => ({ refreshTodos: jest.fn() }) },
}));

const mockPullAllFromRepos = jest.mocked(pullAllFromRepos);
const mockPullFromSingleRepo = jest.mocked(pullFromSingleRepo);
const mockSavedRepos = jest.mocked(StorageService.getSavedRepositories);
const mockTrackHostAction = jest.mocked(telemetryService.trackGitHostAction);

describe('ManualSync usage counters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPullAllFromRepos.mockResolvedValue({
      repos: 2,
      notes: 0,
      canvases: 0,
      todos: 0,
      templates: 0,
    });
    mockPullFromSingleRepo.mockResolvedValue({
      repos: 1,
      notes: 0,
      canvases: 0,
      todos: 0,
      templates: 0,
    });
    mockSavedRepos.mockResolvedValue([
      { id: 'github:owner/one', path: 'owner/one', name: 'one', provider: 'github' },
      { id: 'gitlab:owner/two', path: 'owner/two', name: 'two', provider: 'gitlab' },
    ]);
  });

  it('records one fixed host event for each repo in a successful manual sync', async () => {
    const recorded = new Promise<void>((resolve) => {
      mockTrackHostAction.mockImplementationOnce(() => undefined).mockImplementationOnce(() => resolve());
    });

    await expect(syncNow()).resolves.toEqual({ ok: true });
    await recorded;

    expect(mockTrackHostAction).toHaveBeenNthCalledWith(1, 'github');
    expect(mockTrackHostAction).toHaveBeenNthCalledWith(2, 'gitlab');
  });

  it('does not record startup pulls as user Git-host actions', async () => {
    await expect(syncNow({ source: 'startup' })).resolves.toEqual({ ok: true });

    expect(mockTrackHostAction).not.toHaveBeenCalled();
  });
});
