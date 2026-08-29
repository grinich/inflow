// @vitest-environment jsdom
/**
 * A display-merged row stands for more than one LinkedIn thread (see
 * useConversations). Nothing used to say so, which is how a real inbox ended
 * up looking broken: LinkedIn showed two Katarina Poljak conversations, inflow
 * showed one, and the thread appeared to jump between them for no reason.
 */
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { ThreadHeader } from '@/components/thread/ThreadHeader';
import { makeConversation } from '../fixtures/factories';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn() }));

const render1to1 = (overrides = {}) =>
  render(
    <ThreadHeader
      conversation={makeConversation({
        participantNames: ['Katarina Poljak'],
        participantUrns: ['urn:li:fsd_profile:katarina'],
        ...overrides,
      }) as any}
    />,
  );

describe('merged-threads indicator', () => {
  it('says how many LinkedIn threads a merged row covers', () => {
    render1to1({ mergedIds: ['2-twin'] });
    expect(screen.getByText(/Merged from 2 LinkedIn threads/i)).toBeInTheDocument();
  });

  it('counts the primary plus every twin', () => {
    render1to1({ mergedIds: ['2-twin', '2-third'] });
    expect(screen.getByText(/Merged from 3 LinkedIn threads/i)).toBeInTheDocument();
  });

  it('explains where a reply will land', () => {
    // The routing is real and not otherwise visible: the primary is whichever
    // thread has the latest activity, so it can change under you.
    render1to1({ mergedIds: ['2-twin'] });
    expect(screen.getByText(/Merged from/i).getAttribute('title'))
      .toMatch(/replies go to the most recent/i);
  });

  it('stays quiet for an ordinary conversation', () => {
    render1to1();
    expect(screen.queryByText(/Merged from/i)).toBeNull();
  });

  it('stays quiet when mergedIds is present but empty', () => {
    render1to1({ mergedIds: [] });
    expect(screen.queryByText(/Merged from/i)).toBeNull();
  });
});
