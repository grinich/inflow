export interface MessageAttachment {
  type: 'image' | 'gif' | 'file' | 'video' | 'audio' | 'sharedPost' | 'externalMedia' | 'unknown';
  /** Image URL (for type=image and type=gif; thumbnail for type=video) */
  imageUrl?: string;
  /** File name (for type=file) */
  fileName?: string;
  /** File URL (for type=file) */
  fileUrl?: string;
  /** File size in bytes */
  fileSize?: number;
  /** MIME type */
  mimeType?: string;
  /** Audio/video duration in milliseconds */
  durationMs?: number;
  /** LinkedIn post activity URN (for type=sharedPost) */
  postUrn?: string;
  /** External media URL */
  externalUrl?: string;
  /** Fallback text description */
  fallbackText?: string;
  /** Original dimensions (for type=gif and type=video) */
  width?: number;
  height?: number;
}

export interface RepliedMessage {
  senderName: string;
  body: string;
  messageId?: string;    // original message entityUrn (for scroll-to-original)
  senderUrn?: string;    // original sender URN (for API payload)
  sentAt?: number;       // original message timestamp (for API payload)
}

export interface MessageMention {
  /** Start offset into body (UTF-16 code units, matching String.prototype.slice) */
  start: number;
  /** Length of the mention's display text within body */
  length: number;
  /** URN of the mentioned entity (e.g. urn:li:fsd_profile:… or urn:li:fsd_company:…) */
  urn: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  firstReactedAt: number;
  viewerReacted: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderUrn: string;
  senderName: string;
  senderPicture: string;
  body: string;
  createdAt: number;
  isFromMe: boolean;
  status?: 'sending' | 'sent' | 'failed' | 'queued';
  failReason?: string; // user-visible reason when status is 'failed'
  attachments?: MessageAttachment[];
  repliedMessage?: RepliedMessage;
  editedAt?: number;  // timestamp of last edit
  /** Set when the server reports this message as recalled/unsent. Flagged rows
   *  are never STORED — the flag flows through normalize → reconcile so stored
   *  copies get deleted. */
  recalledAt?: number;
  seenAt?: number;    // timestamp when recipient read this message
  reactions?: ReactionSummary[];
  /** @-mentions in body, from LinkedIn's AttributedText attributes. Offsets
   *  are only valid for the body they were extracted with — any path that
   *  replaces body must replace (or clear) mentions too. */
  mentions?: MessageMention[];
}
