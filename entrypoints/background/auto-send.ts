import { db } from '@/db/database';
import { debugLog } from '@/lib/debug-log';
import { getAutoSendScheduled, getConfirmRecipient } from '@/lib/send-settings';
import { awaitsRecipientConfirmation, dueMessages } from '@/lib/scheduled-messages';
import { createConversation, sendMessage } from './api/messages';

const ALARM_NAME = 'auto-send-scheduled';
const CHECK_INTERVAL_MINUTES = 1;

/**
 * Sends scheduled messages at their time with no click. On by default: a send
 * time the user still has to click is not really a send time.
 *
 * Runs in the service worker, so the inflow tab need not be open — but Chrome
 * must be running. While Chrome is quit no alarm fires, and a message whose
 * time passed meanwhile goes out on the first tick after it starts again.
 *
 * This is the only place inflow acts on the LinkedIn account unattended, so it
 * is deliberately narrow:
 *  - it sends only messages the user explicitly scheduled, never a plain draft;
 *  - it re-reads both settings on every tick, so turning auto-send off stops
 *    the next message rather than only new ones;
 *  - it refuses anything still awaiting a recipient confirmation, using the
 *    same rule the Outbox uses to disable Send, so the background can never
 *    fire past a gate the UI is still showing;
 *  - it claims each row as 'sending' before dispatching, so a tick that
 *    overlaps the user clicking Send cannot send the same message twice.
 */
export async function runAutoSendTick(now = Date.now()): Promise<void> {
  if (!db) return; // unauthenticated — no DB yet; a later tick retries
  if (!(await getAutoSendScheduled())) return;

  const confirmRecipient = await getConfirmRecipient();
  const due = dueMessages(await db.scheduledMessages.toArray(), now);

  for (const msg of due) {
    if (awaitsRecipientConfirmation(msg, confirmRecipient)) {
      debugLog('info', `[AUTO-SEND] holding ${msg.id.slice(0, 8)} — recipient not confirmed`);
      continue;
    }

    // Claim it first. A failed claim means something else already took it.
    const claimed = await db.scheduledMessages
      .where('id')
      .equals(msg.id)
      .modify((row) => {
        if (row.status !== 'scheduled') return;
        row.status = 'sending';
        row.updatedAt = Date.now();
      });
    if (!claimed) continue;

    try {
      if (msg.conversationId) {
        await sendMessage(msg.conversationId, msg.body);
      } else {
        await createConversation(
          msg.recipientUrns,
          msg.body,
          undefined,
          // Queued as an InMail, so it goes out as one and spends a credit.
          msg.inMailSubject !== undefined ? { subject: msg.inMailSubject } : undefined,
        );
      }
      await db.scheduledMessages.update(msg.id, {
        status: 'sent',
        sentAt: Date.now(),
        updatedAt: Date.now(),
      });
      debugLog('info', `[AUTO-SEND] sent ${msg.id.slice(0, 8)} to ${msg.recipientName}`);
    } catch (e: any) {
      // Back to 'failed', not 'scheduled': a retry loop would keep hitting
      // LinkedIn unattended, which is exactly what should not happen here.
      await db.scheduledMessages.update(msg.id, {
        status: 'failed',
        error: e?.message || 'Auto-send failed',
        updatedAt: Date.now(),
      });
      debugLog('error', `[AUTO-SEND] ${msg.id.slice(0, 8)} failed: ${e?.message}`);
    }
  }
}

/** Wire the recurring check. Safe to call when auto-send is off — the tick
 *  reads the setting itself and returns immediately. */
export function setupAutoSend(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      runAutoSendTick().catch((e) => debugLog('error', `[AUTO-SEND] tick failed: ${e?.message}`));
    }
  });
}
