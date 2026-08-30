// A stand-in for LinkedIn's invitation-manager page, mirroring the structure
// captured in docs/linkedin-sent-invitations.md: a JSON island in <script>
// carrying the withdraw payloads and avatar envelopes, and server-rendered
// markup carrying the headline, the "Sent N ago" line and the note.
//
// Synthetic rather than a saved capture: the real page is full of real
// people's names, headlines and private notes.

interface Row {
  id: string;
  first: string;
  last: string;
  vanity: string;
  profile: string;
  headline?: string;
  sentAgo?: string;
  /** The note attached to the request; omitted means none was sent. */
  note?: string;
  /** Omit to simulate a row whose avatar envelope is missing. */
  avatar?: boolean;
}

/** The withdraw action payload, escaped as the page embeds it. */
function actionPayload(r: Row): string {
  const json = JSON.stringify({
    profileUrn: r.profile,
    queryName: 'ProfileMemberRelationshipRefreshById',
    trackingActionType: 'INVITATION_MANAGER_WITHDRAW',
    invitationType: 1,
    inviterActionType: 2,
    inviteeVanityName: r.vanity,
    firstName: r.first,
    lastName: r.last,
    cardRef: { key: 'auto-component-07c4dce6' },
    invitationUrn: { invitationId: r.id },
  });
  return json.replace(/"/g, '\\"');
}

/**
 * The avatar envelope, keyed by a11yText as the real page keys it.
 *
 * `deep` doubles the escaping. The live island mixes depths — some objects
 * arrive as \" and others as \\\" — which is what used to leave every other
 * row without a face, so the fixture mixes them too.
 */
function avatarPayload(r: Row, deep = false): string {
  const json = JSON.stringify({
    a11yText: `${r.first} ${r.last}\u2019s profile picture`,
    shape: 'CIRCLE',
    imageId: 'img-' + r.id,
    renderPayload: {
      rootUrl: 'https://media.licdn.com/dms/image/v2/',
      imageRenditions: [
        { width: 50, height: 50, suffixUrl: `50/${r.vanity}.jpg` },
        { width: 100, height: 100, suffixUrl: `100/${r.vanity}.jpg` },
        { width: 200, height: 200, suffixUrl: `200/${r.vanity}.jpg` },
      ],
      assetUrn: 'urn:li:digitalmediaAsset:' + r.id,
    },
  });
  const escaped = json.replace(/"/g, '\\"');
  return deep ? escaped.replace(/\\"/g, '\\\\\\"') : escaped;
}

/**
 * The rendered half. Note the ordering the real page uses: the note comes
 * AFTER the withdraw control, so it trails the row it belongs to.
 */
function markup(r: Row): string {
  const cls = 'class="_1ce8d075 a41f8dbe c9c00ae7"'; // content-hashed, as live
  return (
    `<div ${cls}>` +
    `<span ${cls}>${r.first} ${r.last}</span>` +
    (r.headline ? `<p ${cls}>${r.headline}</p>` : '') +
    `<time ${cls}>Sent ${r.sentAgo ?? '3 days'} ago</time>` +
    `<a ${cls} href="https://www.linkedin.com/" aria-label="Withdraw invitation sent to ${r.first} ${r.last}">` +
    `<span ${cls}>Withdraw</span></a>` +
    (r.note ? `<div ${cls}><p ${cls}>${r.note}</p></div>` : '') +
    `</div>`
  );
}

export function buildSentPage(rows: Row[], total = 311): string {
  const island = rows
    .map((r, i) => {
      // Alternate the escaping depth, as the live page does.
      const avatar = r.avatar === false ? '' : avatarPayload(r, i % 2 === 1);
      return `{${actionPayload(r)}}{${avatar}}`;
    })
    .join('');
  return (
    '<!DOCTYPE html><html><body>' +
    '<div><span>Received</span><span>Sent</span></div>' +
    `<div>People (${total})</div>` +
    rows.map(markup).join('') +
    `<script>self.__next_f.push([1,"${island}"])</script>` +
    '</body></html>'
  );
}

export const SENT_ROWS: Row[] = [
  {
    id: '7498810568384856065',
    first: 'Alberto', last: 'Parrella', vanity: 'alberto-parrella', profile: 'ACoAAAaaa',
    headline: 'Product at Apple - Claris | Enterprise and Consumer Products',
    sentAgo: '15 minutes',
    note: "Hey Alberto - I'm the founder of WorkOS. would love to connect and chat sometime",
  },
  {
    id: '7498540000000000001',
    first: 'Chirag', last: 'Patel', vanity: 'chirag-patel', profile: 'ACoAAAbbb',
    headline: 'Leading a team of PMs in the enterprise product space at Apple',
    sentAgo: '16 minutes',
    note: "Hi Chirag - would love to chat sometime about identity.",
  },
  {
    // No note — the common case, and the one that must not inherit a neighbour's.
    id: '7498540000000000002',
    first: 'Steve', last: 'Hamrick', vanity: 'stevehamrick', profile: 'ACoAAAccc',
    headline: 'VP, Product Management at Slack',
    sentAgo: '3 days',
  },
  {
    id: '7498540000000000003',
    first: 'Julie', last: 'Cockle', vanity: 'julie-cockle', profile: 'ACoAAAddd',
    headline: 'VP of Product @ Slack',
    sentAgo: '3 days',
  },
];

export const SENT_PAGE = buildSentPage(SENT_ROWS);

/**
 * Pages after the first come back as an RSC component tree instead of HTML:
 * the same strings, but in `"children":["…"]`, with the withdraw control
 * standing as a deferred `$Lxx` reference — and the note BEFORE that reference
 * rather than after it, the reverse of the markup's order.
 */
export function buildSentRscPage(rows: Row[]): string {
  const parts = rows.map((r, i) => {
    const name = `${r.first} ${r.last}`;
    const bits = [
      `{"children":["${name}"]}`,
      r.headline ? `{"children":["${r.headline}"]}` : '',
      `{"children":["Sent ${r.sentAgo ?? '3 days'} ago"]}`,
      r.note ? `{"children":["${r.note}"]}` : '',
      `{"children":["$L${(0x34 + i).toString(16)}"]}`,
      `{"aria-label":"Withdraw invitation sent to ${name}"}`,
      `{${actionPayload(r).replace(/\\"/g, '"')}}`,
      r.avatar === false ? '' : `{${avatarPayload(r).replace(/\\"/g, '"')}}`,
    ];
    return bits.filter(Boolean).join(',');
  });
  return '3:[' + parts.join(',') + ']\n';
}

export const SENT_RSC_PAGE = buildSentRscPage(SENT_ROWS);
