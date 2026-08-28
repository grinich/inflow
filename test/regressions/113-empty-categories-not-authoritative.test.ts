/**
 * Regression: an EMPTY categories array was read as authoritative
 * "Focused, un-archived, un-starred".
 *
 * normalizeConversations guards sparse payloads with `conv.categories ? ...`
 * — a truthiness test that an empty array passes. `[]` carries no category
 * information, but it produced archived: 0 / category: 'PRIMARY_INBOX' /
 * starred: 0, which mergeConversation writes through (it only skips
 * undefined) — popping an archived thread back into Focused. This contradicts
 * the function's own documented rule: "Absence is NOT a value."
 */
import { normalizeConversations } from '@/lib/voyager-normalizer';
import type { VoyagerResponse } from '@/types/voyager';

function conversationsResponse(categories: string[] | undefined): VoyagerResponse {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OTHER';
  return {
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: participantUrn,
        hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
        participantType: { member: { firstName: { text: 'Other' }, lastName: { text: 'User' } } },
      },
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-empty-cats)',
        lastActivityAt: 1000,
        ...(categories !== undefined ? { categories } : {}),
        '*conversationParticipants': [participantUrn],
      },
    ],
  } as VoyagerResponse;
}

it('treats an empty categories array as unknown, like a missing one', () => {
  const { conversations } = normalizeConversations(conversationsResponse([]));
  expect(conversations[0].archived).toBeUndefined();
  expect(conversations[0].category).toBeUndefined();
  expect(conversations[0].starred).toBeUndefined();
});

it('still derives flags from a populated categories array', () => {
  const { conversations } = normalizeConversations(conversationsResponse(['ARCHIVE', 'STARRED']));
  expect(conversations[0].archived).toBe(1);
  expect(conversations[0].category).toBe('ARCHIVE');
  expect(conversations[0].starred).toBe(1);
});
