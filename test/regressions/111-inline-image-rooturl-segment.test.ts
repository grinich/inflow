/**
 * Regression: an inline image whose vectorImage carries the URL as
 * rootUrl + fileIdentifyingUrlPathSegment lost its attachment entirely.
 *
 * The image branch of extractAttachments only read `img.rootUrl` (whole URL)
 * or `artifacts[0].fileUrl`; it never concatenated rootUrl with the
 * artifact's fileIdentifyingUrlPathSegment — the exact shape three sibling
 * paths handle (extractVideoAttachment, getParticipantPicture, and the
 * realtime image extractor). The `if (imageUrl)` guard then skipped the push,
 * so the message rendered as an empty bubble while the conversation preview
 * still said "Sent an image".
 */
import { normalizeMessages } from '@/lib/voyager-normalizer';
import type { VoyagerResponse } from '@/types/voyager';

function responseWithImage(vectorImage: any): VoyagerResponse {
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
        $type: 'com.linkedin.messenger.Message',
        entityUrn: 'urn:li:msg_message:(2-img,1)',
        body: { text: '' },
        deliveredAt: 1000,
        renderContent: [{ vectorImage }],
        '*sender': participantUrn,
      },
    ],
  } as VoyagerResponse;
}

it('joins rootUrl with the artifact path segment', () => {
  const messages = normalizeMessages(
    responseWithImage({
      rootUrl: 'https://media.licdn.com/dms/',
      artifacts: [{ width: 800, fileIdentifyingUrlPathSegment: 'image/v2/xyz' }],
    }),
    '2-img',
  );
  expect(messages[0].attachments).toEqual([
    { type: 'image', imageUrl: 'https://media.licdn.com/dms/image/v2/xyz' },
  ]);
});

it('uses a full-URL path segment when rootUrl is empty (messaging media shape)', () => {
  const messages = normalizeMessages(
    responseWithImage({
      rootUrl: '',
      artifacts: [{ width: 800, fileIdentifyingUrlPathSegment: 'https://media.licdn.com/dms/image/v2/abc' }],
    }),
    '2-img',
  );
  expect(messages[0].attachments).toEqual([
    { type: 'image', imageUrl: 'https://media.licdn.com/dms/image/v2/abc' },
  ]);
});

it('still prefers a whole-URL rootUrl when present without artifacts', () => {
  const messages = normalizeMessages(
    responseWithImage({ rootUrl: 'https://media.licdn.com/whole.jpg' }),
    '2-img',
  );
  expect(messages[0].attachments).toEqual([
    { type: 'image', imageUrl: 'https://media.licdn.com/whole.jpg' },
  ]);
});
