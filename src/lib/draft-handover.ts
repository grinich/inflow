/**
 * A draft row was moved to a conversation by something other than its own
 * composer — the accept flow moving a reply from its placeholder to the real
 * thread once it syncs.
 *
 * The composer reads its draft once, when it mounts. If the move lands after
 * that, the row is right and the box is empty, which to the person typing is
 * indistinguishable from having lost the reply. `detail` is the conversation
 * id that just received one.
 */
export const DRAFT_HANDOVER = 'inflow:draft-handover';
