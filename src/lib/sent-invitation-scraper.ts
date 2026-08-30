// Sent invitations are not on Voyager any more — see
// docs/linkedin-sent-invitations.md. The only source is LinkedIn's own
// invitation-manager page, which embeds the rows as escaped JSON inside its
// server-rendered HTML.
//
// Everything here treats the payload as hostile: this is a rendering pipeline,
// not a versioned API, so a shape we don't recognise must yield fewer rows
// rather than an exception.
import type { SentInvitation } from '@/types/network';

/** The marker LinkedIn puts on every withdraw action in the embedded payload. */
const WITHDRAW_MARKER = 'INVITATION_MANAGER_WITHDRAW';

/**
 * The document escapes the JSON for embedding in a JS string literal, so the
 * bytes read `\"profileUrn\":\"…\"`. Unescape only what the embedding added.
 */
function unescapeEmbedded(html: string): string {
  return html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Pull the balanced `{...}` object containing `index`, scanning outwards from
 * it. Brace counting rather than a regex: the payloads nest several levels and
 * contain braces inside strings.
 */
function enclosingObject(text: string, index: number): string | null {
  // Walk back to the opening brace of the object this index sits in.
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

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** urn tail → `urn:li:fsd_profile:<id>`, matching the rest of the app. */
function toProfileUrn(raw: string): string {
  if (!raw) return '';
  const id = raw.includes(':') ? raw.split(':').pop()! : raw;
  return id ? `urn:li:fsd_profile:${id}` : '';
}

export interface ScrapedSentInvitations {
  invitations: SentInvitation[];
  /**
   * Every outstanding request, from the "People (N)" heading — far more than
   * the handful of rows the document embeds.
   */
  total: number | null;
}

/**
 * Parse the sent-invitations page.
 *
 * Rows are found by their withdraw marker rather than by CSS, because the
 * class names are content-hashed and change on every LinkedIn deploy while the
 * payload keys have to stay stable for their own client to work.
 */
export function scrapeSentInvitations(html: string): ScrapedSentInvitations {
  const text = unescapeEmbedded(String(html || ''));
  const invitations: SentInvitation[] = [];
  const seen = new Set<string>();

  let from = 0;
  for (;;) {
    const hit = text.indexOf(WITHDRAW_MARKER, from);
    if (hit === -1) break;
    from = hit + WITHDRAW_MARKER.length;

    const raw = enclosingObject(text, hit);
    if (!raw) continue;
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      continue; // Unrecognised shape: skip this row, keep the rest.
    }

    const id = str(payload?.invitationUrn?.invitationId);
    if (!id || seen.has(id)) continue;

    const first = str(payload.firstName);
    const last = str(payload.lastName);
    const name = `${first} ${last}`.trim();
    seen.add(id);
    invitations.push({
      id,
      toUrn: toProfileUrn(str(payload.profileUrn)),
      name: name || 'LinkedIn Member',
      // The page renders the headline and the note you sent, but only inside
      // content-hashed markup — neither is in the payload.
      headline: '',
      pictureUrl: '',
      publicId: str(payload.inviteeVanityName),
      message: '',
      sentAt: 0,
      status: 'pending',
    });
  }

  return { invitations, total: scrapeSentTotal(text) };
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
