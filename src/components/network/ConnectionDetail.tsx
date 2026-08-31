import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import type { Connection } from '@/types/network';

interface Props {
  connection: Connection;
  onMessage: () => void;
  onOpenProfile: () => void;
}

/** Detail pane for the selected connection — same shape as InvitationDetail. */
export function ConnectionDetail({ connection, onMessage, onOpenProfile }: Props) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center">
        <GroupAvatar names={[connection.name]} pictures={[connection.pictureUrl]} size={80} />
        <h2 className="mt-3 text-lg font-semibold text-fg-strong">{connection.name}</h2>
        {connection.headline && (
          <p className="mt-0.5 max-w-md text-sm text-fg-muted">{connection.headline}</p>
        )}
        {connection.connectedAt > 0 && (
          <p className="mt-1 text-xs text-fg-muted">
            Connected {formatDistanceToNowStrict(connection.connectedAt, { addSuffix: true })}
          </p>
        )}
        <button
          onClick={onOpenProfile}
          className="mt-4 rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-fg-secondary hover:bg-surface-hover"
          title="Open LinkedIn profile (P)"
        >
          View Profile
        </button>
      </div>

      <div className="border-t border-edge px-6 py-4">
        <div className="mx-auto max-w-md">
          <button
            onClick={onMessage}
            title="Message (Enter)"
            className="w-full rounded-full bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Message
          </button>
        </div>
      </div>
    </div>
  );
}
