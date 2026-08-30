import {
  scrapeSentInvitations,
  scrapeSentTotal,
  buildWithdrawBody,
} from '@/lib/sent-invitation-scraper';
import type { SentInvitation } from '@/types/network';

/**
 * A row exactly as the invitation-manager page embeds it: JSON escaped for a
 * JS string literal, nested inside the surrounding action object. Copied from
 * a live capture (docs/linkedin-sent-invitations.md) with the ids shortened.
 */
function embeddedRow(opts: {
  id: string;
  first: string;
  last: string;
  vanity: string;
  profile: string;
}) {
  return (
    '\\"title\\":\\"Withdraw invitation\\",\\"url\\":\\"\\",\\"clearBackStack\\":false,' +
    '\\"requestedArguments\\":{\\"$type\\":\\"proto.sdui.actions.requests.RequestedArguments\\",' +
    '\\"requestedStateKeys\\":[],\\"payload\\":{' +
    `\\"profileUrn\\":\\"${opts.profile}\\",` +
    '\\"queryName\\":\\"ProfileMemberRelationshipRefreshById\\",' +
    '\\"trackingActionType\\":\\"INVITATION_MANAGER_WITHDRAW\\",' +
    '\\"invitationType\\":1,\\"inviterActionType\\":2,' +
    `\\"inviteeVanityName\\":\\"${opts.vanity}\\",` +
    `\\"firstName\\":\\"${opts.first}\\",\\"lastName\\":\\"${opts.last}\\",` +
    '\\"cardRef\\":{\\"key\\":\\"auto-component-07c4dce6\\"},' +
    `\\"invitationUrn\\":{\\"invitationId\\":\\"${opts.id}\\"}},` +
    '\\"requestMetadata\\":{\\"$type\\":\\"proto.sdui.common.RequestMetadata\\"}}'
  );
}

const PAGE =
  '<!DOCTYPE html><html><body><div>People (309)</div>' +
  '<script>self.__next_f.push([1,"' +
  embeddedRow({ id: '7498810568384856065', first: 'Dillon', last: 'Mulroy', vanity: 'dillon-mulroy', profile: 'ACoAAAaaa' }) +
  embeddedRow({ id: '7498540000000000000', first: 'Steve', last: 'Hamrick', vanity: 'stevehamrick', profile: 'ACoAAAbbb' }) +
  '"])</script></body></html>';

describe('scrapeSentInvitations', () => {
  it('reads every row the page embedded', () => {
    const { invitations } = scrapeSentInvitations(PAGE);

    expect(invitations).toHaveLength(2);
    expect(invitations.map((i) => i.name)).toEqual(['Dillon Mulroy', 'Steve Hamrick']);
  });

  it('keeps the fields a withdraw needs', () => {
    const [dillon] = scrapeSentInvitations(PAGE).invitations;

    expect(dillon.id).toBe('7498810568384856065');
    expect(dillon.publicId).toBe('dillon-mulroy');
    expect(dillon.toUrn).toBe('urn:li:fsd_profile:ACoAAAaaa');
    expect(dillon.status).toBe('pending');
  });

  it('leaves the note and timestamp empty rather than inventing them', () => {
    // Both are rendered by LinkedIn but absent from the embedded payload.
    const [dillon] = scrapeSentInvitations(PAGE).invitations;

    expect(dillon.message).toBe('');
    expect(dillon.sentAt).toBe(0);
    expect(dillon.headline).toBe('');
  });

  it('reads the real total, not the row count', () => {
    const { invitations, total } = scrapeSentInvitations(PAGE);

    // The page embeds a handful of rows out of hundreds.
    expect(invitations).toHaveLength(2);
    expect(total).toBe(309);
  });

  it('handles a thousands separator in the total', () => {
    expect(scrapeSentTotal('<div>People (1,204)</div>')).toBe(1204);
  });

  it('reports no total rather than zero when the heading is missing', () => {
    // Zero would read as "you have none", which is a different claim.
    expect(scrapeSentTotal('<div>nothing here</div>')).toBeNull();
  });

  it('skips a row whose payload will not parse, keeping the rest', () => {
    const broken = PAGE.replace(
      '\\"invitationUrn\\":{\\"invitationId\\":\\"7498810568384856065\\"}}',
      '\\"invitationUrn\\":{{{ mangled'
    );

    const { invitations } = scrapeSentInvitations(broken);

    expect(invitations.map((i) => i.name)).toEqual(['Steve Hamrick']);
  });

  it('drops a row with no invitation id — it could not be withdrawn anyway', () => {
    const noId = PAGE.replace('\\"invitationId\\":\\"7498810568384856065\\"', '\\"invitationId\\":\\"\\"');

    expect(scrapeSentInvitations(noId).invitations).toHaveLength(1);
  });

  it('deduplicates rows repeated in the payload', () => {
    const twice = PAGE.replace('</script>', embeddedRow({
      id: '7498810568384856065', first: 'Dillon', last: 'Mulroy', vanity: 'dillon-mulroy', profile: 'ACoAAAaaa',
    }) + '</script>');

    expect(scrapeSentInvitations(twice).invitations).toHaveLength(2);
  });

  it('returns nothing on a page it does not recognise', () => {
    // A LinkedIn redesign must yield an empty list, never an exception.
    expect(scrapeSentInvitations('<html><body>signed out</body></html>')).toEqual({
      invitations: [],
      total: null,
    });
    expect(scrapeSentInvitations('')).toEqual({ invitations: [], total: null });
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

  it('sends the enums as strings, not the integers the list payload used', () => {
    // The embedded rows carry inviterActionType: 2 / invitationType: 1, but
    // the action rejects those — it wants the named constants.
    const body = JSON.parse(buildWithdrawBody(invitation));
    const payload = body.serverRequest.requestedArguments.payload;

    expect(payload.inviterActionType).toBe('InviterActionType_WITHDRAW');
    expect(payload.invitationType).toBe('GenericInvitationType_CONNECTION');
  });

  it('identifies the invitation and the person', () => {
    const payload = JSON.parse(buildWithdrawBody(invitation)).serverRequest.requestedArguments.payload;

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
    const payload = JSON.parse(
      buildWithdrawBody({ ...invitation, name: 'Ana Maria de Souza' })
    ).serverRequest.requestedArguments.payload;

    expect(payload.firstName).toBe('Ana');
    expect(payload.lastName).toBe('Maria de Souza');
  });

  it('round-trips a scraped row into a withdraw body', () => {
    const [dillon] = scrapeSentInvitations(PAGE).invitations;

    const payload = JSON.parse(buildWithdrawBody(dillon)).serverRequest.requestedArguments.payload;

    expect(payload.invitationUrn.invitationId).toBe('7498810568384856065');
    expect(payload.profileUrn).toBe('ACoAAAaaa');
  });
});
