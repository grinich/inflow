// Shapes modeled on Voyager's application/vnd.linkedin.normalized+json+2.1
// envelope: top-level { data, included }, entities cross-referenced by URN
// via *-prefixed keys. If live responses differ (Task 10 verification),
// update these fixtures and the normalizers together.

/** GET /relationships/invitationViews?q=receivedInvitation */
export const RAW_INVITATIONS_RESPONSE = {
  data: {
    elements: [
      { invitation: 'urn:li:fs_relInvitation:7300001', $type: 'com.linkedin.voyager.relationships.invitation.InvitationView' },
      { invitation: 'urn:li:fs_relInvitation:7300002', $type: 'com.linkedin.voyager.relationships.invitation.InvitationView' },
    ],
    paging: { start: 0, count: 40, total: 2 },
  },
  included: [
    {
      $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
      entityUrn: 'urn:li:fs_relInvitation:7300001',
      sharedSecret: 'secret-aaa',
      sentTime: 1750000000000,
      message: 'Hey! Loved your post on local-first software.',
      '*fromMember': 'urn:li:fs_miniProfile:ACoAAAfrom1',
    },
    {
      $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
      entityUrn: 'urn:li:fs_relInvitation:7300002',
      sharedSecret: 'secret-bbb',
      sentTime: 1750000100000,
      '*fromMember': 'urn:li:fs_miniProfile:ACoAAAfrom2',
    },
    {
      $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
      entityUrn: 'urn:li:fs_miniProfile:ACoAAAfrom1',
      firstName: 'Grace',
      lastName: 'Hopper',
      occupation: 'Rear Admiral @ US Navy',
      publicIdentifier: 'grace-hopper',
      picture: {
        'com.linkedin.common.VectorImage': {
          rootUrl: 'https://media.licdn.com/dms/image/abc/',
          artifacts: [
            { width: 100, height: 100, fileIdentifyingUrlPathSegment: '100_100/pic1.jpg' },
            { width: 400, height: 400, fileIdentifyingUrlPathSegment: '400_400/pic1.jpg' },
          ],
        },
      },
    },
    {
      $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
      entityUrn: 'urn:li:fs_miniProfile:ACoAAAfrom2',
      firstName: 'Alan',
      lastName: 'Turing',
      occupation: 'Mathematician',
      publicIdentifier: 'alan-turing',
      // no picture — must normalize to ''
    },
  ],
};

/** GET /relationships/dash/connections?q=search&sortType=RECENTLY_ADDED */
export const RAW_CONNECTIONS_RESPONSE = {
  data: {
    elements: ['urn:li:fsd_connection:c1', 'urn:li:fsd_connection:c2'],
    paging: { start: 0, count: 40, total: 2 },
  },
  included: [
    {
      $type: 'com.linkedin.voyager.dash.relationships.Connection',
      entityUrn: 'urn:li:fsd_connection:c1',
      createdAt: 1749900000000,
      '*connectedMember': 'urn:li:fsd_profile:ACoAAAconn1',
    },
    {
      $type: 'com.linkedin.voyager.dash.relationships.Connection',
      entityUrn: 'urn:li:fsd_connection:c2',
      createdAt: 1749800000000,
      '*connectedMember': 'urn:li:fsd_profile:ACoAAAconn2',
    },
    {
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: 'urn:li:fsd_profile:ACoAAAconn1',
      firstName: 'Katherine',
      lastName: 'Johnson',
      headline: 'Mathematician @ NASA',
      publicIdentifier: 'katherine-johnson',
      profilePicture: {
        displayImageReferenceResolutionResult: {
          vectorImage: {
            rootUrl: 'https://media.licdn.com/dms/image/def/',
            artifacts: [
              { width: 200, height: 200, fileIdentifyingUrlPathSegment: '200_200/pic2.jpg' },
            ],
          },
        },
      },
    },
    {
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: 'urn:li:fsd_profile:ACoAAAconn2',
      firstName: 'Margaret',
      lastName: 'Hamilton',
      headline: 'Software Engineering Pioneer',
      publicIdentifier: 'margaret-hamilton',
    },
  ],
};
