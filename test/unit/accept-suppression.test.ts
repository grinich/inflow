// Accepting an invitation makes LinkedIn deliver the sender's note as an
// inbound message seconds later. That is the same event as any other arrival,
// so it alerted — announcing a message the user had just chosen to accept and
// was already looking at.
import {
  recordAcceptedSender,
  isRecentlyAccepted,
  clearAcceptSuppression,
} from '../../entrypoints/background/realtime/accept-suppression';

const SENDER = 'urn:li:fsd_profile:ACoAAAsender';

beforeEach(() => {
  clearAcceptSuppression();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('accept suppression', () => {
  it('suppresses a sender we just accepted', () => {
    recordAcceptedSender(SENDER);

    expect(isRecentlyAccepted(SENDER)).toBe(true);
  });

  it('leaves everyone else alone', () => {
    recordAcceptedSender(SENDER);

    expect(isRecentlyAccepted('urn:li:fsd_profile:someone-else')).toBe(false);
    expect(isRecentlyAccepted(undefined)).toBe(false);
  });

  it('stops suppressing once the window passes', () => {
    // A later, genuine message from the same person has to alert normally —
    // this is a brief amnesty, not a mute.
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);

    vi.advanceTimersByTime(121_000);

    expect(isRecentlyAccepted(SENDER)).toBe(false);
  });

  it('keeps suppressing inside the window', () => {
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);

    // LinkedIn takes seconds, not minutes, but the note can lag a slow sync.
    vi.advanceTimersByTime(60_000);

    expect(isRecentlyAccepted(SENDER)).toBe(true);
  });

  it('ignores an empty urn rather than suppressing everything', () => {
    recordAcceptedSender('');

    expect(isRecentlyAccepted('')).toBe(false);
  });

  it('forgets senders once their window lapses, rather than growing forever', () => {
    vi.useFakeTimers();
    recordAcceptedSender(SENDER);
    vi.advanceTimersByTime(121_000);

    // Recording anyone prunes the stale entries.
    recordAcceptedSender('urn:li:fsd_profile:other');

    expect(isRecentlyAccepted(SENDER)).toBe(false);
    expect(isRecentlyAccepted('urn:li:fsd_profile:other')).toBe(true);
  });
});
