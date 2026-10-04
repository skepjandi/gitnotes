// In-memory mock for expo-secure-store; tests should not hit Keychain.
const store: Record<string, string> = {};

export async function getItemAsync(key: string): Promise<string | null> {
  return key in store ? store[key] : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store[key] = value;
}

export async function deleteItemAsync(key: string): Promise<void> {
  delete store[key];
}

export async function clear(): Promise<void> {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}
