import { formatDistanceToNowStrict } from 'date-fns';
import { NetworkRow } from './NetworkRow';
import type { SentInvitation } from '@/types/network';

interface Props {
  invitation: SentInvitation;
  selected: boolean;
  onSelect: () => void;
}

/**
 * List-pane row for an outgoing request: who I asked, when, and the note I
 * sent. Withdraw lives in the detail pane.
 */
export function SentInvitationRow({ invitation, selected, onSelect }: Props) {
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
