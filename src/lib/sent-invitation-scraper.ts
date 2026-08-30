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
 * The document escapes its JSON for embedding in a JS string literal, so the
 * bytes read `\"profileUrn\":\"…\"`. Unescape only what the embedding added.
 */
function unescapeEmbedded(html: string): string {
  return html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** The balanced `{...}` containing `index`, found by counting braces. */
function enclosingObject(text: string, index: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Every balanced object containing `marker`, parsed, skipping the unparseable. */
function objectsContaining(text: string, marker: string): any[] {
  const out: any[] = [];
  let from = 0;
  for (;;) {
    const hit = text.indexOf(marker, from);
    if (hit === -1) break;
    from = hit + marker.length;
    const raw = enclosingObject(text, hit);
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Unrecognised shape: skip this one, keep the rest.
    }
  }
  return out;
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

/** name → avatar url, from the image envelopes in the JSON island. */
function avatars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const img of objectsContaining(text, '"a11yText"')) {
    const label = str(img.a11yText);
    const rootUrl = str(img.renderPayload?.rootUrl ?? img.rootUrl);
    const renditions = img.renderPayload?.imageRenditions ?? img.imageRenditions;
    if (!label || !rootUrl || !Array.isArray(renditions) || !renditions.length) continue;
    // Smallest rendition at or above 100px, else the largest available —
    // matching pickArtifact's rule for Voyager's vectorImage.
    const sorted = [...renditions].sort((a, b) => (a?.width || 0) - (b?.width || 0));
    const pick = sorted.find((a) => (a?.width || 0) >= 100) || sorted[sorted.length - 1];
    const suffix = str(pick?.suffixUrl);
    if (suffix) out.set(label, rootUrl + suffix);
  }
  return out;
}

/** a11yText is the name plus decoration ("Ada Lovelace, profile photo"). */
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
   * Every outstanding request, from the "People (N)" heading — far more than
   * the handful of rows the document carries.
   */
  total: number | null;
}

export function scrapeSentInvitations(
  html: string,
  now: number = Date.now()
): ScrapedSentInvitations {
  const source = String(html || '');
  const text = unescapeEmbedded(source);

  // Names in row order, from the withdraw control. This is also the join key
  // between the JSON island and the rendered markup.
  WITHDRAW_LABEL.lastIndex = 0;
  const names = [...source.matchAll(WITHDRAW_LABEL)].map((m) => m[1]);

  const rendered = renderedRows(source, names, now);
  const byLabel = avatars(text);

  const invitations: SentInvitation[] = [];
  const seen = new Set<string>();
  for (const action of objectsContaining(text, WITHDRAW_MARKER)) {
    const id = str(action?.invitationUrn?.invitationId);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = `${str(action.firstName)} ${str(action.lastName)}`.trim();
    const extra = rendered.get(name);
    invitations.push({
      id,
      toUrn: toProfileUrn(str(action.profileUrn)),
      name: name || 'LinkedIn Member',
      headline: extra?.headline ?? '',
      pictureUrl: avatarFor(name, byLabel),
      publicId: str(action.inviteeVanityName),
      message: extra?.message ?? '',
      sentAt: extra?.sentAt ?? 0,
      status: 'pending',
    });
  }

  return { invitations, total: scrapeSentTotal(source) };
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
