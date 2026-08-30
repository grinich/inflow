import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import type { SentInvitation } from '@/types/network';

interface Props {
  invitation: SentInvitation;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Compact list-pane row for an outgoing request: who I asked, when, and a
 * one-line preview of the note I sent. Withdraw lives in the detail pane —
 * this row only selects, like InvitationRow.
 */
export function SentInvitationRow({ invitation, selected, onSelect }: Props) {
  return (
    <button
      data-network-row
      aria-selected={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 border-b border-edge px-4 py-3 text-left ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <GroupAvatar names={[invitation.name]} pictures={[invitation.pictureUrl]} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-fg-strong">{invitation.name}</span>
          {invitation.sentAt > 0 && (
            <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-fg-muted">
              {formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true })}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">{invitation.headline}</p>
        {invitation.message && (
          <p className="mt-0.5 truncate text-xs italic text-fg-secondary">“{invitation.message}”</p>
        )}
      </div>
    </button>
  );
}
