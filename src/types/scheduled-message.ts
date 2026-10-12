export type ScheduledStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

/**
 * A message drafted (usually by Claude) that the user will send manually or on a
 * schedule. Lives entirely in the app: Claude only writes the `body`; storing,
 * scheduling, and sending are local (IndexedDB + background alarm + LinkedIn).
 */
export interface ScheduledMessage {
  id: string;
  /** Recipient profile URN(s). A single urn for a 1:1. */
  recipientUrns: string[];
  /**
   * Existing thread to send into. When set, sending goes through SEND_MESSAGE
   * (a reply); when absent, through CREATE_CONVERSATION (a brand-new outbound
   * message keyed on `recipientUrns`).
   */
  conversationId?: string;
  /** Display name for the queue. */
  recipientName: string;
  body: string;
  status: ScheduledStatus;
  /** Epoch ms to send; set when status is 'scheduled'. */
  scheduledAt?: number;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
  /** Human-readable failure reason when status is 'failed'. */
  error?: string;
  /**
   * Subject line, set only when this goes out as a Premium InMail (the
   * recipient is not a connection). Its presence is what marks the queued
   * message as an InMail, so sending it later spends a credit exactly as it
   * would have at compose time.
   */
  inMailSubject?: string;
}
