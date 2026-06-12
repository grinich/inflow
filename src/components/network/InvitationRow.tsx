import { formatDistanceToNowStrict } from 'date-fns';
import type { Invitation } from '@/types/network';

interface Props {
  invitation: Invitation;
  selected: boolean;
  onAccept: () => void;
  onIgnore: () => void;
  onOpenProfile: () => void;
}

export function InvitationRow({ invitation, selected, onAccept, onIgnore, onOpenProfile }: Props) {
  return (
    <div
      data-network-row
      aria-selected={selected}
      className={`flex items-start gap-3 border-b border-edge px-4 py-3 ${selected ? 'bg-blue-500/10' : 'hover:bg-fg/5'}`}
    >
      {invitation.pictureUrl ? (
        <img src={invitation.pictureUrl} alt="" className="mt-0.5 h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="mt-0.5 h-10 w-10 shrink-0 rounded-full bg-fg/10" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <button onClick={onOpenProfile} className="truncate text-sm font-semibold text-fg hover:underline">
            {invitation.name}
          </button>
          {invitation.sentAt > 0 && (
            <span className="shrink-0 text-xs text-fg/50">
              {formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true })}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg/60">{invitation.headline}</p>
        {invitation.message && (
          <p className="mt-1 line-clamp-2 rounded bg-fg/5 px-2 py-1 text-xs italic text-fg/80">
            “{invitation.message}”
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onIgnore}
          className="rounded-full border border-edge px-3 py-1 text-xs font-medium text-fg/70 hover:bg-fg/5"
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
