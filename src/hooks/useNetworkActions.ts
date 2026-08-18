import { useCallback } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { useUIStore, type InboxTab } from '@/store/ui-store';
import type { Invitation, Connection } from '@/types/network';
import type { Conversation } from '@/types/conversation';

/**
 * Which inbox folder a conversation is visible in — mirrors the per-tab queries
 * in useConversations. Opening a thread while the wrong tab is active leaves it
 * out of `conversations`, and App's selection reconciliation then swaps it for
 * whatever the active folder holds.
 */
function tabForConversation(c: Pick<Conversation, 'archived' | 'category'>): InboxTab {
  if (c.archived === 1) return 'archived';
  if (c.category === 'SPAM') return 'spam';
  if (c.category === 'SECONDARY_INBOX') return 'other';
  return 'focused';
}

export function useNetworkActions() {
  const showToast = useUIStore((s) => s.showToast);

  const respond = useCallback(
    async (inv: Invitation, action: 'accept' | 'ignore') => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast({ message: `You're offline — can't respond to invitations right now` });
        return;
      }
      const newStatus = action === 'accept' ? 'accepted' : 'ignored';
      // Optimistic — row leaves the pending list immediately
      await db.invitations.update(inv.id, { status: newStatus });
      const res = await sendBridgeMessage({
        type: action === 'accept' ? 'ACCEPT_INVITATION' : 'IGNORE_INVITATION',
        invitationId: inv.id,
      }).catch((err) => ({ success: false, error: String(err) }));
      if (!res.success) {
        await db.invitations.update(inv.id, { status: 'pending' }); // revert
        showToast({ message: `Couldn't ${action} ${inv.name}'s invitation` });
        return;
      }
      showToast({ message: action === 'accept' ? `Connected with ${inv.name}` : `Ignored ${inv.name}'s invitation` });
    },
    [showToast]
  );

  const acceptInvitation = useCallback((inv: Invitation) => respond(inv, 'accept'), [respond]);
  const ignoreInvitation = useCallback((inv: Invitation) => respond(inv, 'ignore'), [respond]);

  /**
   * Open a compose flow for a connection: jump to an existing 1:1 conversation
   * if we have one locally, otherwise create a draft conversation (the same
   * `draft-<memberId>` pattern NewMessageComposer uses) and open the composer.
   */
  const messageConnection = useCallback(async (conn: Connection) => {
    const store = useUIStore.getState();
    const convs = await db.conversations.toArray();
    // Strictly 1:1 — `participantUrns` excludes the viewer, so a group thread
    // containing this person has length >= 2. Matching loosely could drop the
    // message into a group and send it to an extra recipient.
    // Of the duplicate 1:1 threads LinkedIn can create for one person, take the
    // most recent: that's the one useConversations keeps when it merges them.
    const existing = convs
      .filter((c) => c.draft !== 1 && c.participantUrns.length === 1 && c.participantUrns[0] === conn.profileUrn)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    store.setAppView('inbox');
    if (existing) {
      store.setInboxTab(tabForConversation(existing)); // before openThread — a tab switch restores that tab's own selection
      store.openThread(existing.id, 0);
      return;
    }
    store.setInboxTab('focused');
    const memberId = conn.profileUrn.split(':').pop()!;
    const draftConv: Conversation = {
      id: `draft-${memberId}`,
      participantUrns: [conn.profileUrn],
      participantNames: [conn.name],
      participantPictures: [conn.pictureUrl],
      lastMessage: '',
      lastActivityAt: Date.now(),
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      draft: 1,
    };
    await db.conversations.put(draftConv);
    store.setSelectedConversationId(draftConv.id);
    store.setComposeNewActive(true);
  }, []);

  const openProfile = useCallback((target: { publicId: string; profileUrn?: string }) => {
    if (target.publicId) {
      window.open(`https://www.linkedin.com/in/${target.publicId}/`, '_blank');
    }
  }, []);

  return { acceptInvitation, ignoreInvitation, messageConnection, openProfile };
}
