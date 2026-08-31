import { formatDistanceToNowStrict } from 'date-fns';
import { NetworkRow } from './NetworkRow';
import type { Invitation } from '@/types/network';

interface Props {
  invitation: Invitation;
  selected: boolean;
  onSelect: () => void;
}

/**
 * List-pane row for a received invitation. The actions (Accept/Ignore/View
 * Profile) live in InvitationDetail — this row only selects.
 */
export function InvitationRow({ invitation, selected, onSelect }: Props) {
  return (
    <NetworkRow
      name={invitation.name}
      pictureUrl={invitation.pictureUrl}
      timestamp={invitation.sentAt > 0 ? formatDistanceToNowStrict(invitation.sentAt, { addSuffix: true }) : undefined}
      subtitle={invitation.headline}
      note={invitation.message}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
