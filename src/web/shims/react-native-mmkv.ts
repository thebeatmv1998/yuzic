/**
 * Web shim for `react-native-mmkv`.
 *
 * The real MMKV is a native key/value store. This stands in for it with
 * `localStorage`, namespaced per `id`, so the redux/query/catalog stores the
 * app builds still persist across reloads in the browser.
 *
 * Values are tagged so a boolean, a number and a string round-trip as
 * themselves — `localStorage` only holds strings, and the app reads
 * `getBoolean` (the image-cache migration flag) and strings (everything else).
 */
type MMKVValue = boolean | string | number;

type Tagged = { t: 'b' | 'n' | 's'; v: MMKVValue };

const memoryFallback = new Map<string, string>();

function backing(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Private-browsing modes can throw on access.
  }
  return {
    getItem: (key: string) => memoryFallback.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryFallback.set(key, value);
    },
    removeItem: (key: string) => {
      memoryFallback.delete(key);
    },
  };
}

class WebMMKV {
  constructor(private readonly id: string) {}

  private storageKey(key: string): string {
    return `${this.id}:${key}`;
  }

  private read(key: string): MMKVValue | undefined {
    const raw = backing().getItem(this.storageKey(key));
    if (raw == null) return undefined;
    try {
      const parsed = JSON.parse(raw) as Tagged;
      return parsed.v;
    } catch {
      return undefined;
    }
  }

  private write(key: string, value: MMKVValue): void {
    const tagged: Tagged = {
      t: typeof value === 'boolean' ? 'b' : typeof value === 'number' ? 'n' : 's',
      v: value,
    };
    backing().setItem(this.storageKey(key), JSON.stringify(tagged));
  }

  set(key: string, value: MMKVValue): void {
    this.write(key, value);
  }

  getString(key: string): string | undefined {
    const value = this.read(key);
    return typeof value === 'string' ? value : undefined;
  }

  getNumber(key: string): number | undefined {
    const value = this.read(key);
    return typeof value === 'number' ? value : undefined;
  }

  getBoolean(key: string): boolean | undefined {
    const value = this.read(key);
    return typeof value === 'boolean' ? value : undefined;
  }

  contains(key: string): boolean {
    return this.read(key) !== undefined;
  }

  remove(key: string): void {
    backing().removeItem(this.storageKey(key));
  }

  /** Older MMKV versions named this `delete`; kept for call-site compatibility. */
  delete(key: string): void {
    this.remove(key);
  }

  getAllKeys(): string[] {
    const prefix = `${this.id}:`;
    const keys: string[] = [];
    const store = backing();
    // `length`/`key` only exist on the real Storage interface.
    if (typeof (store as Storage).length === 'number' && 'key' in store) {
      const full = store as Storage;
      for (let i = 0; i < full.length; i += 1) {
        const name = full.key(i);
        if (name && name.startsWith(prefix)) keys.push(name.slice(prefix.length));
      }
      return keys;
    }
    for (const name of memoryFallback.keys()) {
      if (name.startsWith(prefix)) keys.push(name.slice(prefix.length));
    }
    return keys;
  }

  clearAll(): void {
    for (const key of this.getAllKeys()) this.remove(key);
  }
}

export function createMMKV(options?: { id?: string }): WebMMKV {
  return new WebMMKV(options?.id ?? 'mmkv');
}

export default { createMMKV };
