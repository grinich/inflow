import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import type { Connection } from '@/types/network';

interface Props {
  connection: Connection;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Compact list-pane row for a connection. Messaging and profile actions live
 * in ConnectionDetail — this row only selects.
 */
export function ConnectionRow({ connection, selected, onSelect }: Props) {
  return (
    <button
      data-network-row
      aria-selected={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 border-b border-edge px-4 py-3 text-left ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
    >
      <GroupAvatar names={[connection.name]} pictures={[connection.pictureUrl]} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-fg-strong">{connection.name}</span>
          {connection.connectedAt > 0 && (
            <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-fg-muted">
              {formatDistanceToNowStrict(connection.connectedAt)}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">{connection.headline}</p>
      </div>
    </button>
  );
}
