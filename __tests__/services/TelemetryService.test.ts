import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentType } from 'react';
import { TelemetryPreferenceService } from '../../src/services/TelemetryPreferenceService';
import { TelemetryService } from '../../src/services/TelemetryService';
import { WORKER_BASE_URL } from '../../src/types/worker';

const mockObserveConfigure = jest.fn();
const mockObserveModuleLoaded = jest.fn();
const mockObserveNavigationContainer = jest.fn();

jest.mock('expo-observe', () => {
  mockObserveModuleLoaded();
  return {
    __esModule: true,
    Observe: { configure: mockObserveConfigure },
    ObserveRoot: { wrap: (Component: ComponentType) => Component },
    ObserveInteractiveMarker: () => null,
  };
});

jest.mock('expo-observe/integrations/react-navigation', () => ({
  __esModule: true,
  ObserveNavigationContainer: mockObserveNavigationContainer,
}));

const getItemMock = AsyncStorage.getItem as jest.Mock;
const setItemMock = AsyncStorage.setItem as jest.Mock;
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('TelemetryService', () => {
  let preferences: TelemetryPreferenceService;
  let telemetry: TelemetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    getItemMock.mockReset();
    setItemMock.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"accepted":true}'),
    });
    preferences = new TelemetryPreferenceService();
    telemetry = new TelemetryService(preferences);
  });

  it('waits for stored consent before importing Expo Observe', async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    getItemMock.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => { resolveRead = resolve; }),
    );

    const initializing = telemetry.initialize();
    expect(mockObserveModuleLoaded).not.toHaveBeenCalled();
    telemetry.trackGitHostAction('github');
    expect(mockFetch).not.toHaveBeenCalled();

    resolveRead(null);
    const runtime = await initializing;

    expect(mockObserveModuleLoaded).toHaveBeenCalled();
    expect(runtime).not.toBeNull();
    expect(mockObserveModuleLoaded).toHaveBeenCalledTimes(1);
    expect(mockObserveConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        dispatchInDebug: false,
        dispatchingEnabled: true,
        integrations: {
          "react-navigation": {
            filteredParams: expect.arrayContaining(["noteId", "repo", "path", "token", "state"]),
          },
        },
      })
    );
  });

  it('keeps Observe unloaded when preference storage fails', async () => {
    getItemMock.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(telemetry.initialize()).resolves.toBeNull();
    expect(preferences.current).toBe('disabled');
    expect(mockObserveModuleLoaded).not.toHaveBeenCalled();
  });

  it('continues app startup when Observe configuration fails', async () => {
    getItemMock.mockResolvedValueOnce('enabled');
    mockObserveConfigure.mockImplementationOnce(() => {
      throw new Error('native module unavailable');
    });

    await expect(telemetry.initialize()).resolves.toBeNull();
    expect(preferences.current).toBe('enabled');
  });

  it('disables EAS dispatch before awaiting the opt-out write', async () => {
    getItemMock.mockResolvedValueOnce('enabled');
    await telemetry.initialize();
    mockObserveConfigure.mockClear();

    let resolveWrite: () => void = () => undefined;
    setItemMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveWrite = resolve; }),
    );
    const disabling = preferences.setEnabled(false);

    expect(mockObserveConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        dispatchInDebug: false,
        dispatchingEnabled: false,
        integrations: {
          "react-navigation": {
            filteredParams: expect.arrayContaining(["noteId", "repo", "path", "token", "state"]),
          },
        },
      })
    );

    await telemetry.trackGitHostAction('github');
    expect(mockFetch).not.toHaveBeenCalled();

    resolveWrite();
    await disabling;
  });

  it('records app_open once after navigation becomes ready', async () => {
    getItemMock.mockResolvedValueOnce('enabled');
    await telemetry.initialize();

    telemetry.markNavigationReady();
    telemetry.markNavigationReady();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${WORKER_BASE_URL}/usage/events`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'app_open' }),
      }),
    );
  });
});
