import { readLocal } from '@/lib/storage';

/**
 * Cap on agent-initiated sends: a sliding one-hour window of timestamps in
 * chrome.storage.local. Enforced UI-side in the executor — storage is shared
 * across app instances so two open tabs share one window. The read-modify-
 * write race between two simultaneous sends is accepted for v1; moving
 * enforcement into the background message router is the upgrade path if a
 * stricter guarantee is ever needed.
 */

export const AGENT_SEND_CAP_PER_HOUR = 15;
export const AGENT_SEND_TIMESTAMPS_KEY = 'agentSendTimestamps';

const WINDOW_MS = 60 * 60 * 1000;

export async function checkAndRecordSend(
  now = Date.now()
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const stored = await readLocal<number[]>(AGENT_SEND_TIMESTAMPS_KEY);
  const recent = (Array.isArray(stored) ? stored : [])
    .filter((t) => typeof t === 'number' && now - t < WINDOW_MS);
  if (recent.length >= AGENT_SEND_CAP_PER_HOUR) {
    const oldest = Math.min(...recent);
    return { ok: false, retryAfterMs: oldest + WINDOW_MS - now };
  }
  recent.push(now);
  await chrome.storage.local.set({ [AGENT_SEND_TIMESTAMPS_KEY]: recent });
  return { ok: true };
}
