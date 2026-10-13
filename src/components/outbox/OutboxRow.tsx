import { useState } from 'react';
import { format } from 'date-fns';
import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { statusLabel, awaitsRecipientConfirmation } from '@/lib/scheduled-messages';
import { GroupAvatar } from '../common/GroupAvatar';
import type { ScheduledMessage } from '@/types/scheduled-message';

/** Convert epoch ms → value for <input type="datetime-local">. */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function badgeClass(status: ScheduledMessage['status'], ready: boolean): string {
  if (ready) return 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300';
  switch (status) {
    case 'scheduled':
    case 'sending':
      return 'bg-blue-500/15 text-blue-700 ring-blue-500/30 dark:text-blue-300';
    case 'sent':
      return 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300';
    default:
      return 'bg-surface-input text-fg-muted ring-edge';
  }
}


/** One draft / scheduled / sent item, with inline actions. Shared by the MCP
 *  connector section and the Inbox Drafts/Scheduled views. */
export function OutboxRow({ msg, ready }: { msg: ScheduledMessage; ready?: boolean }) {
  const showToast = useUIStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const confirmDelete = useUIStore((s) => s.confirmDelete);
  const [when, setWhen] = useState('');
  const pending = msg.status === 'draft' || msg.status === 'scheduled' || msg.status === 'failed';
  const confirmRecipient = useUIStore((s) => s.confirmRecipient);
  // Only a draft Claude created: it resolved a name to a URN out of sight, and
  // a name search can return two different people with the same name. A draft
  // written in the composer is already confirmed, because the user picked the
  // recipient from a list showing their name, headline and photo. Connections
  // are exempt either way — their URN came from the user's own synced list.
  const claudeInMail = msg.source === 'mcp' && msg.inMailSubject !== undefined;
  const needsConfirm = awaitsRecipientConfirmation(msg, confirmRecipient);

  const save = async (patch: Partial<ScheduledMessage>) => {
    if (!db) return;
    await db.scheduledMessages.update(msg.id, { ...patch, updatedAt: Date.now() });
  };

  const sendNow = async () => {
    if (!db || busy) return;
    setBusy(true);
    await save({ status: 'sending' }); // claim locally so nothing double-sends
    try {
      // A reply (conversationId set) sends into the existing thread; a new
      // outbound message creates a fresh conversation from the recipient URNs.
      const res = msg.conversationId
        ? await sendBridgeMessage({ type: 'SEND_MESSAGE', conversationId: msg.conversationId, body: msg.body })
        : await sendBridgeMessage({
            type: 'CREATE_CONVERSATION',
            recipientUrns: msg.recipientUrns,
            body: msg.body,
            // Queued as an InMail, so it still goes out as one (and spends a credit).
            ...(msg.inMailSubject !== undefined ? { inMail: { subject: msg.inMailSubject } } : {}),
          });
      if (res.success) {
        await save({ status: 'sent', sentAt: Date.now() });
        // Sent items don't linger in the queue anymore — they surface in the
        // connector's activity log instead.
        useUIStore.getState().pushMcpActivity(`Sent to ${msg.recipientName || 'Unknown'}`);
        showToast({ message: `Message sent to ${msg.recipientName}` });
      } else {
        await save({ status: 'failed', error: res.error || 'Send failed' });
        showToast({ message: res.error || 'Could not send message' });
      }
    } catch (e: any) {
      await save({ status: 'failed', error: e?.message || 'Send failed' });
      showToast({ message: e?.message || 'Could not send message' });
    } finally {
      setBusy(false);
    }
  };

  const applyReschedule = async () => {
    const at = when ? new Date(when).getTime() : NaN;
    if (!Number.isFinite(at)) return;
    await save({ status: 'scheduled', scheduledAt: at });
    setRescheduling(false);
    setWhen('');
  };

  const beginEdit = () => {
    setEditBody(msg.body);
    setEditSubject(msg.inMailSubject ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    const body = editBody.trim();
    if (!db || !body) return;
    const subject = editSubject.trim();
    await db.scheduledMessages.update(msg.id, {
      body,
      // Only on something already queued as an InMail; adding a subject here
      // would turn a free message into one that spends a credit.
      ...(msg.inMailSubject !== undefined ? { inMailSubject: subject } : {}),
      // What the user confirmed was a particular message. Changing it means
      // that approval no longer describes what would send — and auto-send may
      // act on it with nobody watching.
      ...(body !== msg.body || subject !== (msg.inMailSubject ?? '')
        ? { recipientConfirmedAt: undefined }
        : {}),
      updatedAt: Date.now(),
    });
    setEditing(false);
  };

  const remove = async () => {
    if (db) await db.scheduledMessages.delete(msg.id);
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${ready ? 'border-amber-500/30 bg-amber-500/5' : 'border-edge'}`}>
      <div className="mb-1 flex items-center gap-2">
        <GroupAvatar names={[msg.recipientName || 'Unknown']} pictures={['']} size={24} />
        <span className="truncate text-sm font-semibold text-fg-strong">{msg.recipientName || 'Unknown'}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badgeClass(msg.status, !!ready)}`}>
          {ready ? 'Ready to send' : statusLabel(msg.status)}
        </span>
        {msg.inMailSubject !== undefined && (
          <span
            title="Sends as a Premium InMail and uses one credit"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300"
          >
            InMail
          </span>
        )}
        {!ready && msg.status === 'scheduled' && msg.scheduledAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.scheduledAt), 'MMM d, h:mm a')}</span>
        )}
        {msg.status === 'sent' && msg.sentAt && (
          <span className="shrink-0 text-[11px] text-fg-faint">{format(new Date(msg.sentAt), 'MMM d, h:mm a')}</span>
        )}
      </div>

      {/* Editing happens here rather than in the composer: reopening there
          moved the draft into Primary as a fake conversation, dropped its
          Outbox row, and lost the InMail subject, which draftAttachments has
          nowhere to store. */}
      {editing ? (
        <div className="space-y-1.5">
          {msg.inMailSubject !== undefined && (
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              placeholder="InMail subject"
              aria-label="InMail subject"
              maxLength={200}
              className="w-full rounded-md bg-surface-input px-2 py-1 text-sm font-semibold text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
            />
          )}
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            aria-label="Message body"
            rows={Math.min(16, editBody.split('\n').length + 1)}
            className="w-full resize-y rounded-md bg-surface-input px-2 py-1.5 text-sm text-fg-secondary ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
          />
        </div>
      ) : (
        <>
          {/* An InMail's subject is part of what gets sent, so show it with the body. */}
          {!!msg.inMailSubject && (
            <p className="truncate text-sm font-semibold text-fg-strong">{msg.inMailSubject}</p>
          )}
          <p className="whitespace-pre-wrap text-sm text-fg-secondary">{msg.body}</p>
        </>
      )}
      {msg.status === 'failed' && msg.error && <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">{msg.error}</p>}

      {/* Checking the recipient is about the draft, not part of it: separated
          by a rule and set in the muted metadata scale so it cannot be read as
          another line of the message that would go out. */}
      {pending && claudeInMail && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2 text-[11px]">
          <span className="text-fg-faint">Sending to</span>
          {msg.profileUrl ? (
            <a
              href={msg.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-blue-700 underline underline-offset-2 hover:text-blue-600 dark:text-blue-300"
            >
              {msg.profileUrl.replace(/^https:\/\/(www\.)?linkedin\.com/, '')}
            </a>
          ) : (
            <span className="text-fg-faint">no profile link on this draft</span>
          )}
          {confirmRecipient && (
            // A checkbox, not a one-way button: confirming is a claim the user
            // might want to take back after opening the profile and finding
            // the wrong person — which is the whole reason the check exists.
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={!!msg.recipientConfirmedAt}
                onChange={(e) =>
                  db?.scheduledMessages.update(msg.id, {
                    recipientConfirmedAt: e.target.checked ? Date.now() : undefined,
                    updatedAt: Date.now(),
                  })
                }
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              <span
                className={
                  msg.recipientConfirmedAt
                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                    : 'font-medium text-amber-700 dark:text-amber-300'
                }
              >
                {msg.recipientConfirmedAt ? 'Recipient confirmed' : 'This is the right person'}
              </span>
            </label>
          )}
        </div>
      )}

      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                disabled={!editBody.trim()}
                className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
              >
                Save
              </button>
              <button onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary">
                Cancel
              </button>
            </>
          ) : rescheduling ? (
            <>
              <input
                type="datetime-local"
                value={when || (msg.scheduledAt ? toLocalInput(msg.scheduledAt) : '')}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md bg-surface-input px-2 py-1 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
              />
              <button onClick={applyReschedule} disabled={!when} className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300">
                Set time
              </button>
              <button onClick={() => setRescheduling(false)} className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={sendNow}
                disabled={busy || needsConfirm}
                title={needsConfirm ? 'Open the profile and confirm this is the right person first' : undefined}
                className="rounded-md bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25 disabled:opacity-40 dark:text-blue-300"
              >
                {busy ? 'Sending…' : msg.status === 'failed' ? 'Retry send' : 'Send now'}
              </button>
              {/* Also offered on a plain draft: a draft with no time is the
                  most likely thing to want one, and the picker already exists. */}
              <button
                onClick={() => setRescheduling(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {msg.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </button>
              <button onClick={beginEdit} className="rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge hover:text-fg-strong">
                Edit
              </button>
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-fg-secondary">Discard this draft?</span>
                  <button
                    onClick={remove}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-500/40 transition-colors hover:bg-red-500/10 dark:text-red-400"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  onClick={() => (confirmDelete ? setConfirmingDelete(true) : void remove())}
                  className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-red-500 dark:hover:text-red-400"
                >
                  {msg.status === 'scheduled' ? 'Cancel' : 'Delete'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
