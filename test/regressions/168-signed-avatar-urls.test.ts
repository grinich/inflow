// Every avatar on the first page of sent invitations was broken.
//
// Not missing — broken. The scraper produced a URL for each row, the rows
// rendered, and each face 404'd, which is why this survived a fixture, nine
// tests and a live check: the data looked right everywhere except in a browser.
//
// LinkedIn's suffixUrl is a SIGNED path:
//
//   100_100/<id>/0/<ts>?e=<expiry>&v=beta&t=<signature>
//
// and the page writes those ampersands as &. The capture stopped at the
// first backslash, so the URL ended at `?e=<expiry>` — plausible, complete
// looking, and rejected by the CDN, which requires the signature.
//
// Confirmed against the live page before fixing: the truncated URL failed to
// load and the full one returned a 100px image.
import { scrapeSentInvitations } from '@/lib/sent-invitation-scraper';

interface Person { first: string; last: string; id: string }
const ADA: Person = { first: 'Ada', last: 'Lovelace', id: '7499764044224942080' };
const GRACE: Person = { first: 'Grace', last: 'Hopper', id: '7499764044224942081' };

/** One row: its avatar envelope followed by its withdraw action, as live. */
function page(
  suffix: string,
  escape: (s: string) => string = (s) => s,
  who: Person = ADA
): string {
  const json = JSON.stringify({
    a11yText: `${who.first} ${who.last}\u2019s profile picture`,
    renderPayload: {
      rootUrl: 'https://media.licdn.com/dms/image/v2/ROOT/profile-displayphoto-shrink_',
      imageRenditions: [{ width: 100, height: 100, suffixUrl: suffix }],
    },
  });
  const action = JSON.stringify({
    profileUrn: `urn:li:fsd_profile:ACoAAA${who.first.toLowerCase()}`,
    trackingActionType: 'INVITATION_MANAGER_WITHDRAW',
    invitationId: who.id,
    inviteeVanityName: who.first.toLowerCase(),
    firstName: who.first,
    lastName: who.last,
  });
  return escape(json).replace(/"/g, '\\"') + escape(action).replace(/"/g, '\\"');
}

const SIGNED = '100_100/ABC/0/1517280317031?e=1789603200&v=beta&t=the-signature';
/** How the page writes it: ampersands as &. */
const asEscaped = (s: string) => s.replace(/&/g, '\\u0026');

const avatarOf = (html: string) => scrapeSentInvitations(html, 1_760_000_000_000).invitations[0]?.pictureUrl;

describe('regression #168: signed avatar urls survive the scrape', () => {
  it('keeps the whole query string, escaped ampersands and all', () => {
    const url = avatarOf(page(SIGNED, asEscaped));

    expect(url).toBe(
      'https://media.licdn.com/dms/image/v2/ROOT/profile-displayphoto-shrink_' + SIGNED
    );
  });

  it('does not stop at the first escape', () => {
    // The precise failure: everything up to `?e=…` and nothing after it.
    const url = avatarOf(page(SIGNED, asEscaped));

    expect(url).toContain('v=beta');
    expect(url).toContain('t=the-signature');
    expect(url!.endsWith('?e=1789603200')).toBe(false);
  });

  it('still reads an unsigned suffix', () => {
    // Pagination responses are escaped differently; both shapes go through
    // this same reader, so neither may regress the other.
    const url = avatarOf(page('100_100/ABC/0/1517280317031'));

    expect(url).toBe(
      'https://media.licdn.com/dms/image/v2/ROOT/profile-displayphoto-shrink_100_100/ABC/0/1517280317031'
    );
  });

  it('rejoins a url the page split across two chunks', () => {
    // The other half of the same bug, and the reason two faces stayed broken
    // after the escaping was fixed. The page embeds its payload as an array of
    // string chunks and a chunk can end mid-value: `1789603200` arrived as
    // `178960320` + `0`, spliced by the unescaped `","` between chunks.
    // Captured verbatim from the live page.
    const spliced =
      '<script>' +
      page(SIGNED, asEscaped).replace('?e=1789603200', '?e=178960320","0') +
      '</script>';

    const url = avatarOf(spliced);

    expect(url).toContain('e=1789603200');
    expect(url).toContain('t=the-signature');
  });

  it('leaves a pagination response alone', () => {
    // Those really are arrays of separate strings — `"children":["a","b"]` —
    // so healing them would glue unrelated text together. They arrive without
    // script tags, which is what keeps the two apart.
    const rsc = '{"children":["Ada Lovelace","Sent 3 days ago"]}';

    expect(scrapeSentInvitations(rsc, 1_760_000_000_000).invitations).toEqual([]);
    // The join survives: nothing was spliced out of it.
    expect(rsc.includes('","')).toBe(true);
  });

  it('does not give a row its neighbour’s face', () => {
    // Envelopes sit back to back and one is well under the window size, so a
    // window that runs on collects both people's renditions — and sorting them
    // by width can pick the wrong person's.
    const two =
      page(SIGNED, asEscaped, ADA) +
      page('100_100/XYZ/0/999?e=1\\u0026t=other', (s) => s, GRACE);
    const { invitations } = scrapeSentInvitations(two, 1_760_000_000_000);

    expect(invitations).toHaveLength(2);
    expect(invitations[0].name).toBe('Ada Lovelace');
    expect(invitations[0].pictureUrl).toContain('ABC');
    expect(invitations[0].pictureUrl).not.toContain('XYZ');
    expect(invitations[1].pictureUrl).toContain('XYZ');
  });
});
