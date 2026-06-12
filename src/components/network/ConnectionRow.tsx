import { formatDistanceToNowStrict } from 'date-fns';
import type { Connection } from '@/types/network';

interface Props {
  connection: Connection;
  selected: boolean;
  onMessage: () => void;
  onOpenProfile: () => void;
}

export function ConnectionRow({ connection, selected, onMessage, onOpenProfile }: Props) {
  return (
    <div
      data-network-row
      aria-selected={selected}
      className={`flex items-center gap-3 border-b border-edge px-4 py-3 ${selected ? 'bg-blue-500/10' : 'hover:bg-fg/5'}`}
    >
      {connection.pictureUrl ? (
        <img src={connection.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded-full bg-fg/10" />
      )}
      <div className="min-w-0 flex-1">
        <button onClick={onOpenProfile} className="block truncate text-sm font-semibold text-fg hover:underline">
          {connection.name}
        </button>
        <p className="truncate text-xs text-fg/60">{connection.headline}</p>
      </div>
      {connection.connectedAt > 0 && (
        <span className="shrink-0 text-xs text-fg/50">
          Connected {formatDistanceToNowStrict(connection.connectedAt, { addSuffix: true })}
        </span>
      )}
      <button
        onClick={onMessage}
        className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
        title="Message (Enter)"
      >
        Message
      </button>
    </div>
  );
}
