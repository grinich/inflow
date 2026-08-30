import {
  scrapeSentInvitations,
  scrapeSentTotal,
  buildWithdrawBody,
  buildPaginationBody,
  relativeToTimestamp,
} from '@/lib/sent-invitation-scraper';
import { SENT_PAGE, SENT_RSC_PAGE, buildSentPage } from '../fixtures/sent-invitations-page';
import type { SentInvitation } from '@/types/network';

/** Fixed clock: "Sent 3 days ago" has to resolve somewhere deterministic. */
const NOW = 1_750_000_000_000;
const DAY = 86_400_000;

const scrape = (html: string = SENT_PAGE) => scrapeSentInvitations(html, NOW);
const byName = (html?: string) =>
  new Map(scrape(html).invitations.map((i) => [i.name, i]));

describe('scrapeSentInvitations', () => {
  it('reads every row on the page', () => {
    const { invitations } = scrape();

    expect(invitations.map((i) => i.name)).toEqual([
      'Alberto Parrella',
      'Chirag Patel',
      'Steve Hamrick',
      'Julie Cockle',
    ]);
  });

  it('keeps the fields a withdraw needs', () => {
    const alberto = byName().get('Alberto Parrella')!;

    expect(alberto.id).toBe('7498810568384856065');
    expect(alberto.publicId).toBe('alberto-parrella');
    expect(alberto.toUrn).toBe('urn:li:fsd_profile:ACoAAAaaa');
    expect(alberto.status).toBe('pending');
  });

  // The four fields below live only in the rendered markup, not in the JSON
  // island. An earlier version parsed the island alone and shipped a list of
  // bare names against a LinkedIn page showing all of this.
  it('reads the headline out of the rendered markup', () => {
    expect(byName().get('Alberto Parrella')!.headline).toBe(
      'Product at Apple - Claris | Enterprise and Consumer Products'
    );
    expect(byName().get('Steve Hamrick')!.headline).toBe('VP, Product Management at Slack');
  });

  it('reads the note that was sent with the request', () => {
    expect(byName().get('Alberto Parrella')!.message).toBe(
      "Hey Alberto - I'm the founder of WorkOS. would love to connect and chat sometime"
    );
  });

  it('does not let a note leak onto the row after it', () => {
    // The note renders AFTER the withdraw button, so it trails its own row —
    // read naively it would attach to the next person.
    expect(byName().get('Chirag Patel')!.message).toBe(
      'Hi Chirag - would love to chat sometime about identity.'
    );
    expect(byName().get('Steve Hamrick')!.message).toBe('');
    expect(byName().get('Julie Cockle')!.message).toBe('');
  });

  it('turns the relative sent time into a timestamp', () => {
    expect(byName().get('Steve Hamrick')!.sentAt).toBe(NOW - 3 * DAY);
    expect(byName().get('Alberto Parrella')!.sentAt).toBe(NOW - 15 * 60_000);
  });

  it('reads every row, whatever its escaping depth', () => {
    // The island mixes `\"` and `\\\"` within one document. Parsing the row
    // objects as JSON worked on whichever half matched the assumed depth and
    // failed silently on the rest — losing whole people from the list.
    expect(scrape().invitations).toHaveLength(4);
  });

  it('gives every row an avatar, whatever its escaping depth', () => {
    // The bug: the island mixes escaping depths, JSON.parse succeeded on about
    // half the envelopes and failed silently on the rest, and every other row
    // in the list rendered a grey initial instead of a face.
    const withAvatars = scrape().invitations.filter((i) => i.pictureUrl);

    expect(withAvatars).toHaveLength(4);
  });

  it('reads the avatar out of the image envelope', () => {
    // Smallest rendition at or above 100px, matching pickArtifact's rule.
    // Signature and all: the CDN rejects the url without it.
    expect(byName().get('Alberto Parrella')!.pictureUrl).toBe(
      'https://media.licdn.com/dms/image/v2/100/alberto-parrella.jpg?e=1789603200&v=beta&t=sig-7498810568384856065-100'
    );
  });

  it('reads the real total, not the row count', () => {
    const { invitations, total } = scrape();

    // The page carries a handful of rows out of hundreds.
    expect(invitations).toHaveLength(4);
    expect(total).toBe(311);
  });

  it('handles a thousands separator in the total', () => {
    expect(scrapeSentTotal('<div>People (1,204)</div>')).toBe(1204);
  });

  it('reports no total rather than zero when the heading is missing', () => {
    // Zero would read as "you have none", which is a different claim.
    expect(scrapeSentTotal('<div>nothing here</div>')).toBeNull();
  });

  it('keeps a row whose avatar envelope is missing', () => {
    const page = buildSentPage([
      { id: '1', first: 'Ada', last: 'Lovelace', vanity: 'ada', profile: 'ACoAAA1', headline: 'Analyst', avatar: false },
    ]);

    const [ada] = scrape(page).invitations;

    expect(ada.name).toBe('Ada Lovelace');
    expect(ada.pictureUrl).toBe('');
    expect(ada.headline).toBe('Analyst');
  });

  it('keeps a row that has no headline', () => {
    const page = buildSentPage([
      { id: '1', first: 'Ada', last: 'Lovelace', vanity: 'ada', profile: 'ACoAAA1', sentAgo: '2 weeks' },
    ]);

    const [ada] = scrape(page).invitations;

    expect(ada.headline).toBe('');
    expect(ada.sentAt).toBe(NOW - 14 * DAY);
  });

  it('counts the rows the page held, not the ones it could read', () => {
    // The walk stops on this. Reading it from the readable rows would make a
    // full page with one bad row look like the end of the list — and the
    // prune that follows would delete everything past it.
    const broken = SENT_PAGE.replace('7498810568384856065', 'not-a-number');

    const { invitations, rawCount } = scrape(broken);

    expect(invitations).toHaveLength(3);
    expect(rawCount).toBe(4);
  });

  it('skips a row whose id is unreadable, keeping the rest', () => {
    // Depth-agnostic surgery: the fixture escapes rows at alternating depths,
    // so matching a particular escaped spelling would quietly corrupt nothing.
    const broken = SENT_PAGE.replace('7498810568384856065', 'not-a-number');

    expect(scrape(broken).invitations.map((i) => i.name)).not.toContain('Alberto Parrella');
    expect(scrape(broken).invitations.length).toBe(3);
  });

  it('drops a row with no invitation id — it could not be withdrawn anyway', () => {
    const noId = SENT_PAGE.replace('7498810568384856065', '');

    expect(scrape(noId).invitations).toHaveLength(3);
  });

  it('returns nothing on a page it does not recognise', () => {
    // A LinkedIn redesign must yield an empty list, never an exception.
    expect(scrape('<html><body>signed out</body></html>')).toEqual({
      invitations: [],
      rawCount: 0,
      total: null,
    });
    expect(scrape('')).toEqual({ invitations: [], rawCount: 0, total: null });
  });
});

