import { vi } from 'vitest';

/**
 * Controllable stand-in for the WebSocket the background agent bridge dials.
 * Tests inspect `MockWebSocket.instances`, read parsed frames from `sent`,
 * and drive the connection with emitMessage/emitClose.
 */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0; // CONNECTING
  closed = false;
  sent: any[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emitClose();
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }

  emitMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Frames of one type, e.g. sentOfType('AUTH'). */
  sentOfType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

export function installWebSocketMock() {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
}

export function latestSocket(): MockWebSocket | undefined {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}
