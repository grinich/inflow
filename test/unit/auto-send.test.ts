/**
 * Auto-send is the only place inflow acts on the LinkedIn account with nobody
 * watching, so what it REFUSES to send matters more than what it sends.
 */
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';

const createConversation = vi.fn(async () => ({ conversationId: 'c-new' }));
const sendMessage = vi.fn(async () => undefined);
vi.mock('@/../entrypoints/background/api/messages', () => ({
  createConversation: (...a: any[]) => createConversation(...a),
  sendMessage: (...a: any[]) => sendMessage(...a),
}));

let settings: Record<string, any> = {};
vi.mock('@/lib/send-settings', () => ({
  getAutoSendScheduled: async () => settings.autoSend === true,
  getConfirmRecipient: async () => settings.confirm !== false,
}));

import { runAutoSendTick } from '@/../entrypoints/background/auto-send';

const NOW = 1_000_000;

function queued(over: any = {}) {
  return {
    id: 'm' + Math.random().toString(36).slice(2),
    recipientUrns: ['urn:li:fsd_profile:DANA'],
    recipientName: 'Dana Whitfield',
    body: 'Hello',
    status: 'scheduled' as const,
    scheduledAt: NOW - 1000,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  await switchDatabase('auto-send-' + Math.random().toString(36).slice(2));
  await db!.scheduledMessages.clear();
  createConversation.mockClear();
  sendMessage.mockClear();
  settings = { autoSend: true, confirm: true };
});

it('does nothing at all while auto-send is off', async () => {
  settings.autoSend = false;
  await db!.scheduledMessages.add(queued() as any);

  await runAutoSendTick(NOW);

  expect(createConversation).not.toHaveBeenCalled();
  expect((await db!.scheduledMessages.toArray())[0].status).toBe('scheduled');
});

it('sends a due scheduled message and marks it sent', async () => {
  await db!.scheduledMessages.add(queued({ id: 'due' }) as any);

  await runAutoSendTick(NOW);

  expect(createConversation).toHaveBeenCalledOnce();
  const row = await db!.scheduledMessages.get('due');
  expect(row!.status).toBe('sent');
  expect(row!.sentAt).toBeGreaterThan(0);
});

it('leaves a message whose time has not come', async () => {
  await db!.scheduledMessages.add(queued({ id: 'later', scheduledAt: NOW + 60_000 }) as any);
  await runAutoSendTick(NOW);
  expect(createConversation).not.toHaveBeenCalled();
  expect((await db!.scheduledMessages.get('later'))!.status).toBe('scheduled');
});

it('never sends a plain draft, only something the user scheduled', async () => {
  await db!.scheduledMessages.add(queued({ id: 'draft', status: 'draft', scheduledAt: undefined }) as any);
  await runAutoSendTick(NOW);
  expect(createConversation).not.toHaveBeenCalled();
});

it('holds back a Claude InMail the user has not confirmed', async () => {
  // The whole point: the background must not fire past a gate the Outbox is
  // still showing. Unattended sending to the wrong person is unrecoverable.
  await db!.scheduledMessages.add(
    queued({ id: 'unconfirmed', source: 'mcp', inMailSubject: 'Hi' }) as any,
  );

  await runAutoSendTick(NOW);

  expect(createConversation).not.toHaveBeenCalled();
  expect((await db!.scheduledMessages.get('unconfirmed'))!.status).toBe('scheduled');
});

it('sends that same InMail once the user has confirmed the recipient', async () => {
  await db!.scheduledMessages.add(
    queued({ id: 'ok', source: 'mcp', inMailSubject: 'Hi', recipientConfirmedAt: 5 }) as any,
  );

  await runAutoSendTick(NOW);

  expect(createConversation).toHaveBeenCalledOnce();
  // Still goes out as an InMail, spending the credit it was queued to spend.
  expect(createConversation.mock.calls[0][3]).toEqual({ subject: 'Hi' });
  expect((await db!.scheduledMessages.get('ok'))!.status).toBe('sent');
});

it('sends an unconfirmed InMail when the user turned the check off', async () => {
  settings.confirm = false;
  await db!.scheduledMessages.add(queued({ id: 'nogate', source: 'mcp', inMailSubject: 'Hi' }) as any);

  await runAutoSendTick(NOW);

  expect(createConversation).toHaveBeenCalledOnce();
});

it('replies into an existing thread rather than starting a new one', async () => {
  await db!.scheduledMessages.add(queued({ id: 'reply', conversationId: 'conv-1' }) as any);
  await runAutoSendTick(NOW);
  expect(sendMessage).toHaveBeenCalledWith('conv-1', 'Hello');
  expect(createConversation).not.toHaveBeenCalled();
});

it('marks a failure failed, so it cannot retry unattended in a loop', async () => {
  createConversation.mockRejectedValueOnce(new Error('LinkedIn said no'));
  await db!.scheduledMessages.add(queued({ id: 'bad' }) as any);

  await runAutoSendTick(NOW);

  const row = await db!.scheduledMessages.get('bad');
  expect(row!.status).toBe('failed');
  expect(row!.error).toMatch(/LinkedIn said no/);

  // A second tick must not pick it up again.
  await runAutoSendTick(NOW);
  expect(createConversation).toHaveBeenCalledOnce();
});

it('sends a message whose time passed while Chrome was quit', async () => {
  // No alarm fires while the browser is closed, so the first tick after it
  // starts again finds an overdue message. It goes out then, late, rather
  // than being skipped — the user asked for it to send.
  await db!.scheduledMessages.add(queued({ id: 'overdue', scheduledAt: NOW - 6 * 3600_000 }) as any);

  await runAutoSendTick(NOW);

  expect(createConversation).toHaveBeenCalledOnce();
  expect((await db!.scheduledMessages.get('overdue'))!.status).toBe('sent');
});
