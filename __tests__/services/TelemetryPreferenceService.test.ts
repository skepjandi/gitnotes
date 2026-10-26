/**
 * Tests for TelemetryPreferenceService.
 *
 * Covers the privacy-critical contract of the telemetry opt-out:
 * - a missing stored value resolves to 'enabled' only after a successful read
 * - a failed read resolves to 'disabled' (fail closed)
 * - an unrecognized stored value resolves to 'disabled' (fail closed)
 * - disabling closes the in-memory gate synchronously, before the storage write
 *   settles, so a delayed write can never keep telemetry on
 * - a failed write leaves the gate disabled for the rest of the session
 * - the persisted value survives a remount (fresh service instance)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  TelemetryPreferenceService,
  TelemetryPreferenceWriteError,
} from '../../src/services/TelemetryPreferenceService';

const STORAGE_KEY = '@gitnotes:telemetry_preference';

const getItemMock = AsyncStorage.getItem as jest.Mock;
const setItemMock = AsyncStorage.setItem as jest.Mock;

let store: Record<string, string>;

function createService(): TelemetryPreferenceService {
  return new TelemetryPreferenceService();
}

describe('TelemetryPreferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store = {};
    getItemMock.mockReset();
    setItemMock.mockReset();
    getItemMock.mockImplementation(async (key: string) => (key in store ? store[key] : null));
    setItemMock.mockImplementation(async (key: string, value: string) => {
      store[key] = value;
    });
  });

  describe('read semantics', () => {
    it('resolves to enabled when nothing is stored', async () => {
      const service = createService();

      await expect(service.load()).resolves.toBe('enabled');
      expect(service.current).toBe('enabled');
    });

    it('resolves to enabled only after a successful read', async () => {
      const service = createService();
      let resolveRead: (value: string | null) => void = () => undefined;
      getItemMock.mockImplementationOnce(
        () => new Promise<string | null>((resolve) => { resolveRead = resolve; }),
      );

      const pending = service.load();
      expect(service.current).toBe('disabled');

      resolveRead(null);
      await expect(pending).resolves.toBe('enabled');
      expect(service.current).toBe('enabled');
    });

    it('resolves to disabled when the read fails', async () => {
      const service = createService();
      getItemMock.mockImplementationOnce(async () => {
        throw new Error('storage unavailable');
      });

      await expect(service.load()).resolves.toBe('disabled');
      expect(service.current).toBe('disabled');
    });

    it('resolves to disabled for an unrecognized stored value', async () => {
      const service = createService();
      getItemMock.mockImplementationOnce(async () => 'yes');

      await expect(service.load()).resolves.toBe('disabled');
      expect(service.current).toBe('disabled');
    });

    it('honours a stored disabled value', async () => {
      const service = createService();
      getItemMock.mockImplementationOnce(async () => 'disabled');

      await expect(service.load()).resolves.toBe('disabled');
      expect(service.current).toBe('disabled');
    });

    it('honours a stored enabled value', async () => {
      const service = createService();
      getItemMock.mockImplementationOnce(async () => 'enabled');

      await expect(service.load()).resolves.toBe('enabled');
      expect(service.current).toBe('enabled');
    });
  });

  describe('write semantics', () => {
    it('persists the disabled value', async () => {
      const service = createService();

      await service.setEnabled(false);

      expect(setItemMock).toHaveBeenCalledWith(STORAGE_KEY, 'disabled');
      expect(store[STORAGE_KEY]).toBe('disabled');
      expect(service.current).toBe('disabled');
    });

    it('persists the enabled value', async () => {
      const service = createService();

      await service.setEnabled(true);

      expect(setItemMock).toHaveBeenCalledWith(STORAGE_KEY, 'enabled');
      expect(store[STORAGE_KEY]).toBe('enabled');
      expect(service.current).toBe('enabled');
    });

    it('closes the gate synchronously before the write settles', async () => {
      const service = createService();
      const observed: boolean[] = [];
      service.subscribe((preference) => observed.push(preference === 'enabled'));

      let resolveWrite: () => void = () => undefined;
      setItemMock.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveWrite = resolve; }),
      );

      const pending = service.setEnabled(false);

      expect(service.current).toBe('disabled');
      expect(observed).toEqual([false]);

      resolveWrite();
      await pending;
      expect(service.current).toBe('disabled');
    });

    it('keeps the gate disabled for the session when the write fails', async () => {
      const service = createService();
      setItemMock.mockImplementationOnce(async () => {
        throw new Error('disk full');
      });

      await expect(service.setEnabled(false)).rejects.toBeInstanceOf(TelemetryPreferenceWriteError);
      expect(service.current).toBe('disabled');
    });

    it('does not open the gate when enabling fails to persist', async () => {
      const service = createService();
      setItemMock.mockImplementationOnce(async () => {
        throw new Error('disk full');
      });

      await expect(service.setEnabled(true)).rejects.toBeInstanceOf(TelemetryPreferenceWriteError);
      expect(service.current).toBe('disabled');
    });

    it('does not re-enable after a failed disable write', async () => {
      const service = createService();
      await service.load();
      expect(service.current).toBe('enabled');

      setItemMock.mockImplementationOnce(async () => {
        throw new Error('disk full');
      });
      await expect(service.setEnabled(false)).rejects.toBeInstanceOf(TelemetryPreferenceWriteError);

      expect(service.current).toBe('disabled');
    });

    it('keeps a failed opt-out off for the session even when storage still says enabled', async () => {
      const service = createService();
      store[STORAGE_KEY] = 'enabled';
      setItemMock.mockImplementationOnce(async () => {
        throw new Error('disk full');
      });
      await expect(service.setEnabled(false)).rejects.toBeInstanceOf(TelemetryPreferenceWriteError);

      await expect(service.load()).resolves.toBe('disabled');
      expect(service.current).toBe('disabled');
    });
  });

  describe('overlapping writes', () => {
    it('keeps the gate closed when an older enable write lands after a newer opt-out', async () => {
      const service = createService();
      await service.load();

      let landEnable: () => void = () => undefined;
      setItemMock.mockImplementationOnce(
        (key: string, value: string) =>
          new Promise<void>((resolve) => {
            landEnable = () => {
              store[key] = value;
              resolve();
            };
          }),
      );

      const enablePending = service.setEnabled(true);
      const disablePending = service.setEnabled(false);

      // The newer opt-out closes the gate synchronously, before any write lands.
      expect(service.current).toBe('disabled');

      landEnable();
      await enablePending;
      await disablePending;

      expect(service.current).toBe('disabled');
      expect(store[STORAGE_KEY]).toBe('disabled');
    });

    it('does not surface a superseded enable failure after a newer opt-out', async () => {
      const service = createService();
      await service.load();

      let failEnable: (error: Error) => void = () => undefined;
      setItemMock.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failEnable = reject;
          }),
      );

      const enablePending = service.setEnabled(true);
      const disablePending = service.setEnabled(false);

      failEnable(new Error('disk full'));

      await expect(enablePending).resolves.toBeUndefined();
      await expect(disablePending).resolves.toBeUndefined();
      expect(service.current).toBe('disabled');
      expect(store[STORAGE_KEY]).toBe('disabled');
    });

    it('reports the newest choice failure even when an older write lands first', async () => {
      const service = createService();
      await service.load();

      const writes: Array<{ settle: () => void; fail: (error: Error) => void }> = [];
      setItemMock.mockImplementation(
        (key: string, value: string) =>
          new Promise<void>((resolve, reject) => {
            writes.push({
              settle: () => {
                store[key] = value;
                resolve();
              },
              fail: reject,
            });
          }),
      );

      const enablePending = service.setEnabled(true);
      const disablePending = service.setEnabled(false);

      writes[0].settle();
      await enablePending;
      await new Promise<void>((resolve) => setImmediate(resolve));

      writes[1].fail(new Error('disk full'));

      await expect(disablePending).rejects.toBeInstanceOf(TelemetryPreferenceWriteError);
      expect(service.current).toBe('disabled');
    });
  });

  describe('persistence across a remount', () => {
    it('reads the persisted disabled value in a fresh service instance', async () => {
      const first = createService();
      await first.setEnabled(false);

      const remounted = createService();
      await expect(remounted.load()).resolves.toBe('disabled');
      expect(remounted.current).toBe('disabled');
    });

    it('reads the persisted enabled value in a fresh service instance', async () => {
      const first = createService();
      await first.setEnabled(true);

      const remounted = createService();
      await expect(remounted.load()).resolves.toBe('enabled');
      expect(remounted.current).toBe('enabled');
    });
  });

  describe('subscriptions', () => {
    it('notifies subscribers when the preference changes', async () => {
      const service = createService();
      const observed: string[] = [];
      service.subscribe((preference) => observed.push(preference));

      await service.setEnabled(false);
      await service.setEnabled(true);

      expect(observed).toEqual(['disabled', 'enabled']);
    });

    it('stops notifying after unsubscribe', async () => {
      const service = createService();
      const observed: string[] = [];
      const unsubscribe = service.subscribe((preference) => observed.push(preference));
      unsubscribe();

      await service.setEnabled(false);

      expect(observed).toEqual([]);
    });
  });
});
