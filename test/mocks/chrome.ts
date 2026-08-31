import { vi } from 'vitest';

let sessionStore: Record<string, any> = {};
let localStore: Record<string, any> = {};
let storageChangedListeners = new Set<(changes: Record<string, any>, area: string) => void>();
let alarms: Record<string, any> = {};
let alarmListeners = new Set<(alarm: { name: string }) => void>();

function createChromeMock() {
  return {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onMessageExternal: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onConnectExternal: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      getManifest: vi.fn(() => ({ version: '0.4.0' })),
      onInstalled: {
        addListener: vi.fn(),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string | string[] | Record<string, any>) => {
          if (typeof key === 'string') return { [key]: sessionStore[key] };
          return { ...sessionStore };
        }),
        set: vi.fn(async (obj: Record<string, any>) => {
          Object.assign(sessionStore, obj);
        }),
      },
      local: {
        get: vi.fn(async (key: string | string[] | Record<string, any>) => {
          if (typeof key === 'string') return { [key]: localStore[key] };
          return { ...localStore };
        }),
        set: vi.fn(async (obj: Record<string, any>) => {
          Object.assign(localStore, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete localStore[key];
        }),
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      onChanged: {
        addListener: vi.fn((fn: (changes: Record<string, any>, area: string) => void) => {
          storageChangedListeners.add(fn);
        }),
        removeListener: vi.fn((fn: (changes: Record<string, any>, area: string) => void) => {
          storageChangedListeners.delete(fn);
        }),
      },
    },
    cookies: {
      get: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      onChanged: {
        addListener: vi.fn(),
      },
    },
    alarms: {
      create: vi.fn((name: string, info: any) => {
        alarms[name] = info;
      }),
      clear: vi.fn(async (name: string) => {
        const had = name in alarms;
        delete alarms[name];
        return had;
      }),
      onAlarm: {
        addListener: vi.fn((fn: (alarm: { name: string }) => void) => {
          alarmListeners.add(fn);
        }),
        removeListener: vi.fn((fn: (alarm: { name: string }) => void) => {
          alarmListeners.delete(fn);
        }),
      },
    },
    declarativeNetRequest: {
      updateSessionRules: vi.fn().mockResolvedValue(undefined),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      onClicked: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      reload: vi.fn().mockResolvedValue(undefined),
    },
    windows: {
      update: vi.fn(),
      get: vi.fn().mockResolvedValue({ focused: true }),
      getLastFocused: vi.fn().mockResolvedValue({ focused: true }),
    },
    notifications: {
      create: vi.fn(),
      clear: vi.fn(),
      onClicked: {
        addListener: vi.fn(),
      },
    },
  };
}

export function installChromeMock() {
  (globalThis as any).chrome = createChromeMock();
}

export function resetChromeMock() {
  sessionStore = {};
  localStore = {};
  storageChangedListeners = new Set();
  alarms = {};
  alarmListeners = new Set();
  installChromeMock();
}

/** The registered alarms (name → create info). */
export function getAlarms(): Record<string, any> {
  return alarms;
}

/** Fire chrome.alarms.onAlarm listeners, as if the alarm elapsed. */
export function fireAlarm(name: string) {
  for (const fn of alarmListeners) fn({ name });
}

/**
 * Fire chrome.storage.onChanged listeners. The mocked set() does NOT fire
 * this automatically (real Chrome does) — tests trigger it explicitly.
 */
export function fireStorageChanged(changes: Record<string, any>, area = 'local') {
  for (const fn of storageChangedListeners) fn(changes, area);
}

export function setSessionStore(key: string, value: any) {
  sessionStore[key] = value;
}

export function setLocalStore(key: string, value: any) {
  localStore[key] = value;
}
