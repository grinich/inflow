import { useCallback } from 'react';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { useUIStore, type InboxTab } from '@/store/ui-store';
import { navigateToConversation } from '@/lib/navigate-to-conversation';
import type { Invitation, SentInvitation, Connection } from '@/types/network';
import type { Conversation } from '@/types/conversation';
import { DRAFT_HANDOVER } from '@/lib/draft-handover';

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

/**
 * The most recent real 1:1 thread with this person, if we have one.
 *
 * Indexed on participantUrns rather than scanning: the accept flow calls this
 * every 400ms while it waits for a new thread to sync, and loading every
 * conversation each time is fine at fifty and ruinous at several thousand.
 * The multiEntry index narrows it to the handful of threads this person is in.
 */
async function findThread(profileUrn: string) {
  const withPerson = await db.conversations
    .where('participantUrns')
    .equals(profileUrn)
    .toArray();
  // Strictly 1:1 — `participantUrns` excludes the viewer, so a group thread
  // containing this person has length >= 2. Matching loosely could drop the
  // message into a group and send it to an extra recipient.
  return withPerson
    .filter((c) => c.draft !== 1 && c.participantUrns.length === 1)
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
function focusComposer(conversationId: string): void {
  // The composer claims the cursor itself as soon as it mounts for this
  // conversation — see ComposeBox. Polling the DOM for one from out here left
  // a window where the box existed unfocused, and focused whichever composer
  // was mounted rather than the one we jumped to.
  useUIStore.getState().requestComposerFocus(conversationId);
}

/** What is typed in a given conversation's reply box right now, if it is open. */
function liveComposerText(conversationId: string): string {
  const box = document.querySelector<HTMLTextAreaElement>(
    `[data-compose-input="${CSS.escape(conversationId)}"]`
  );
  return box?.value ?? '';
}

/**
 * Wait (briefly) for the composer to be showing this conversation.
 *
 * Until the swap has actually rendered, the composer is still bound to the
 * placeholder and will flush what it holds to it on the way out — so deleting
 * the placeholder's draft before that point just means it comes back.
 */
async function composerSettledOn(conversationId: string, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (document.querySelector(`[data-compose-input="${CSS.escape(conversationId)}"]`)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Make sure the reply ends up on the real thread, however the pieces land.
 *
 * The departing composer flushes what is typed as it goes (see ComposeBox) and
 * that flush is normally redirected here. But it is a separate write from a
 * separate component, and assuming it has already happened is what left a
 * reply stranded on a placeholder row that had just been deleted — an empty
 * box on screen, the text nowhere the user could see it. So watch for
 * anything left behind rather than checking once, and if it turns up after
 * the composer has already rendered empty, tell it to pick it up.
 */
async function handOverDraft(
  fromId: string,
  toId: string,
  /** The box's contents when the swap began. */
  snapshot: string,
  /** What was stored against `fromId` at that same moment. */
  storedBefore: string,
  budgetMs = 2500
): Promise<void> {
  const get = (id: string) => db.draftAttachments.get(id).catch(() => undefined);
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const [dest, left] = await Promise.all([get(toId), get(fromId)]);
    if (dest?.text || dest?.files?.length) {
      // Already here — the flush was redirected as intended.
      if (left) await db.draftAttachments.delete(fromId).catch(() => {});
      return;
    }
    // Which of the two is newer. The stored row changing since the swap began
    // means the composer flushed on its way out, and that flush is by
    // definition the last thing typed; an unchanged row is just its periodic
    // save, up to a second behind the box we sampled.
    const flushed = left?.text !== undefined && left.text !== storedBefore;
    const text = flushed ? left!.text : snapshot || left?.text;
    if (text || left?.files?.length) {
      await db.draftAttachments.put({
        conversationId: toId,
        text: text || undefined,
        files: left?.files ?? [],
        names: left?.names ?? [],
        types: left?.types ?? [],
      });
      await db.draftAttachments.delete(fromId).catch(() => {});
      // The composer may already be up and empty; it will not re-read on its own.
      document.dispatchEvent(new CustomEvent(DRAFT_HANDOVER, { detail: toId }));
      return;
    }
    if (Date.now() >= deadline) {
      await db.draftAttachments.delete(fromId).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Only the newest jump may steer.
 *
 * Accepting a second invitation while the first is still watching for its
 * thread left two watchers running, and whichever resolved last yanked the
 * user to its own thread — potentially the one they had moved on from.
 */
let jumpToken = 0;

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
      const token = ++jumpToken;
      const opened = await beginJump(inv);
      const accepted = await respond(inv, 'accept');
      if (!accepted) {
        // Put them back where they were; respond() has already restored the
        // row. Only clean up a stand-in WE made — beginJump returns the real
        // conversation's id when one already existed, and deleting that would
        // destroy a thread the user actually has.
        if (opened.placeholder) await db.conversations.delete(opened.id).catch(() => {});
        useUIStore.getState().setAppView('network');
        return;
      }
      if (opened.placeholder) await settleJump(inv, opened.id, token);
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
    // Same rule as the accept flow, and the same indexed lookup: strictly 1:1,
    // most recent of any duplicate threads LinkedIn kept for one person —
    // which is the one useConversations shows once it merges them.
    const existing = await findThread(conn.profileUrn);
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
  const beginJump = useCallback(async (inv: Invitation): Promise<{ id: string; placeholder: boolean }> => {
    // Both paths leave the network view. navigateToConversation picks the
    // right inbox tab but knows nothing about the top-level view.
    useUIStore.getState().setAppView('inbox');

    const existing = await findThread(inv.fromUrn);
    if (existing) {
      await navigateToConversation(existing.id);
      focusComposer(existing.id);
      return { id: existing.id, placeholder: false };
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
    // A leftover search would hide the placeholder from the list just as
    // surely, so it goes too.
    useUIStore.setState({ _pendingRestore: null, searchQuery: '' });
    store.openThread(placeholderId, 0);
    focusComposer(placeholderId);
    return { id: placeholderId, placeholder: true };
  }, []);

  /** Wait for the thread the accept created, then put them in it. */
  const settleJump = useCallback(async (inv: Invitation, placeholderId: string, token: number) => {

    sendBridgeMessage({ type: 'BURST_DISCOVER', category: 'PRIMARY_INBOX' }).catch(() => {});
    const deadline = Date.now() + 15_000;
    let real = await findThread(inv.fromUrn);
    while (!real && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      // Only leaving the inbox counts as moving on. Selection alone does not:
      // the auto-select effect reassigns it for its own reasons, and treating
      // that as intent is what left the accepted thread unselected.
      if (useUIStore.getState().appView !== 'inbox') return;
      if (token !== jumpToken) return; // a newer accept has taken over
      real = await findThread(inv.fromUrn);
    }
    if (!real || token !== jumpToken) return;

    // Hand the reply over rather than copying it.
    //
    // The composer keeps what is typed as the conversation under it changes
    // (see ComposeBox), which is the only way to avoid losing keystrokes made
    // between "read the box" and "the swap renders". The snapshot is a floor
    // for the case where no composer is mounted to do the carrying.
    const snapshot = liveComposerText(placeholderId);
    const storedBefore = (await db.draftAttachments.get(placeholderId).catch(() => undefined))?.text ?? '';
    useUIStore.getState().carryDraftAcross(placeholderId, real.id);

    await navigateToConversation(real.id);
    focusComposer(real.id);

    // Before waiting for anything to render: the list merges threads for the
    // same person and the placeholder is the newer of the two, so the real
    // thread cannot appear — and its composer cannot mount — while it is still
    // there.
    await db.conversations.delete(placeholderId);
    await composerSettledOn(real.id);

    // Converge on the reply ending up here, whatever order things landed in.
    await handOverDraft(placeholderId, real.id, snapshot, storedBefore);
  }, []);

  const openProfile = useCallback((target: { publicId: string; profileUrn?: string }) => {
    if (target.publicId) {
      window.open(`https://www.linkedin.com/in/${target.publicId}/`, '_blank');
    }
  }, []);

  return { acceptInvitation, ignoreInvitation, withdrawInvitation, messageConnection, openProfile };
}
