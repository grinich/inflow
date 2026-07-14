// @vitest-environment jsdom
// Feature: at very narrow window widths (< SIDEBAR_COLLAPSE_THRESHOLD) the
// conversation list collapses to a fixed-width avatar rail so the thread pane
// keeps usable width. Rail rows render only the avatar with unread/star
// badges and a name+preview tooltip; the search box, folder tabs, and footer
// are hidden. Keyboard navigation still works because the same rows (same
// data-conversation-id contract) are rendered, just compact.
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

import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationRow } from '@/components/conversations/ConversationRow';
import {
  useCollapsedSidebar,
  SIDEBAR_COLLAPSE_THRESHOLD,
} from '@/hooks/useCollapsedSidebar';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_rail_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

function setWindowWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

const rowProps = {
  selected: false,
  index: 0,
  onOpen: () => {},
  draftText: '',
  draftAttachmentCount: 0,
  hasFailed: false,
  company: 'Acme',
  companyLogoUrl: '',
  timeTick: 0,
};

describe('regression #94: avatar rail at narrow window widths', () => {
  it('useCollapsedSidebar flips with window width', () => {
    setWindowWidth(SIDEBAR_COLLAPSE_THRESHOLD + 100);
    const { result } = renderHook(() => useCollapsedSidebar());
    expect(result.current).toBe(false);

    act(() => setWindowWidth(SIDEBAR_COLLAPSE_THRESHOLD - 100));
    expect(result.current).toBe(true);

    act(() => setWindowWidth(SIDEBAR_COLLAPSE_THRESHOLD + 100));
    expect(result.current).toBe(false);
  });

  it('compact row shows avatar + tooltip only — no name, preview, or timestamp text', () => {
    const conv = makeConversation({
      participantNames: ['Quinton Wall'],
      lastMessage: 'Good luck on the mcp night',
      read: 1,
    });
    const { container } = render(<ConversationRow conversation={conv} {...rowProps} compact />);

    const row = container.querySelector('[data-conversation-id]')!;
    expect(row).toBeTruthy();
    expect(row.getAttribute('title')).toBe('Quinton Wall — Good luck on the mcp night');
    // Avatar initial renders; name/preview/company do NOT render as text
    expect(row.textContent).not.toContain('Quinton Wall');
    expect(row.textContent).not.toContain('Good luck');
    expect(row.textContent).not.toContain('Acme');
  });

  it('compact row badges: unread dot and star', () => {
    const conv = makeConversation({ read: 0, starred: 1 });
    const { container } = render(<ConversationRow conversation={conv} {...rowProps} compact />);
    expect(container.querySelector('.bg-blue-500')).toBeTruthy(); // unread dot
    expect(container.querySelector('.text-yellow-400')).toBeTruthy(); // star badge

    const readConv = makeConversation({ read: 1, starred: 0 });
    const { container: c2 } = render(<ConversationRow conversation={readConv} {...rowProps} compact />);
    expect(c2.querySelector('.bg-blue-500')).toBeFalsy();
    expect(c2.querySelector('.text-yellow-400')).toBeFalsy();
  });

  it('compact list hides search/tabs/footer but keeps rows and compose', () => {
    const conversations = [
      makeConversation({ id: 'c1', participantNames: ['Alice A'] }),
      makeConversation({ id: 'c2', participantNames: ['Bob B'] }),
    ];
    const { container } = render(
      <ConversationList conversations={conversations} category="PRIMARY_INBOX" compact />
    );

    expect(container.querySelector('[data-search-input]')).toBeFalsy();
    expect(screen.queryByText('Keyboard Shortcuts')).toBeFalsy();
    expect(screen.queryByText('Focused')).toBeFalsy();
    expect(screen.getByTitle('New message (C)')).toBeTruthy();
    expect(container.querySelectorAll('[data-conversation-id]').length).toBe(2);
  });

  it('full (non-compact) list still renders the search input and footer', () => {
    const { container } = render(
      <ConversationList conversations={[makeConversation()]} category="PRIMARY_INBOX" />
    );
    expect(container.querySelector('[data-search-input]')).toBeTruthy();
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
  });
});
