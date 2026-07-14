// @vitest-environment jsdom
// Bug: at narrow window widths the thread pane layout collapsed —
//  1. The contact name in ThreadHeader was `shrink-0`, so instead of
//     truncating it overflowed into the header action buttons.
//  2. The header buttons had no `whitespace-nowrap`, so "Join WhatsApp Group"
//     wrapped onto three lines and the Archive group clipped off-screen.
//  3. MessageBubble's hover-action strip (quick reactions + reply + time) was
//     `opacity-0` but still in the flex flow, permanently reserving ~170px of
//     every row. Combined with `max-w-[70%]` that squeezed bubbles to ~150px
//     ("two words per line") in a narrow pane. Invisible buttons were also
//     still clickable (no pointer-events guard).
//
// Fix: the name truncates; secondary header buttons are nowrap and hide at
// narrow container widths; the hover strip is absolutely positioned beside
// the bubble (out of flow) with pointer-events disabled until hover.
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { render, screen } from '@testing-library/react';
import { ThreadHeader } from '@/components/thread/ThreadHeader';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeConversation, makeMessage } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_layout_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('regression #93: thread pane layout at narrow widths', () => {
  it('header name truncates instead of overflowing into the action buttons', () => {
    render(
      <ThreadHeader
        conversation={makeConversation({
          participantNames: ['Quinton Wall'],
          participantUrns: ['urn:li:fsd_profile:QW'],
        })}
      />
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.className).toContain('truncate');
    expect(heading.className).toContain('min-w-0');
    expect(heading.className).not.toContain('shrink-0');
  });

  it('header action buttons never wrap their labels', () => {
    render(
      <ThreadHeader
        conversation={makeConversation({
          participantNames: ['Quinton Wall'],
          participantUrns: ['urn:li:fsd_profile:QW'],
        })}
      />
    );
    const reportBug = screen.getByText('Report Bug').closest('button')!;
    expect(reportBug.className).toContain('whitespace-nowrap');
    // Secondary button collapses at narrow container widths instead of wrapping
    expect(reportBug.className).toContain('hidden');
    expect(reportBug.className).toContain('@[30rem]:flex');
  });

  it('bubble hover actions are overlaid, not reserving flex-row width', () => {
    const { container } = render(
      <MessageBubble
        message={makeMessage({ body: 'Hello there', isFromMe: false })}
      />
    );
    const actions = container.querySelector('[data-hover-actions]')!;
    expect(actions).toBeTruthy();
    // Out of flow: absolute, anchored beside the bubble
    expect(actions.className).toContain('absolute');
    expect(actions.className).toContain('left-full');
    // Invisible strip must not intercept clicks until hovered
    expect(actions.className).toContain('pointer-events-none');
    expect(actions.className).toContain('group-hover/msg:pointer-events-auto');
    // The strip must not be a direct flex child of the message row
    const row = container.querySelector('[data-message-id]')!;
    expect(actions.parentElement).not.toBe(row);
  });

  it('own-message hover actions anchor to the left of the bubble', () => {
    const { container } = render(
      <MessageBubble
        message={makeMessage({ body: 'My reply', isFromMe: true })}
      />
    );
    const actions = container.querySelector('[data-hover-actions]')!;
    expect(actions.className).toContain('right-full');
  });
});
