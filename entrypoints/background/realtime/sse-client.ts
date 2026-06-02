/**
 * Background SSE client for LinkedIn's /realtime/connect stream.
 *
 * Connects directly from the service worker using fetch() with a streaming
 * ReadableStream reader (service workers can't use EventSource).
 *
 * Cookies and Sec-Fetch-* headers are injected via declarativeNetRequest rules
 * (see client.ts ensureCookieRule) to make the request appear same-origin.
 */

import { realtimeFetch } from '../api/client';
import { getMemberUrn } from '../auth/session';
import { debugLog } from '@/lib/debug-log';
import { handleRealtimeEvent } from './event-handler';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let abortController: AbortController | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let connected = false;
let lastEventAt = 0;
let realtimeSessionId: string | null = null;

// Serializes SSE event handling so two events touching the same conversation /
// message row can't race on a non-transactional get→update and lose an update.
let _eventChain: Promise<void> = Promise.resolve();

/** Consider the connection stale if no event received for 3 minutes. */
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RECONNECT_INTERVAL_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 100;
/** After exhausting fast retries, keep retrying on this slow cadence (self-heal). */
const GIVEUP_BACKOFF_MS = 5 * 60 * 1000;

let _broadcastDebounce: ReturnType<typeof setTimeout> | null = null;
function broadcastSSEStatus(): void {
  if (_broadcastDebounce) return;
  _broadcastDebounce = setTimeout(() => {
    _broadcastDebounce = null;
    chrome.runtime.sendMessage({
      type: 'SSE_STATUS',
      connected,
      reconnecting: !!reconnectTimer || (!connected && reconnectAttempts > 0),
    }).catch(() => {});
  }, 100);
}

export function getSSEStatus() {
  return {
    connected,
    reconnecting: !!reconnectTimer || (!connected && reconnectAttempts > 0),
  };
}

