import { useCallback } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import type { Invitation, Connection } from '@/types/network';
import type { Conversation } from '@/types/conversation';

export function useNetworkActions() {
  const showToast = useUIStore((s) => s.showToast);

  const respond = useCallback(
    async (inv: Invitation, action: 'accept' | 'ignore') => {
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
    const existing = convs.find(
      (c) =>
        c.draft !== 1 &&
        c.participantUrns.length <= 2 &&
        c.participantUrns.includes(conn.profileUrn)
    );
    store.setAppView('inbox');
    store.setInboxTab('focused');
    if (existing) {
      store.openThread(existing.id, 0);
      return;
    }
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
