import { vi } from 'vitest';

let sessionStore: Record<string, any> = {};
let localStore: Record<string, any> = {};

function createChromeMock() {
  return {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
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
      create: vi.fn(),
      onAlarm: {
        addListener: vi.fn(),
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
    },
    windows: {
      update: vi.fn(),
    },
  };
}

export function installChromeMock() {
  (globalThis as any).chrome = createChromeMock();
}

export function resetChromeMock() {
  sessionStore = {};
  localStore = {};
  installChromeMock();
}

export function setSessionStore(key: string, value: any) {
  sessionStore[key] = value;
}

export function setLocalStore(key: string, value: any) {
  localStore[key] = value;
}
