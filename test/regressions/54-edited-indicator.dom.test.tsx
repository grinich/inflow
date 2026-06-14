// @vitest-environment jsdom
// Regression follow-up: an edited inbound message must render with the
// "(edited)" indicator. The indicator is driven by message.editedAt; the
// dedup fix folds editedAt (and the edited body) onto the surviving displayed
// copy, so feeding a canonical+SSE edit pair through dedupeMessagesForDisplay
// and into MessageBubble shows the edited text AND the indicator.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render, screen } from '@testing-library/react';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { dedupeMessagesForDisplay } from '@/lib/message-dedup';
import { makeMessage } from '../fixtures/factories';

const SENDER = 'urn:li:fsd_profile:gabriele';
const TS = 1_700_000_000_000;

it('renders the edited body and the (edited) indicator for an edited inbound message', () => {
  const canonical = makeMessage({
    id: 'urn:li:msg_message:1',
    senderUrn: SENDER,
    body: 'original text',
    createdAt: TS,
    isFromMe: false,
  });
  const ssEdited = makeMessage({
    id: 'urn:li:fsd_message:1',
    senderUrn: SENDER,
    body: 'edited text',
    createdAt: TS,
    isFromMe: false,
    editedAt: TS + 5000,
  });

  const [shown, ...rest] = dedupeMessagesForDisplay([canonical, ssEdited]);
  expect(rest).toHaveLength(0); // exactly one bubble

  render(
    <MessageBubble message={shown} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );

  expect(screen.getByText('edited text')).toBeInTheDocument();
  expect(screen.getByText('(edited)')).toBeInTheDocument();
});

it('does not show the (edited) indicator for a normal (unedited) message', () => {
  const msg = makeMessage({
    id: 'urn:li:msg_message:2',
    senderUrn: SENDER,
    body: 'just a message',
    createdAt: TS,
    isFromMe: false,
  });
  render(
    <MessageBubble message={msg} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
  );
  expect(screen.queryByText('(edited)')).not.toBeInTheDocument();
});
