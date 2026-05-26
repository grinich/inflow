import { vi } from 'vitest';

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

let handlers: Array<{ pattern: string | RegExp; handler: FetchHandler }> = [];
let defaultHandler: FetchHandler = async () => new Response('Not mocked', { status: 500 });

export function mockFetch(pattern: string | RegExp, handler: FetchHandler) {
  handlers.push({ pattern, handler });
}

export function mockFetchDefault(handler: FetchHandler) {
  defaultHandler = handler;
}

export function resetFetchMock() {
  handlers = [];
  defaultHandler = async () => new Response('Not mocked', { status: 500 });
  (globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const { pattern, handler } of handlers) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        return handler(url, init);
      }
    }
    return defaultHandler(url, init);
  });
}

// Initialize on import
resetFetchMock();
