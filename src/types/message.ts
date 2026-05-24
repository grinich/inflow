export interface MessageAttachment {
  type: 'image' | 'gif' | 'file' | 'video' | 'audio' | 'sharedPost' | 'externalMedia' | 'unknown';
  /** Image URL (for type=image and type=gif) */
  imageUrl?: string;
  /** File name (for type=file) */
  fileName?: string;
  /** File URL (for type=file) */
  fileUrl?: string;
  /** File size in bytes */
  fileSize?: number;
  /** MIME type */
  mimeType?: string;
  /** LinkedIn post activity URN (for type=sharedPost) */
  postUrn?: string;
  /** External media URL */
  externalUrl?: string;
  /** Fallback text description */
  fallbackText?: string;
  /** Original dimensions (for type=gif) */
  width?: number;
  height?: number;
}

export interface RepliedMessage {
  senderName: string;
  body: string;
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
  status?: 'sending' | 'sent' | 'failed';
  failReason?: string; // user-visible reason when status is 'failed'
  attachments?: MessageAttachment[];
  repliedMessage?: RepliedMessage;
  editedAt?: number;  // timestamp of last edit
  seenAt?: number;    // timestamp when recipient read this message
}
