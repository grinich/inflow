import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { MutualConnections } from './MutualConnections';
import type { Invitation } from '@/types/network';

interface Props {
  invitation: Invitation;
  onAccept: () => void;
  onIgnore: () => void;
  onOpenProfile: () => void;
}

/**
 * Detail pane for the selected invitation: a centered profile card, the
 * sender's note as an incoming message bubble, and Accept/Ignore pinned to the
 * bottom — the message-request layout, so a note reads like the first message
 * of a conversation you haven't accepted yet.
 */
export function InvitationDetail({ invitation, onAccept, onIgnore, onOpenProfile }: Props) {
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
            {invitation.mutualCount > 0 && (
              <div className="mt-3">
                <MutualConnections insight={invitation} />
              </div>
            )}
            <button
              onClick={onOpenProfile}
              className="mt-4 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-fg-secondary hover:bg-surface-hover"
              title="Open LinkedIn profile (P)"
            >
              View Profile
            </button>
          </div>

          {invitation.message && (
            <div className="mt-10">
              {invitation.sentAt > 0 && (
                <p className="mb-3 text-center text-xs text-fg-muted">
                  {formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true })}
                </p>
              )}
              <div className="max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-surface-raised px-3.5 py-2 text-sm leading-relaxed text-fg">
                {invitation.message}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-edge px-6 py-4">
        <p className="mb-3 text-center text-sm text-fg-muted">
          Accept invitation from <span className="font-medium text-fg">{invitation.name}</span>?
        </p>
        <div className="mx-auto flex max-w-md gap-3">
          <button
            onClick={onIgnore}
            title="Ignore (D)"
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-edge py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            Ignore
            <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px] font-normal text-fg-faint">D</kbd>
          </button>
          <button
            onClick={onAccept}
            title="Accept (Enter)"
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Accept
            <kbd className="rounded border border-white/25 bg-white/10 px-1 py-px font-mono text-[10px] font-normal text-white/80">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
