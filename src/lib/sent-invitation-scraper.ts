// Sent invitations are not on Voyager any more — see
// docs/linkedin-sent-invitations.md. The only source is LinkedIn's own
// invitation-manager page, which carries the data in two different places:
//
//   * a JSON island in <script>, holding the withdraw action's payload
//     (invitation id, profile urn, vanity name) and the avatar envelopes
//   * the server-rendered markup, holding the headline, the "Sent N ago"
//     line and the note — none of which appear in the JSON
//
// So a row is assembled from both halves, joined on the person's name. The
// markup is read as a stream of text anchored on the withdraw control's
// aria-label, never on CSS: class names here are content-hashed and change on
// every LinkedIn deploy.
//
// Everything treats the payload as hostile. A shape we don't recognise must
// cost us a field or a row, never an exception.
import type { SentInvitation } from '@/types/network';

const WITHDRAW_MARKER = 'INVITATION_MANAGER_WITHDRAW';
// The first page is HTML, where this is an attribute; later pages come back as
// an RSC component tree, where it is a JSON key. Same phrase either way.
const WITHDRAW_LABEL = /(?:aria-label="|"aria-label":")Withdraw invitation sent to ((?:[^"\\]|\\.)*)"/g;
const SENT_AGO = /^Sent\s+(.+)\s+ago$/;
/** A deferred RSC chunk reference, e.g. `$L34`. Stands where the button sits. */
const LAZY_REF = /^\$L[0-9a-f]+$/i;

/**
 * Rejoin the flight payload's chunk boundaries.
 *
 * The page embeds its payload as a JS array of string chunks, and a chunk can
 * end in the middle of a value. One avatar url arrived as
 *
 *   …/0/1751805872801?e=178960320","0\u0026v=beta\u0026t=<signature>
 *
 * — the two halves of `1789603200` spliced by the join between two chunks. The
 * browser concatenates them before anything reads them; a scraper taking the
 * bytes at face value gets a url that stops early and a face that never loads.
 *
 * Every real quote inside the island is escaped (`\"`), so an UNescaped `","`
 * is always a join and never data. They occur only inside <script>, so heal
 * there: the rendered markup is left exactly as it was, and a pagination
 * response — which has no script tags, and whose own arrays really do separate
 * strings with `","` — passes through untouched.
 */
function healChunkJoins(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, (block) =>
    block.replace(/(?<!\\)","/g, '')
  );
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toProfileUrn(raw: string): string {
  if (!raw) return '';
  const id = raw.includes(':') ? raw.split(':').pop()! : raw;
  return id ? `urn:li:fsd_profile:${id}` : '';
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // 30d — LinkedIn's own rounding is coarser than this
  year: 31_536_000_000,
};

/**
 * "3 days" → an absolute timestamp. The page only ever gives a rounded
 * relative phrase, so this is approximate by construction — good enough to
 * sort by and to render as "3 days ago" again, which is all it is used for.
 */
export function relativeToTimestamp(phrase: string, now: number): number {
  const m = String(phrase || '').match(/^(?:about\s+)?(a|an|\d+)\s+([a-z]+?)s?$/i);
  if (!m) return 0;
  const n = /^(a|an)$/i.test(m[1]) ? 1 : Number(m[1]);
  const unit = UNIT_MS[m[2].toLowerCase()];
  if (!Number.isFinite(n) || !unit) return 0;
  return now - n * unit;
}

/**
 * Visible text in order, from either shape the page comes in.
 *
 * Page one is server-rendered HTML. Every page after it is an RSC component
 * tree, where the same strings sit in `"children":["…"]` — so the tag-stripping
 * that works on the first would return nothing on the rest.
 */
function textLines(source: string): string[] {
  if (source.includes('"children":["')) {
    return [...source.matchAll(/"children":\["((?:[^"\\]|\\.)*)"\]/g)]
      .map((m) => {
        try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
      })
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return fromMarkup(source);
}

function fromMarkup(markup: string): string[] {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface RenderedRow {
  headline: string;
  sentAt: number;
  message: string;
}

/**
 * Read headline / sent time / note out of the rendered markup.
 *
 * Per row the text runs: name, headline, "Sent N ago", "Withdraw", and then
 * the note if there was one — the note is rendered *after* the button, which
 * is why it belongs to the row before it rather than the one that follows.
 */
function renderedRows(html: string, names: string[], now: number): Map<string, RenderedRow> {
  const lines = textLines(html);
  const rows = new Map<string, RenderedRow>();

  // Where each name appears, scanning forward so repeated names stay in order.
  const at: number[] = [];
  let cursor = 0;
  for (const name of names) {
    const i = lines.indexOf(name, cursor);
    at.push(i);
    if (i >= 0) cursor = i + 1;
  }

  for (let r = 0; r < names.length; r++) {
    const start = at[r];
    if (start < 0) continue;
    // Up to the next row's name, or a bounded window for the last row.
    const nextAt = at.slice(r + 1).find((i) => i > start);
    const end = nextAt ?? Math.min(lines.length, start + 8);

    let sentAt = 0;
    const free: string[] = [];
    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      // The button sits between the fields in both shapes — literal text in
      // the HTML, a deferred chunk reference in the RSC tree. Its position
      // differs (the note trails it in HTML, precedes it in RSC), so skip it
      // and rely on order among the real strings instead.
      if (line === 'Withdraw' || LAZY_REF.test(line)) continue;
      const sent = line.match(SENT_AGO);
      if (sent) { sentAt = relativeToTimestamp(sent[1], now); continue; }
      free.push(line);
    }
    rows.set(names[r], { headline: free[0] ?? '', sentAt, message: free[1] ?? '' });
  }
  return rows;
}

// The island's escaping depth is NOT uniform — some objects arrive as `\"`
// and others as `\\\"` — so JSON.parse succeeds on roughly half of them and
// silently fails on the rest. That is what left every other row without a
// face. These read the two strings an avatar needs straight off the raw text
// with `\\*` in place of a fixed depth, which no amount of re-escaping breaks.
const A11Y_TEXT = /a11yText\\*"\s*:\s*\\*"((?:[^"\\]|\\[^"])*)/g;
/**
 * A string field at any escaping depth: `"k":"v"`, `\"k\":\"v\"`, deeper.
 *
 * Lazy up to the next (possibly escaped) quote. A greedy character class
 * cannot tell the backslashes that escape the CLOSING quote from ones inside
 * the value, and swallows them — `Alberto Parrella` came out `Alberto\ Parrella\`.
 */
const field = (name: string) =>
  new RegExp(`${name}\\\\*"\\s*:\\s*\\\\*"(.*?)\\\\*"`);
const INVITATION_ID = /invitationId\\*"\s*:\s*\\*"(\d+)/;
const PROFILE_URN = field('profileUrn');
const VANITY = field('inviteeVanityName');
const FIRST_NAME = field('firstName');
const LAST_NAME = field('lastName');

/** Turn `\u2019` and friends back into characters; drop stray escapes. */
function decode(raw: string): string {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
}
const ROOT_URL = /rootUrl\\*"\s*:\s*\\*"(https:\/\/.*?)\\*"/;
/**
 * A rendition's width and its suffix.
 *
 * The suffix is a SIGNED url — `100_100/<id>/0/<ts>?e=<expiry>&v=beta&t=<sig>`
 * — and the page writes those ampersands as `\u0026`. Stopping the capture at
 * the first backslash therefore cut the url off right after `?e=<expiry>`,
 * losing the signature the CDN requires: every face on the first page came out
 * as a link that looked fine and always failed to load. Read to the closing
 * quote instead and decode after.
 */
const RENDITION = /width\\*"\s*:\s*(\d+)[^]{0,80}?suffixUrl\\*"\s*:\s*\\*"(.*?)\\*"/g;

/** How far past an a11yText to look for its image; one envelope is ~1.2KB. */
const ENVELOPE_WINDOW = 2000;

/** name → avatar url, read off the raw page. */
function avatars(source: string): Map<string, string> {
  const out = new Map<string, string>();
  A11Y_TEXT.lastIndex = 0;
  const starts = [...source.matchAll(A11Y_TEXT)];
  for (const [i, match] of starts.entries()) {
    const label = match[1].replace(/\\u2019/g, '\u2019');
    const from = match.index ?? 0;
    // Stop at the NEXT label as well as at the window size: envelopes sit back
    // to back, and a window that runs into the following one mixes two people's
    // renditions together — then sorting them by width can hand this row its
    // neighbour's face.
    const next = starts[i + 1]?.index ?? source.length;
    const window = source.slice(from, Math.min(next, from + ENVELOPE_WINDOW));
    const rootUrl = window.match(ROOT_URL)?.[1];
    if (!rootUrl) continue;
    const renditions = [...window.matchAll(RENDITION)]
      .map((r) => ({ width: Number(r[1]), suffix: decode(r[2]) }))
      .sort((a, b) => a.width - b.width);
    if (!renditions.length) continue;
    // Smallest at or above 100px, else the largest — pickArtifact's rule.
    const pick = renditions.find((r) => r.width >= 100) ?? renditions[renditions.length - 1];
    if (pick.suffix) out.set(label, decode(rootUrl) + pick.suffix);
  }
  return out;
}

/** a11yText is the name plus decoration ("Ada Lovelace\u2019s profile picture"). */
function avatarFor(name: string, byLabel: Map<string, string>): string {
  const exact = byLabel.get(name);
  if (exact) return exact;
  for (const [label, url] of byLabel) {
    if (label.startsWith(name) || label.includes(name)) return url;
  }
  return '';
}

/** Rows LinkedIn returns per page, first page included. */
export const SENT_PAGE_SIZE = 10;

export interface ScrapedSentInvitations {
  invitations: SentInvitation[];
  /**
   * How many rows the page actually contained, before any were dropped for
   * being unreadable. The walk keys its stop condition off this — comparing
   * the READABLE count against the page size would read a full page with one
   * bad row as the end of the list, and then prune everything past it.
   */
  rawCount: number;
  /**
   * Every outstanding request, from the "People (N)" heading — far more than
   * the handful of rows the document carries.
   */
  total: number | null;
}

export function scrapeSentInvitations(
  html: string,
  now: number = Date.now()
): ScrapedSentInvitations {
  const source = healChunkJoins(String(html || ''));

  // Names in row order, from the withdraw control. This is also the join key
  // between the JSON island and the rendered markup.
  WITHDRAW_LABEL.lastIndex = 0;
  const names = [...source.matchAll(WITHDRAW_LABEL)].map((m) => m[1]);

  const rendered = renderedRows(source, names, now);
  const byLabel = avatars(source);

  // Read the row's fields off the raw slice rather than JSON.parse-ing it, for
  // the same reason the avatars are: escaping depth varies within one document,
  // so parsing succeeds on some objects and fails silently on others. Here that
  // would drop whole rows, not just their faces.
  const invitations: SentInvitation[] = [];
  const seen = new Set<string>();
  let from = 0;
  for (;;) {
    const hit = source.indexOf(WITHDRAW_MARKER, from);
    if (hit === -1) break;
    from = hit + WITHDRAW_MARKER.length;

    // The action holds profileUrn before the marker and the rest after it, so
    // read each side separately — and stop at the next row's marker. Letting
    // the search run on would let a row whose own id is unreadable pick up its
    // neighbour's, which is worse than dropping it: a Withdraw button wired to
    // the wrong person.
    const nextHit = source.indexOf(WITHDRAW_MARKER, from);
    const forward = source.slice(hit, Math.min(nextHit === -1 ? source.length : nextHit, hit + 900));
    const back = source.slice(Math.max(0, hit - 600), hit);

    const id = forward.match(INVITATION_ID)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const first = decode(forward.match(FIRST_NAME)?.[1] ?? '');
    const last = decode(forward.match(LAST_NAME)?.[1] ?? '');
    const name = `${first} ${last}`.trim();
    const extra = rendered.get(name);
    invitations.push({
      id,
      toUrn: toProfileUrn(decode(back.match(PROFILE_URN)?.[1] ?? '')),
      name: name || 'LinkedIn Member',
      headline: extra?.headline ?? '',
      pictureUrl: avatarFor(name, byLabel),
      publicId: decode(forward.match(VANITY)?.[1] ?? ''),
      message: extra?.message ?? '',
      sentAt: extra?.sentAt ?? 0,
      status: 'pending',
    });
  }

  return {
    invitations,
    rawCount: (source.match(new RegExp(WITHDRAW_MARKER, 'g')) || []).length,
    total: scrapeSentTotal(source),
  };
}

/** The `People (309)` heading — the only place the real total appears. */
export function scrapeSentTotal(html: string): number | null {
  const m = String(html || '').match(/People\s*\((\d[\d,]*)\)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The body LinkedIn's own Withdraw button posts.
 *
 * The enums are STRINGS here where the embedded list payload used integers
 * (`inviterActionType: 2`, `invitationType: 1`) — copying the list values
 * through would be rejected. The two `guidedFlow*` state keys are part of the
 * server's contract even though they carry no data of ours.
 */
/**
 * The body behind the invitation manager's infinite scroll.
 *
 * The cursor is a plain offset (`invitationStartIndex`), so pages are just
 * 0, 10, 20… The rest is a fixed envelope; the enums and the pager id are the
 * server's contract, captured from a live request.
 */
export function buildPaginationBody(startIndex: number): string {
  const pagerId = 'com.linkedin.sdui.pagers.mynetwork.scribeSentInvitationManagerList';
  const payload = {
    invitationDirectionEnum: 'PendingInvitationDirection_SENT',
    invitationTypeEnum: ['GenericInvitationType_CONNECTION'],
    invitationClassificationTypes: [],
    filterCriteriaEnum: 'FilterCriteria_UNKNOWN',
    highlightedInvitationIds: [],
    suggestionsEnabled: false,
    paginateSuggestions: false,
    phase: 'Invitations',
    invitationStartIndex: startIndex,
  };
  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys: [],
    payload,
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
    states: [],
    screenId: 'com.linkedin.sdui.flagshipnav.mynetwork.invitations.InvitationSentWithType',
    knownTemplateIds: [],
  };
  return JSON.stringify({
    pagerId,
    clientArguments: requestedArguments,
    paginationRequest: {
      $type: 'proto.sdui.actions.requests.PaginationRequest',
      pagerId,
      trigger: {
        $case: 'itemDistanceTrigger',
        itemDistanceTrigger: {
          $type: 'proto.sdui.actions.requests.ItemDistanceTrigger',
          preloadDistance: 3,
          preloadLength: 250,
        },
      },
      retryCount: 2,
      requestedArguments,
    },
  });
}

export function buildWithdrawBody(invitation: SentInvitation): string {
  const requestId = 'com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';
  const [firstName = '', ...rest] = invitation.name.split(' ');
  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys: [
      { key: { value: { $case: 'id', id: 'guidedFlowNumSentInvites' } }, namespace: '' },
      {
        key: { value: { $case: 'id', id: 'guidedFlowUrlAndPictureList' } },
        namespace: 'guidedFlowUrlAndPictureListNameSpace',
      },
    ],
    payload: {
      inviterActionType: 'InviterActionType_WITHDRAW',
      inviteeVanityName: invitation.publicId,
      firstName,
      lastName: rest.join(' '),
      profileUrn: invitation.toUrn.split(':').pop() || '',
      queryName: 'ProfileMemberRelationshipRefreshById',
      invitationType: 'GenericInvitationType_CONNECTION',
      invitationUrn: { invitationId: invitation.id },
      firstFiveInviteCount: { key: 'guidedFlowNumSentInvites', namespace: '' },
      guidedFlowUrlandProfileList: {
        key: 'guidedFlowUrlAndPictureList',
        namespace: 'guidedFlowUrlAndPictureListNameSpace',
      },
    },
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
  };
  return JSON.stringify({
    requestId,
    serverRequest: { requestId, requestedArguments },
    requestedArguments,
  });
}
