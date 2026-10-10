/**
 * Manual mock for @react-native-async-storage/async-storage.
 * Exports a reset function so tests can clear the in-memory store between runs.
 */

const store: Record<string, string> = {};

export function __resetStore() {
  Object.keys(store).forEach((k) => delete store[k]);
}

export function __getStore() {
  return store;
}

const getItem = jest.fn(async (key: string) => store[key] ?? null);
const setItem = jest.fn(async (key: string, value: string) => {
  store[key] = value;
});
const removeItem = jest.fn(async (key: string) => {
  delete store[key];
});
const clear = jest.fn(async () => {
  Object.keys(store).forEach((k) => delete store[k]);
});
const getAllKeys = jest.fn(async () => Object.keys(store));
const multiGet = jest.fn(async (keys: string[]) =>
  keys.map((k) => [k, k in store ? store[k] : null] as [string, string | null]),
);
const multiSet = jest.fn(async (pairs: ReadonlyArray<readonly [string, string]>) => {
  for (const [k, v] of pairs) store[k] = v;
});
const multiRemove = jest.fn(async (keys: readonly string[]) => {
  for (const k of keys) delete store[k];
});

module.exports = {
  __resetStore,
  __getStore,
  default: {
    getItem,
    setItem,
    removeItem,
    clear,
    getAllKeys,
    multiGet,
    multiSet,
    multiRemove,
  },
};
