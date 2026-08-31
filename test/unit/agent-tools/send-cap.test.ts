import {
  AGENT_SEND_CAP_PER_HOUR,
  AGENT_SEND_TIMESTAMPS_KEY,
  checkAndRecordSend,
} from '@/lib/agent-tools/send-cap';
import { setLocalStore } from '../../mocks/chrome';

const HOUR = 3600000;
const T0 = Date.parse('2026-03-01T12:00:00Z');

async function stored(): Promise<number[]> {
  const r = await chrome.storage.local.get(AGENT_SEND_TIMESTAMPS_KEY);
  return r[AGENT_SEND_TIMESTAMPS_KEY];
}

describe('checkAndRecordSend', () => {
  it('allows up to the cap within one hour, then rejects with the wait time', async () => {
    for (let i = 0; i < AGENT_SEND_CAP_PER_HOUR; i++) {
      expect(await checkAndRecordSend(T0 + i * 1000)).toEqual({ ok: true });
    }
    const rejected = await checkAndRecordSend(T0 + AGENT_SEND_CAP_PER_HOUR * 1000);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      // Oldest send was at T0; the window frees up an hour after it.
      expect(rejected.retryAfterMs).toBe(T0 + HOUR - (T0 + AGENT_SEND_CAP_PER_HOUR * 1000));
    }
    // The rejected attempt must not be recorded.
    expect((await stored()).length).toBe(AGENT_SEND_CAP_PER_HOUR);
  });

  it('slides the window: entries older than an hour stop counting', async () => {
    setLocalStore(
      AGENT_SEND_TIMESTAMPS_KEY,
      Array.from({ length: AGENT_SEND_CAP_PER_HOUR }, () => T0)
    );
    expect((await checkAndRecordSend(T0 + 1000)).ok).toBe(false);
    const later = await checkAndRecordSend(T0 + HOUR);
    expect(later.ok).toBe(true);
    // Every seeded entry aged out of the window — pruned to the fresh one.
    expect(await stored()).toEqual([T0 + HOUR]);
  });

  it('tolerates corrupted stored values', async () => {
    setLocalStore(AGENT_SEND_TIMESTAMPS_KEY, 'garbage');
    expect((await checkAndRecordSend(T0)).ok).toBe(true);
    setLocalStore(AGENT_SEND_TIMESTAMPS_KEY, [null, 'x', T0]);
    expect((await checkAndRecordSend(T0 + 1)).ok).toBe(true);
    expect(await stored()).toEqual([T0, T0 + 1]);
  });
});
