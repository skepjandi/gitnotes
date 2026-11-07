import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY_PREFIX = 'agent_bridge_token_';

function tokenKey(bridgeId: string): string {
  return `${TOKEN_KEY_PREFIX}${bridgeId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/** Bridge tokens never touch AsyncStorage on native; web has no secure store so it falls back to it. */
const useSecureStore = Platform.OS !== 'web';

export async function getBridgeToken(bridgeId: string): Promise<string | null> {
  const key = tokenKey(bridgeId);
  try {
    return useSecureStore ? await SecureStore.getItemAsync(key) : await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setBridgeToken(bridgeId: string, token: string): Promise<void> {
  const key = tokenKey(bridgeId);
  if (useSecureStore) await SecureStore.setItemAsync(key, token);
  else await AsyncStorage.setItem(key, token);
}

export async function deleteBridgeToken(bridgeId: string): Promise<void> {
  const key = tokenKey(bridgeId);
  try {
    if (useSecureStore) await SecureStore.deleteItemAsync(key);
    else await AsyncStorage.removeItem(key);
  } catch {
    /* nothing to delete */
  }
}
