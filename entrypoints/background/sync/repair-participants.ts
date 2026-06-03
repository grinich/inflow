import { db, mergeProfiles } from '@/db/database';
import {
  extractParticipantsFromIncluded,
  needsParticipantRepair,
} from '@/lib/voyager-normalizer';
import { debugLog } from '@/lib/debug-log';

/**
 * Repair a conversation's participant data + profile records from a freshly
 * fetched `included` array — but only when the stored participants are missing or
 * unusable (see needsParticipantRepair). This heals conversations that were seeded
 * from an SSE outbound echo whose sender couldn't be resolved, which left them
 * labeled "Unknown" with a garbage participant URN (so the thread list shows
 * "Unknown" and the open-profile shortcut finds no profile).
 *
 * Storing the profiles too is what makes the open-profile ('p') shortcut work,
 * since it looks up db.profiles by the participant URN.
 */
export async function repairConversationParticipants(
  conversationId: string,
  included: any[],
  memberUrn: string,
): Promise<void> {
  const conv = await db.conversations.get(conversationId);
  if (!needsParticipantRepair(conv)) return;

  const { participantUrns, participantNames, participantPictures, profiles } =
    extractParticipantsFromIncluded(included, memberUrn);
  if (participantUrns.length === 0) return;

  if (profiles.length > 0) await mergeProfiles(profiles);
  await db.conversations.update(conversationId, {
    participantUrns,
    participantNames,
    participantPictures,
  });
  debugLog(
    'info',
    `[REPAIR] Restored participants for ${conversationId.substring(0, 20)}...: ${participantNames.join(', ')}`,
  );
}