describe('relativeToTimestamp', () => {
  it.each([
    ['15 minutes', NOW - 15 * 60_000],
    ['1 hour', NOW - 3_600_000],
    ['3 days', NOW - 3 * DAY],
    ['2 weeks', NOW - 14 * DAY],
    ['a day', NOW - DAY],
    ['about 2 hours', NOW - 2 * 3_600_000],
  ])('reads %j', (phrase, expected) => {
    expect(relativeToTimestamp(phrase, NOW)).toBe(expected);
  });

  it('gives 0 for a phrase it cannot read, rather than a wrong date', () => {
    expect(relativeToTimestamp('some time', NOW)).toBe(0);
    expect(relativeToTimestamp('', NOW)).toBe(0);
  });
});

describe('buildWithdrawBody', () => {
  const invitation: SentInvitation = {
    id: '7498540000000000000',
    toUrn: 'urn:li:fsd_profile:ACoAAAbbb',
    name: 'Steve Hamrick',
    headline: '',
    pictureUrl: '',
    publicId: 'stevehamrick',
    message: '',
    sentAt: 0,
    status: 'pending',
  };
  const payloadOf = (inv: SentInvitation) =>
    JSON.parse(buildWithdrawBody(inv)).serverRequest.requestedArguments.payload;

  it('sends the enums as strings, not the integers the list payload used', () => {
    // The rows carry inviterActionType: 2 / invitationType: 1, but the action
    // rejects those — it wants the named constants.
    const payload = payloadOf(invitation);

    expect(payload.inviterActionType).toBe('InviterActionType_WITHDRAW');
    expect(payload.invitationType).toBe('GenericInvitationType_CONNECTION');
  });

  it('identifies the invitation and the person', () => {
    const payload = payloadOf(invitation);

    expect(payload.invitationUrn).toEqual({ invitationId: '7498540000000000000' });
    expect(payload.inviteeVanityName).toBe('stevehamrick');
    // The action wants the bare id, not the full urn.
    expect(payload.profileUrn).toBe('ACoAAAbbb');
    expect(payload.firstName).toBe('Steve');
    expect(payload.lastName).toBe('Hamrick');
  });

  it('carries the guidedFlow state keys the server expects', () => {
    const args = JSON.parse(buildWithdrawBody(invitation)).serverRequest.requestedArguments;

    expect(args.requestedStateKeys.map((k: any) => k.key.value.id)).toEqual([
      'guidedFlowNumSentInvites',
      'guidedFlowUrlAndPictureList',
    ]);
  });

  it('splits a multi-word surname onto lastName', () => {
    expect(payloadOf({ ...invitation, name: 'Ana Maria de Souza' })).toMatchObject({
      firstName: 'Ana',
      lastName: 'Maria de Souza',
    });
  });

  it('round-trips a scraped row into a withdraw body', () => {
    const alberto = byName().get('Alberto Parrella')!;

    expect(payloadOf(alberto)).toMatchObject({
      invitationUrn: { invitationId: '7498810568384856065' },
      profileUrn: 'ACoAAAaaa',
      inviteeVanityName: 'alberto-parrella',
    });
  });
});

