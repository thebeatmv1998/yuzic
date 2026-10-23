/**
 * Web shim for `expo-secure-store`.
 *
 * The real module writes to the iOS Keychain / Android Keystore. The browser
 * has no equivalent, so secrets (server passwords, API keys, tokens) live in
 * `localStorage` here.
 *
 * This is weaker than the native store: it is readable by any script on the
 * origin and is not encrypted at rest. It is the honest ceiling for a
 * browser-hosted build, and the Docker README says so.
 */
const PREFIX = 'yuzic.secure.';
const memory = new Map<string, string>();

/** Kept so callers that pass `keychainAccessible` do not break. */
export const AFTER_FIRST_UNLOCK = 'afterFirstUnlock';
export const WHEN_UNLOCKED = 'whenUnlocked';
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Falls through to memory.
  }
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store().getItem(PREFIX + key);
}

export async function setItemAsync(
  key: string,
  value: string,
  _options?: { keychainAccessible?: string },
): Promise<void> {
  store().setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store().removeItem(PREFIX + key);
}

export const SecureStore = {
  AFTER_FIRST_UNLOCK,
  WHEN_UNLOCKED,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  isAvailableAsync,
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};

export default SecureStore;
