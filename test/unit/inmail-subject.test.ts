/**
 * The InMail subject round-trip.
 *
 * Only InMail carries a subject, and the conversation is no help in spotting
 * one: a received InMail sits in PRIMARY_INBOX like anything else (verified
 * against real synced data). So the subject's presence is the marker, which
 * makes capturing it the difference between inflow knowing an InMail when it
 * sees one and not.
 *
 * Before this, inflow dropped it outright — a received InMail's subject was
 * visible on linkedin.com and absent from inflow.
 */
import { normalizeMessages } from '@/lib/voyager-normalizer';

/** Minimal messengerMessages-shaped payload with one message entity. */
function payload(entity: Record<string, unknown>) {
  return {
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.Message',
        entityUrn: 'urn:li:msg_message:(urn:li:fsd_profile:SELF,abc)',
        deliveredAt: 1_700_000_000_000,
        conversation: { entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,c1)' },
        sender: { hostIdentityUrn: 'urn:li:fsd_profile:THEM' },
        body: { text: 'Hey Diego,' },
        ...entity,
      },
    ],
  } as any;
}

it('keeps an InMail subject off the body, as its own field', () => {
  const [msg] = normalizeMessages(payload({ subject: 'Candidate available - Staff Infra Eng' }), 'c1');
  expect(msg?.subject).toBe('Candidate available - Staff Infra Eng');
  // The body must stay clean — the subject is not prepended to it.
  expect(msg?.body).toBe('Hey Diego,');
});

it('leaves ordinary messages without a subject at all', () => {
  const [msg] = normalizeMessages(payload({}), 'c1');
  expect(msg).toBeDefined();
  expect(msg).not.toHaveProperty('subject');
});

it('ignores a blank or non-string subject rather than marking an InMail', () => {
  expect(normalizeMessages(payload({ subject: '   ' }), 'c1')[0]).not.toHaveProperty('subject');
  expect(normalizeMessages(payload({ subject: 42 }), 'c1')[0]).not.toHaveProperty('subject');
});

it('trims surrounding whitespace', () => {
  const [msg] = normalizeMessages(payload({ subject: '  Working smarter  ' }), 'c1');
  expect(msg?.subject).toBe('Working smarter');
});
