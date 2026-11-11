import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Small key/value store. Native: expo-secure-store (Keychain / Keystore). Web: localStorage
 * (SecureStore is not available in browsers; tokens on web are only as safe as the origin).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const memory = new Map<string, string>();

const webStore: KeyValueStore = {
  async get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  async set(key, value) {
    memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode: keep in memory */
    }
  },
  async remove(key) {
    memory.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const nativeStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export const kv: KeyValueStore = Platform.OS === "web" ? webStore : nativeStore;
