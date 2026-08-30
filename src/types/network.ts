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
