import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
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
      className={`flex items-center gap-3 border-b border-edge px-4 py-3 ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <GroupAvatar names={[connection.name]} pictures={[connection.pictureUrl]} size={40} />

      <div className="min-w-0 flex-1">
        <button
          onClick={onOpenProfile}
          className="block truncate text-sm font-semibold text-fg-strong hover:underline"
        >
          {connection.name}
        </button>
        <p className="truncate text-xs text-fg-muted">{connection.headline}</p>
      </div>

      {connection.connectedAt > 0 && (
        <span className="shrink-0 whitespace-nowrap text-xs text-fg-muted">
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
