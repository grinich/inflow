import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import type { SentInvitation } from '@/types/network';

interface Props {
  invitation: SentInvitation;
  onWithdraw: () => void;
  onOpenProfile: () => void;
}

/**
 * Detail pane for a request I sent: the recipient's card, the note I wrote,
 * and Withdraw pinned to the bottom.
 *
 * Mirrors InvitationDetail, with the note as an OUTGOING bubble — right
 * aligned and in the accent colour, the same way the thread view distinguishes
 * my messages from theirs. The layout reads as a conversation I started and
 * they have not replied to, which is what an outstanding request is.
 */
export function SentInvitationDetail({ invitation, onWithdraw, onOpenProfile }: Props) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col px-6 py-10">
          <div className="flex flex-col items-center text-center">
            <GroupAvatar names={[invitation.name]} pictures={[invitation.pictureUrl]} size={80} />
            <h2 className="mt-3 text-lg font-semibold text-fg-strong">{invitation.name}</h2>
            {invitation.headline && (
              <p className="mt-0.5 max-w-md text-sm text-fg-muted">{invitation.headline}</p>
            )}
            <button
              onClick={onOpenProfile}
              className="mt-4 cursor-pointer rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
              title="Open LinkedIn profile (P)"
            >
              View Profile
            </button>
          </div>

          <div className="mt-10">
            {invitation.sentAt > 0 && (
              <p className="mb-3 text-center text-xs text-fg-muted">
                Sent {formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true })}
              </p>
            )}
            {invitation.message ? (
              <div className="ml-auto max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-blue-600 px-3.5 py-2 text-sm leading-relaxed text-white">
                {invitation.message}
              </div>
            ) : (
              // Not "you sent this without a note" — we genuinely cannot tell.
              // LinkedIn renders the note but keeps it out of the payload the
              // page embeds, so claiming there wasn't one would be a guess.
              <p className="text-center text-sm text-fg-muted">
                LinkedIn doesn't say whether you attached a note to this one.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-edge px-6 py-4">
        <p className="mb-3 text-center text-sm text-fg-muted">
          Waiting on <span className="font-medium text-fg">{invitation.name}</span>
        </p>
        <div className="mx-auto flex max-w-md">
          <button
            onClick={onWithdraw}
            className="flex-1 cursor-pointer rounded-full border border-edge py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}
