import { useCallback } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { useUIStore, type InboxTab } from '@/store/ui-store';
import { navigateToConversation } from '@/lib/navigate-to-conversation';
import type { Invitation, SentInvitation, Connection } from '@/types/network';
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

/** The most recent real 1:1 thread with this person, if we have one. */
async function findThread(profileUrn: string) {
  const convs = await db.conversations.toArray();
  // Strictly 1:1 — `participantUrns` excludes the viewer, so a group thread
  // containing this person has length >= 2. Matching loosely could drop the
  // message into a group and send it to an extra recipient.
  return convs
    .filter((c) => c.draft !== 1 && c.participantUrns.length === 1 && c.participantUrns[0] === profileUrn)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
}

/**
 * Put the cursor in the reply box once the thread pane has mounted.
 *
 * Time-boxed rather than counted in frames: the pane appears only after a live
 * query notices the conversation and React commits, which is a database round
 * trip away — twenty frames came and went long before that, so the focus was
 * silently dropped.
 */
function focusComposer(budgetMs = 3000): void {
  useUIStore.getState().setComposeActive(true);
  const deadline = Date.now() + budgetMs;
  const tick = () => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-compose-input]');
    if (el) { el.focus(); return; }
    if (Date.now() < deadline) setTimeout(tick, 50);
  };
  tick();
}

export function useNetworkActions() {
  const showToast = useUIStore((s) => s.showToast);

  const respond = useCallback(
    async (inv: Invitation, action: 'accept' | 'ignore'): Promise<boolean> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast({ message: `You're offline — can't respond to invitations right now` });
        return false;
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
        return false;
      }
      showToast({ message: action === 'accept' ? `Connected with ${inv.name}` : `Ignored ${inv.name}'s invitation` });
      return true;
    },
    [showToast]
  );

  /**
   * Accepting an invitation that came with a note drops you into the reply.
   *
   * The note IS the first message of the thread LinkedIn creates on accept, so
   * the natural next act is answering it — and the thread is nowhere near the
   * network view. Only when there is a note: accepting a bare request leaves
   * you on the list to keep triaging.
   */
  const acceptInvitation = useCallback(
    async (inv: Invitation) => {
      if (!inv.message) {
        await respond(inv, 'accept');
        return;
      }
      // Move first. Accepting is a network round trip to LinkedIn, and waiting
      // on it before switching is the pause the user feels — the optimistic
      // update has already taken the row out of the list by now anyway.
      const placeholderId = await beginJump(inv);
      const accepted = await respond(inv, 'accept');
      if (!accepted) {
        // Put them back where they were; respond() has already restored the row.
        await db.conversations.delete(placeholderId).catch(() => {});
        useUIStore.getState().setAppView('network');
        return;
      }
      await settleJump(inv, placeholderId);
    },
    [respond]
  );

  /** Withdraw a request I sent. Optimistic, with the same revert-on-failure. */
  const withdrawInvitation = useCallback(
    async (inv: SentInvitation) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast({ message: `You're offline — can't withdraw invitations right now` });
        return;
      }
      await db.sentInvitations.update(inv.id, { status: 'withdrawn' });
      const res = await sendBridgeMessage({
        type: 'WITHDRAW_INVITATION',
        invitationId: inv.id,
      }).catch((err) => ({ success: false, error: String(err) }));
      if (!res.success) {
        await db.sentInvitations.update(inv.id, { status: 'pending' }); // revert
        showToast({ message: `Couldn't withdraw your invitation to ${inv.name}` });
        return;
      }
      showToast({ message: `Withdrew your invitation to ${inv.name}` });
    },
    [showToast]
  );
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

  /**
   * Show the thread with this person and focus the reply box.
   *
   * Accepting is what creates the thread, so it is usually not synced yet —
   * ask for a discovery pass and watch the table for it rather than guessing a
   * delay. If it never lands, fall through to a draft so the reply can still
   * be typed and sent; the send reuses the real thread.
   */
  /**
   * Show something for this person at once, and return the placeholder's id.
   *
   * If the real thread is already here, that is what opens. Otherwise a draft
   * stands in — same person, same header, a reply box to type into — so the
   * switch is instant rather than a pause on the network list.
   */
  const beginJump = useCallback(async (inv: Invitation): Promise<string> => {
    // Both paths leave the network view. navigateToConversation picks the
    // right inbox tab but knows nothing about the top-level view.
    useUIStore.getState().setAppView('inbox');

    const existing = await findThread(inv.fromUrn);
    if (existing) {
      await navigateToConversation(existing.id);
      focusComposer();
      return existing.id;
    }

    const memberId = inv.fromUrn.split(':').pop()!;
    const placeholderId = `draft-${memberId}`;
    await db.conversations.put({
      id: placeholderId,
      participantUrns: [inv.fromUrn],
      participantNames: [inv.name],
      participantPictures: [inv.pictureUrl],
      lastMessage: '',
      lastActivityAt: Date.now(),
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      draft: 1,
    } as Conversation);
    const store = useUIStore.getState();
    store.setInboxTab('focused');
    // setInboxTab remembers the selection that tab had and App's auto-select
    // effect restores it a tick later, which would take the selection straight
    // back off the placeholder — and then nothing would ever select the
    // accepted thread. navigateToConversation clears this for the same reason.
    useUIStore.setState({ _pendingRestore: null });
    store.openThread(placeholderId, 0);
    focusComposer();
    return placeholderId;
  }, []);

  /** Wait for the thread the accept created, then put them in it. */
  const settleJump = useCallback(async (inv: Invitation, placeholderId: string) => {
    if (placeholderId !== `draft-${inv.fromUrn.split(':').pop()}`) return; // already real

    sendBridgeMessage({ type: 'BURST_DISCOVER', category: 'PRIMARY_INBOX' }).catch(() => {});
    const deadline = Date.now() + 15_000;
    let real = await findThread(inv.fromUrn);
    while (!real && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      // Only leaving the inbox counts as moving on. Selection alone does not:
      // the auto-select effect reassigns it for its own reasons, and treating
      // that as intent is what left the accepted thread unselected.
      if (useUIStore.getState().appView !== 'inbox') return;
      real = await findThread(inv.fromUrn);
    }
    if (!real) return;

    // Carry anything typed while waiting, reading it off the textarea rather
    // than out of the database. The composer only autosaves once a second, so
    // the stored row is up to a second behind — and swapping the conversation
    // out from under it clears the box, which made those keystrokes look lost
    // even though a later save put them back.
    const live = document.querySelector<HTMLTextAreaElement>('[data-compose-input]')?.value ?? '';
    const stored = await db.draftAttachments.get(placeholderId).catch(() => undefined);
    const text = live || stored?.text || '';
    if (text || stored?.files?.length) {
      await db.draftAttachments.put({
        conversationId: real.id,
        text: text || undefined,
        files: stored?.files ?? [],
        names: stored?.names ?? [],
        types: stored?.types ?? [],
      });
    }
    await db.draftAttachments.delete(placeholderId).catch(() => {});

    await navigateToConversation(real.id);
    focusComposer();
    await db.conversations.delete(placeholderId);
  }, []);

  const openProfile = useCallback((target: { publicId: string; profileUrn?: string }) => {
    if (target.publicId) {
      window.open(`https://www.linkedin.com/in/${target.publicId}/`, '_blank');
    }
  }, []);

  return { acceptInvitation, ignoreInvitation, withdrawInvitation, messageConnection, openProfile };
}
