/** Shared-connection context, from the `includeInsights=true` payload. */
export interface InvitationInsight {
  /** How many connections you and the sender have in common (0 if unknown). */
  mutualCount: number;
  /** Names of the mutuals the payload named — usually a couple, not all of them. */
  mutualNames: string[];
}

export interface Invitation extends InvitationInsight {
  /** Numeric invitation id (tail of urn:li:fs_relInvitation:...) */
  id: string;
  /** Secret required by the accept/ignore endpoint */
  sharedSecret: string;
  /** Sender, normalized to urn:li:fsd_profile:<memberId> */
  fromUrn: string;
  name: string;
  headline: string;
  pictureUrl: string;
  publicId: string;
  /** Custom note attached to the request ('' if none) */
  message: string;
  sentAt: number;
  status: 'pending' | 'accepted' | 'ignored';
}

/**
 * A connection request *I* sent that is still outstanding.
 *
 * Its own table rather than a `direction` flag on Invitation: the received
 * walk prunes `invitations` by `status === 'pending'`, and sent rows sharing
 * that table would be deleted by it.
 */
export interface SentInvitation {
  /** invitationUrn.invitationId from the invitation-manager page */
  id: string;
  /** Recipient, normalized to urn:li:fsd_profile:<memberId> */
  toUrn: string;
  name: string;
  headline: string;
  pictureUrl: string;
  publicId: string;
  /**
   * Always '' for now. LinkedIn renders the note you sent, but only inside
   * content-hashed markup — it is not in the page's embedded payload.
   */
  message: string;
  /** Always 0 for now, for the same reason as `message`. */
  sentAt: number;
  status: 'pending' | 'withdrawn';
}

export interface Connection {
  /** urn:li:fsd_profile:<memberId> — primary key */
  profileUrn: string;
  name: string;
  headline: string;
  pictureUrl: string;
  publicId: string;
  /** When the connection was made (ms epoch) */
  connectedAt: number;
}
