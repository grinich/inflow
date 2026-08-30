import { formatDistanceToNowStrict } from 'date-fns';
import { NetworkRow } from './NetworkRow';
import type { Connection } from '@/types/network';

interface Props {
  connection: Connection;
  selected: boolean;
  onSelect: () => void;
}

/** List-pane row for an existing connection. Actions live in ConnectionDetail. */
export function ConnectionRow({ connection, selected, onSelect }: Props) {
  return (
    <NetworkRow
      name={connection.name}
      pictureUrl={connection.pictureUrl}
      timestamp={connection.connectedAt > 0 ? formatDistanceToNowStrict(connection.connectedAt) : undefined}
      subtitle={connection.headline}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
