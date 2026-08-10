/**
 * The fixed set of role categories the AI classifier sorts connections into.
 * Kept small and stable so the filter UI stays predictable. `Other` is the
 * catch-all when nothing fits (or the AI is unsure).
 */
export const ROLE_CATEGORIES = [
  'Investor',
  'Founder',
  'Executive',
  'Engineering',
  'Product',
  'Design',
  'Sales & BD',
  'Marketing',
  'Recruiting',
  'Operations',
  'Other',
] as const;

export type ConnectionRole = (typeof ROLE_CATEGORIES)[number];

/**
 * A first-degree LinkedIn connection, denormalized for display in the
 * "Recent connections" list. One row per person, keyed by their profile URN.
 */
export interface Connection {
  /** The connected person's profile URN — natural key (one row per person). */
  profileUrn: string;
  /** LinkedIn's connection entity URN (urn:li:fsd_connection:…). */
  connectionUrn: string;
  /** Epoch ms when the connection was established (LinkedIn's `createdAt`). */
  connectedAt: number;
  /** Public identifier for the /in/<publicId> profile URL (may be empty). */
  publicId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  /** LinkedIn headline (occupation line). */
  headline: string;
  pictureUrl: string;
  /** Epoch ms when this row was last written locally. */
  syncedAt: number;

  // --- AI categorization (populated after sync by the classifier) -----------
  /** The single role bucket the AI assigned (undefined = not categorized yet). */
  roleCategory?: ConnectionRole;
  /** User-defined interest tags the AI decided apply to this person. */
  interestTags?: string[];
  /** Epoch ms of the last AI categorization; falsy = needs (re)categorizing. */
  categorizedAt?: number;

  /** AI-generated one-line summary shown in the detail pane. */
  aiSummary?: string;
  /** Epoch ms the summary was generated; falsy = not summarized yet. */
  summarizedAt?: number;

  // --- Conversation summary (AI recap of the message history) ----------------
  /** AI recap of the message thread with this person (empty = none yet). */
  conversationSummary?: string;
  /** Epoch ms the conversation summary was generated. */
  conversationSummaryAt?: number;
  /** lastActivityAt of the thread when it was summarized. If the thread's
   *  current lastActivityAt is newer, the summary is stale (new messages since). */
  conversationSummaryLastMsgAt?: number;
}
