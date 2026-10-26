import AsyncStorage from '@react-native-async-storage/async-storage';

export type TelemetryPreference = 'enabled' | 'disabled';

export type TelemetryPreferenceListener = (preference: TelemetryPreference) => void;

const TELEMETRY_PREFERENCE_KEY = '@gitnotes:telemetry_preference';

export class TelemetryPreferenceWriteError extends Error {
  constructor() {
    super('Telemetry preference could not be saved');
    this.name = 'TelemetryPreferenceWriteError';
  }
}

/**
 * Owns the telemetry opt-out preference.
 *
 * `current` is the session gate every telemetry consumer reads before
 * dispatching anything. It fails closed: it stays `disabled` until a
 * preference has been loaded, and a user opt-out is never undone by a later
 * read — a failed opt-out write keeps telemetry off for the rest of the
 * session.
 *
 * The newest user choice wins: it is the one that stays in the gate and the
 * one that reaches storage last, no matter how the individual writes settle.
 */
export class TelemetryPreferenceService {
  private preference: TelemetryPreference = 'disabled';
  private hasUserChoice = false;
  private choiceGeneration = 0;
  private outstandingWrites = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private listeners = new Set<TelemetryPreferenceListener>();

  get current(): TelemetryPreference {
    return this.preference;
  }

  subscribe(listener: TelemetryPreferenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Loads the persisted preference into the session gate.
   *
   * - stored `enabled` / `disabled` -> that value
   * - nothing stored -> `enabled` (the default), but only after a successful read
   * - any other stored value -> `disabled` (fail closed)
   * - read failure -> `disabled` (fail closed)
   */
  async load(): Promise<TelemetryPreference> {
    if (this.hasUserChoice) {
      return this.preference;
    }

    const generation = this.choiceGeneration;
    let stored: string | null;
    try {
      stored = await AsyncStorage.getItem(TELEMETRY_PREFERENCE_KEY);
    } catch {
      this.apply('disabled');
      return 'disabled';
    }

    if (generation !== this.choiceGeneration) {
      return this.preference;
    }

    const preference = TelemetryPreferenceService.parse(stored);
    this.apply(preference);
    return preference;
  }

  /**
   * Applies the preference to the session gate and persists it.
   *
   * Disabling closes the gate synchronously, before the write is awaited, so an
   * opt-out is never delayed (or lost) by storage. Enabling persists first and
   * only opens the gate once the write succeeded.
   *
   * Overlapping calls are resolved by user intent, not by write timing: a
   * superseded call never re-opens the gate and never reports its own failure,
   * and the newest choice is the one that reaches storage last.
   *
   * @throws TelemetryPreferenceWriteError when the value could not be persisted.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.hasUserChoice = true;
    const generation = ++this.choiceGeneration;

    if (!enabled) {
      this.apply('disabled');
    }

    try {
      await this.persist(enabled ? 'enabled' : 'disabled');
    } catch {
      if (generation !== this.choiceGeneration) {
        return;
      }
      throw new TelemetryPreferenceWriteError();
    }

    if (generation !== this.choiceGeneration) {
      return;
    }
    if (enabled) {
      this.apply('enabled');
    }
  }

  /**
   * Persists the preference, keeping writes in the order the user made them.
   *
   * Only one write is in flight at a time, so a slower earlier write can never
   * land after a newer one and leave storage holding a superseded value.
   */
  private persist(preference: TelemetryPreference): Promise<void> {
    this.outstandingWrites += 1;
    const issue = (): Promise<void> =>
      AsyncStorage.setItem(TELEMETRY_PREFERENCE_KEY, preference);
    const write = this.outstandingWrites === 1 ? issue() : this.writeTail.then(issue);
    this.writeTail = write.then(
      () => {
        this.outstandingWrites -= 1;
      },
      () => {
        this.outstandingWrites -= 1;
      },
    );
    return write;
  }

  private static parse(stored: string | null): TelemetryPreference {
    if (stored === 'enabled') return 'enabled';
    if (stored === 'disabled') return 'disabled';
    // A missing value means the user never opted out, so the default applies —
    // but only because the read itself succeeded. Any other stored value is
    // unusable and fails closed.
    return stored === null ? 'enabled' : 'disabled';
  }

  private apply(preference: TelemetryPreference): void {
    this.preference = preference;
    this.listeners.forEach((listener) => listener(preference));
  }
}

export const telemetryPreferenceService = new TelemetryPreferenceService();