// Pages after the first arrive as an RSC component tree, not HTML. The
// tag-stripping that reads page one returns nothing here, and the note sits
// on the other side of the withdraw control — so both shapes are exercised.
describe('scrapeSentInvitations on a pagination response', () => {
  const rsc = () => scrapeSentInvitations(SENT_RSC_PAGE, NOW);
  const rscByName = () => new Map(rsc().invitations.map((i) => [i.name, i]));

  it('reads the same rows out of the component tree', () => {
    expect(rsc().invitations.map((i) => i.name)).toEqual([
      'Alberto Parrella',
      'Chirag Patel',
      'Steve Hamrick',
      'Julie Cockle',
    ]);
  });

  it('reads headline, sent time and note', () => {
    const alberto = rscByName().get('Alberto Parrella')!;

    expect(alberto.headline).toBe('Product at Apple - Claris | Enterprise and Consumer Products');
    expect(alberto.sentAt).toBe(NOW - 15 * 60_000);
    expect(alberto.message).toBe(
      "Hey Alberto - I'm the founder of WorkOS. would love to connect and chat sometime"
    );
  });

  it('does not let a note leak across rows here either', () => {
    // In this shape the note PRECEDES the $L reference, the opposite of the
    // markup — so a rule tuned to one order silently misreads the other.
    expect(rscByName().get('Steve Hamrick')!.message).toBe('');
    expect(rscByName().get('Chirag Patel')!.message).toBe(
      'Hi Chirag - would love to chat sometime about identity.'
    );
  });

  it('keeps ids and avatars', () => {
    const alberto = rscByName().get('Alberto Parrella')!;

    expect(alberto.id).toBe('7498810568384856065');
    expect(alberto.pictureUrl).toBe(
      'https://media.licdn.com/dms/image/v2/100/alberto-parrella.jpg?e=1789603200&v=beta&t=sig-7498810568384856065-100'
    );
  });

  it('reports no total — only the first page carries the heading', () => {
    expect(rsc().total).toBeNull();
  });
});

describe('buildPaginationBody', () => {
  it('cursors on a plain offset', () => {
    const body = JSON.parse(buildPaginationBody(30));

    expect(body.clientArguments.payload.invitationStartIndex).toBe(30);
    expect(body.paginationRequest.requestedArguments.payload.invitationStartIndex).toBe(30);
  });

  it('asks for sent connection invitations', () => {
    const p = JSON.parse(buildPaginationBody(0)).clientArguments.payload;

    expect(p.invitationDirectionEnum).toBe('PendingInvitationDirection_SENT');
    expect(p.invitationTypeEnum).toEqual(['GenericInvitationType_CONNECTION']);
  });

  it('names the pager the server expects', () => {
    const body = JSON.parse(buildPaginationBody(0));

    expect(body.pagerId).toBe('com.linkedin.sdui.pagers.mynetwork.scribeSentInvitationManagerList');
    expect(body.paginationRequest.pagerId).toBe(body.pagerId);
    expect(body.clientArguments.screenId).toBe(
      'com.linkedin.sdui.flagshipnav.mynetwork.invitations.InvitationSentWithType'
    );
  });
});
