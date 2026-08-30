import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import type { Invitation } from '@/types/network';

interface Props {
  invitation: Invitation;
  selected: boolean;
  onAccept: () => void;
  onIgnore: () => void;
  onOpenProfile: () => void;
}

/**
 * "12 shared connections" — named where the payload gave us names, since a
 * name you recognise decides the request far faster than a count does.
 */
function mutualsLabel({ mutualCount, mutualNames }: Invitation): string {
  const plural = `${mutualCount} shared connection${mutualCount === 1 ? '' : 's'}`;
  if (mutualNames.length === 0) return plural;
  const [first] = mutualNames;
  const others = mutualCount - 1;
  if (others <= 0) return `${first} is a shared connection`;
  return `${first} and ${others} other shared connection${others === 1 ? '' : 's'}`;
}

export function InvitationRow({ invitation, selected, onAccept, onIgnore, onOpenProfile }: Props) {
  return (
    <div
      data-network-row
      aria-selected={selected}
      className={`flex items-center gap-3 border-b border-edge px-4 py-3 ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <GroupAvatar names={[invitation.name]} pictures={[invitation.pictureUrl]} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            onClick={onOpenProfile}
            className="truncate text-sm font-semibold text-fg-strong hover:underline"
          >
            {invitation.name}
          </button>
          {invitation.sentAt > 0 && (
            <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-fg-muted">
              {formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true })}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">{invitation.headline}</p>
        {invitation.mutualCount > 0 && (
          <p className="truncate text-xs text-fg-muted">{mutualsLabel(invitation)}</p>
        )}
        {invitation.message && (
          <p className="mt-0.5 truncate text-xs italic text-fg-secondary">“{invitation.message}”</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onIgnore}
          className="rounded-full border border-edge px-3 py-1 text-xs font-medium text-fg-secondary hover:bg-surface-hover"
          title="Ignore (X)"
        >
          Ignore
        </button>
        <button
          onClick={onAccept}
          className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          title="Accept (Enter)"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
