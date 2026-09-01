/**
 * An account that turned LinkedIn's Focused/Other split off sees ONE inbox
 * over there, so inflow must show one too.
 *
 * The thing that makes this safe: LinkedIn keeps categorising conversations
 * either way — a SECONDARY_INBOX query still returns rows with the setting off
 * — so sync is untouched and nothing is lost. Only the presentation changes.
 * The failure this guards against is the opposite: showing a Focused tab that
 * silently hides everything LinkedIn filed as Other, on an account that asked
 * for no such split.
 */
import Dexie from 'dexie';
import { applySchema, type InflowDatabase } from '@/db/database';
import { queryTabConversations } from '@/lib/conversation-query';
import { belongsToTab, countUnreadFocused, isFocusedConversation } from '@/lib/inbox-filters';
import { visibleTabs } from '@/components/conversations/ConversationListHeader';
import { moveTargetLabel, otherSlotApplies } from '@/lib/conversation-move';
import { FOCUSED_INBOX_KEY, getFocusedInboxEnabled } from '@/lib/focused-inbox';
import { useUIStore } from '@/store/ui-store';
import { makeConversation, resetFactories } from '../fixtures/factories';
import { setLocalStore } from '../mocks/chrome';

let db: InflowDatabase;

beforeEach(async () => {
  resetFactories();
  db = new Dexie(`TestDB_focused_${Date.now()}_${Math.random()}`) as InflowDatabase;
  applySchema(db);
  await db.open();
  await db.conversations.bulkPut([
    makeConversation({ id: 'primary', category: 'PRIMARY_INBOX', archived: 0, read: 0 }),
    makeConversation({ id: 'secondary', category: 'SECONDARY_INBOX', archived: 0, read: 0 }),
    makeConversation({ id: 'archived', category: 'ARCHIVE', archived: 1, read: 0 }),
    makeConversation({ id: 'spam', category: 'SPAM', archived: 0, read: 0 }),
  ]);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('the stored setting', () => {
  it('defaults to the split being ON — the safe direction', async () => {
    // Unknown must not collapse the inbox: a redundant Other tab is cosmetic,
    // a hidden one loses conversations from view.
    expect(await getFocusedInboxEnabled()).toBe(true);
  });

  it('is off only when explicitly stored false', async () => {
    setLocalStore(FOCUSED_INBOX_KEY, false);
    expect(await getFocusedInboxEnabled()).toBe(false);
    setLocalStore(FOCUSED_INBOX_KEY, 'nonsense');
    expect(await getFocusedInboxEnabled()).toBe(true);
  });
});

describe('with the split ON (LinkedIn default)', () => {
  it('keeps Focused and Other apart', async () => {
    const focused = await queryTabConversations(db, 'focused');
    expect(focused.map((c) => c.id)).toEqual(['primary']);
    const other = await queryTabConversations(db, 'other');
    expect(other.map((c) => c.id)).toEqual(['secondary']);
  });

  it('counts only the focused half in the badge', async () => {
    expect(await countUnreadFocused(db)).toBe(1);
  });

  it('shows all four tabs', () => {
    expect(visibleTabs(true).map((t) => t.label)).toEqual([
      'Focused', 'Other', 'Archive', 'Spam',
    ]);
  });
});

describe('with the split OFF', () => {
  it('folds Other into one inbox, still excluding archive and spam', async () => {
    const inbox = await queryTabConversations(db, 'focused', { combineInbox: true });
    expect(inbox.map((c) => c.id).sort()).toEqual(['primary', 'secondary']);
  });

  it('counts every unread in that one inbox', async () => {
    // The bug this pins: an unread Other conversation not reaching the badge
    // on an account with no Other tab to find it in.
    expect(await countUnreadFocused(db, true)).toBe(2);
  });

  it('drops the Other tab and calls the first one Inbox', () => {
    const tabs = visibleTabs(false);
    expect(tabs.map((t) => t.label)).toEqual(['Inbox', 'Archive', 'Spam']);
    // Archive stays 3 and Spam stays 4 — the keys must not shift under
    // anyone's fingers just because a LinkedIn setting changed.
    expect(tabs.map((t) => t.key)).toEqual(['1', '3', '4']);
  });

  it('treats a secondary conversation as belonging to the inbox', () => {
    const secondary = { archived: 0, category: 'SECONDARY_INBOX' };
    expect(belongsToTab(secondary, 'focused')).toBe(false);
    expect(belongsToTab(secondary, 'focused', true)).toBe(true);
    // Archive and spam are still their own places.
    expect(belongsToTab({ archived: 1, category: 'ARCHIVE' }, 'focused', true)).toBe(false);
    expect(belongsToTab({ archived: 0, category: 'SPAM' }, 'focused', true)).toBe(false);
  });

  it('still excludes drafts from the unread count', () => {
    expect(isFocusedConversation({ archived: 0, category: 'SECONDARY_INBOX', draft: 1 }, true))
      .toBe(false);
  });
});

describe('reaching a tab that no longer exists', () => {
  beforeEach(() => {
    useUIStore.setState({ inboxTab: 'focused', focusedInboxEnabled: true });
  });

  it('refuses the Other tab once the split is off', () => {
    const store = useUIStore.getState();
    store.setFocusedInboxEnabled(false);
    // The `2` key, the command palette and a restored #/inbox/other route all
    // funnel through setInboxTab — guarding there covers every one of them,
    // including whatever gets added next.
    useUIStore.getState().setInboxTab('other');
    expect(useUIStore.getState().inboxTab).toBe('focused');
  });

  it('moves off Other when the split is turned off while sitting there', () => {
    useUIStore.getState().setInboxTab('other');
    expect(useUIStore.getState().inboxTab).toBe('other');
    // Otherwise the user is stranded: the dropdown no longer lists the tab
    // they are on, so there is no way back.
    useUIStore.getState().setFocusedInboxEnabled(false);
    expect(useUIStore.getState().inboxTab).toBe('focused');
  });

  it('still allows Other while the split is on', () => {
    useUIStore.getState().setInboxTab('other');
    expect(useUIStore.getState().inboxTab).toBe('other');
  });
});

describe('the Move to Other slot', () => {
  const inInbox = { category: 'PRIMARY_INBOX' };
  const inOther = { category: 'SECONDARY_INBOX' };
  const inSpam = { category: 'SPAM' };

  it('is offered everywhere while the split is on', () => {
    for (const [conv, tab] of [
      [inInbox, 'focused'], [inOther, 'other'], [inSpam, 'spam'], [inInbox, 'archived'],
    ] as const) {
      expect(otherSlotApplies(conv, tab)).toBe(true);
    }
    expect(moveTargetLabel('other')).toBe('Move to Other');
    expect(moveTargetLabel('focused')).toBe('Move to Focused');
  });

  it('disappears from the inbox when the split is off — the move is invisible', () => {
    // Both halves are the same list, so shuffling between them does nothing
    // the user can see.
    expect(otherSlotApplies(inInbox, 'focused', true)).toBe(false);
    expect(otherSlotApplies(inOther, 'focused', true)).toBe(false);
  });

  it('stays where it still does something: out of Archive, and out of Spam', () => {
    // In Archive it is one of the two ways back out, alongside E.
    expect(otherSlotApplies(inInbox, 'archived', true)).toBe(true);
    // In Spam it is "not spam" — losing it would strand conversations there.
    expect(otherSlotApplies(inSpam, 'spam', true)).toBe(true);
  });

  it('names the one inbox rather than a half the user cannot see', () => {
    expect(moveTargetLabel('other', true)).toBe('Move to Inbox');
    expect(moveTargetLabel('focused', true)).toBe('Move to Inbox');
  });
});
