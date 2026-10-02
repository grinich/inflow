import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InboxData } from '../src/contracts.js';
import { inboxPageRequest, reconcileInboxPage } from '../views/inbox/inbox-pages.js';

function page(start: number, count: number, total = 200): InboxData {
  return {
    connected: true,
    message: 'Connected',
    pairingUrl: null,
    state: 'inbox',
    widgetSessionId: '7117a2c2-1a37-44e3-818c-f5f46a0788f2',
    tab: 'focused',
    query: '',
    total,
    nextOffset: start + count < total ? start + count : null,
    conversations: Array.from({ length: count }, (_, index) => {
      const id = start + index;
      return {
        id: String(id),
        participants: [`Person ${id}`],
        lastMessage: 'Hello',
        lastActivityAt: new Date(Date.UTC(2026, 0, 1) - id * 1000).toISOString(),
        unread: false,
        starred: false,
        archived: false,
        category: 'focused',
        hasAttachments: false,
      };
    }),
  };
}

test('loading a second page survives polling and leaves an unsubmitted search intact', () => {
  const first = page(0, 30);
  const loaded = reconcileInboxPage(first, page(30, 30), 'unsubmitted search', {
    source: 'append',
  });
  const request = inboxPageRequest(loaded.data, first, false);
  assert.deepEqual(request, { offset: 0, limit: 60 });
  const refreshed = page(0, request.limit);
  refreshed.conversations[0].lastMessage = 'Updated message';
  const result = reconcileInboxPage(loaded.data, refreshed, loaded.queryDraft, {
    source: 'refresh',
  });
  assert.equal(result.data.conversations.length, 60);
  assert.equal(result.data.conversations[59].id, '59');
  assert.equal(result.data.conversations[0].lastMessage, 'Updated message');
  assert.equal(result.data.nextOffset, 60);
  assert.equal(result.queryDraft, 'unsubmitted search');
});

test('large lists use one bounded refresh and retain rows displaced by a new arrival', () => {
  const previous = page(0, 120);
  assert.deepEqual(inboxPageRequest(previous, previous, false), { offset: 0, limit: 100 });
  const fresh = page(-1, 100, 201);
  fresh.nextOffset = 100;
  const result = reconcileInboxPage(previous, fresh, '', { source: 'refresh' });
  assert.equal(result.data.conversations.length, 121);
  assert.equal(result.data.conversations[100].id, '99');
  assert.equal(result.data.conversations[120].id, '119');
  assert.equal(result.data.nextOffset, 121);
  assert.deepEqual(inboxPageRequest(result.data, result.data, true), { offset: 121, limit: 30 });
});

test('refresh removes missing rows within the refreshed window and keeps exhaustion', () => {
  const previous = page(0, 120, 120);
  const fresh = page(0, 101, 119);
  fresh.conversations = fresh.conversations.filter((row) => row.id !== '10');
  fresh.nextOffset = 100;
  const result = reconcileInboxPage(previous, fresh, '', { source: 'refresh' });
  assert.equal(
    result.data.conversations.some((row) => row.id === '10'),
    false,
  );
  assert.equal(result.data.conversations.length, 119);
  assert.equal(result.data.nextOffset, null);
});

test('explicit host navigation applies its query and resets the loaded window', () => {
  const previous = page(0, 120);
  const fresh = { ...page(0, 2, 2), query: 'new search', tab: 'other' as const };
  const result = reconcileInboxPage(previous, fresh, 'unfinished typing', { source: 'host' });
  assert.equal(result.queryDraft, 'new search');
  assert.deepEqual(result.data, fresh);
  assert.deepEqual(inboxPageRequest(previous, fresh, false), { offset: 0, limit: 30 });
});

test('a completed refreshed list drops stale cached rows', () => {
  const result = reconcileInboxPage(page(0, 120), page(0, 10, 10), 'draft', { source: 'refresh' });
  assert.equal(result.data.conversations.length, 10);
  assert.equal(result.data.nextOffset, null);
  assert.equal(result.queryDraft, 'draft');
});