export function isRealtimeConnected(): boolean {
  if (!connected) return false;
  if (Date.now() - lastEventAt > STALE_THRESHOLD_MS) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the background SSE connection. Called once on service worker startup.
 * Non-blocking — handles its own errors and reconnection.
 */
export function startRealtime(): void {
  debugLog('info', '[SSE] Starting background realtime connection');
  connect().catch((err) => {
    debugLog('error', `[SSE] Initial connection failed: ${err}`);
    scheduleReconnect();
  });
}

/**
 * Stop the SSE connection and clean up.
 */
export function stopRealtime(): void {
  debugLog('info', '[SSE] Stopping realtime connection');
  cleanup();
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function connect(): Promise<void> {
  // Clean up any existing connection
  cleanup();

  debugLog('info', '[SSE] Connecting to /realtime/connect ...');

  abortController = new AbortController();

  let res: Response;
  try {
    res = await realtimeFetch('/realtime/connect?rc=1', {
      headers: {
        accept: 'text/event-stream',
      },
      signal: abortController.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      debugLog('info', '[SSE] Connection aborted');
      return;
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '(could not read body)');
    debugLog('error', `[SSE] Connect failed: ${res.status} ${body.substring(0, 500)}`);
    throw new Error(`SSE connect failed: ${res.status} ${body.substring(0, 200)}`);
  }

  if (!res.body) {
    debugLog('error', '[SSE] Response has no body');
    throw new Error('SSE response has no body');
  }

  debugLog('info', '[SSE] Connected successfully');
  connected = true;
  lastEventAt = Date.now();
  reconnectAttempts = 0;
  broadcastSSEStatus();

  // Start reading the stream
  reader = res.body.getReader();
  readStream(reader);

  // Start heartbeat
  startHeartbeat();
}

// ---------------------------------------------------------------------------
// Stream reading & SSE parsing
// ---------------------------------------------------------------------------

async function readStream(
  streamReader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let totalChunks = 0;
  let totalEvents = 0;

  try {
    while (true) {
      const { value, done } = await streamReader.read();

      if (done) {
        debugLog('info', `[SSE] Stream ended (done=true). Total: ${totalChunks} chunks, ${totalEvents} events`);
        break;
      }

      totalChunks++;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Split on double newline to get complete SSE events
      const events = buffer.split('\n\n');
      buffer = events.pop()!; // Last element is incomplete or empty

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;
        totalEvents++;
        processRawEvent(rawEvent);
      }
      // Update lastEventAt after processing complete events (not raw chunks)
      if (events.length > 0) {
        lastEventAt = Date.now();
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      debugLog('info', '[SSE] Stream read aborted');
      return;
    }
    debugLog('error', `[SSE] Stream read error: ${err}`);
  }

  // Stream ended — reconnect
  connected = false;
  broadcastSSEStatus();
  debugLog('info', '[SSE] Connection lost, scheduling reconnect...');
  scheduleReconnect();
}

function processRawEvent(raw: string): void {
  const lines = raw.split('\n');
  let eventType = '';
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const dataStr = dataLines.join('');
  if (!dataStr) return;

  let data: any;
  try {
    data = JSON.parse(dataStr);
  } catch {
    debugLog('warn', `[SSE] Failed to parse event data: ${dataStr.substring(0, 200)}`);
    return;
  }

  // Extract realtimeSessionId from connection events
  if (data.realtimeSessionId) {
    realtimeSessionId = data.realtimeSessionId;
    debugLog('info', `[SSE] Got realtimeSessionId: ${realtimeSessionId}`);
  }

  // Forward to event handler, serialized so concurrent handlers don't perform
  // overlapping read-modify-writes on the same conversation/message rows.
  _eventChain = _eventChain
    .then(() => handleRealtimeEvent(eventType, data))
    .catch((err) => debugLog('error', `[SSE] event handler error: ${err}`));
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(async () => {
    // Watchdog: a half-open socket leaves readStream blocked on read() forever
    // with connected=true, so inbound messages silently stop. If no SSE event
    // (including server keep-alives) has arrived within the stale threshold,
    // force a reconnect rather than sitting on a dead stream.
    if (connected && lastEventAt > 0 && Date.now() - lastEventAt > STALE_THRESHOLD_MS) {
      debugLog('warn', '[SSE] No events for >3min — connection stale, forcing reconnect');
      connected = false;
      broadcastSSEStatus();
      stopHeartbeat();
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (reader) {
        reader.cancel().catch(() => {});
        reader = null;
      }
      scheduleReconnect();
      return;
    }

    if (!connected || !realtimeSessionId) return;

    try {
      const memberUrn = await getMemberUrn();
      const body = JSON.stringify({
        isFirstHeartbeat: false,
        isLastHeartbeat: false,
        realtimeSessionId,
        mpName: 'voyager-web',
        mpVersion: '1.0',
        clientId: 'voyager-web',
        actorUrn: memberUrn,
        contextUrns: [],
      });

      await realtimeFetch(
        '/realtime/realtimeFrontendClientConnectivityTracking?action=sendHeartbeat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }
      );
    } catch (err) {
      debugLog('error', `[SSE] Heartbeat failed: ${err}`);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  reconnectAttempts++;

  // After exhausting fast retries, don't give up permanently (which left the UI
  // stuck showing "reconnecting" forever with no recovery). Reset and keep
  // retrying on a slow cadence so the connection can self-heal.
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    debugLog('error', `[SSE] Max fast reconnect attempts reached — backing off to ${GIVEUP_BACKOFF_MS}ms cadence`);
    reconnectAttempts = 0;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((err) => {
        debugLog('error', `[SSE] Reconnect failed: ${err}`);
        scheduleReconnect();
      });
    }, GIVEUP_BACKOFF_MS);
    broadcastSSEStatus();
    return;
  }

  const delay = Math.min(RECONNECT_INTERVAL_MS * Math.pow(2, Math.min(reconnectAttempts, 7)), 120_000);

  debugLog(
    'info',
    `[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => {
      debugLog('error', `[SSE] Reconnect failed: ${err}`);
      scheduleReconnect();
    });
  }, delay);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  connected = false;
  realtimeSessionId = null;
  broadcastSSEStatus();

  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (reader) {
    reader.cancel().catch(() => {});
    reader = null;
  }

  stopHeartbeat();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
