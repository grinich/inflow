export interface BridgeAttachment {
  name: string;
  type: string;       // MIME type
  size: number;
  dataBase64: string;  // base64-encoded file content
}

export type BridgeMessage =
  | { type: 'CHECK_AUTH' }
  | { type: 'SYNC_CONVERSATIONS' }
  | { type: 'SYNC_CATEGORY'; category: string }
  | { type: 'FETCH_MESSAGES'; conversationId: string }
  | { type: 'SEND_MESSAGE'; conversationId: string; body: string; attachments?: BridgeAttachment[]; replyTo?: { messageUrn: string; senderUrn: string; sentAt: number; body: string } }
  | { type: 'ARCHIVE'; conversationId: string }
  | { type: 'UNARCHIVE'; conversationId: string }
  | { type: 'MOVE_TO_OTHER'; conversationId: string }
  | { type: 'MOVE_TO_FOCUSED'; conversationId: string }
  | { type: 'MARK_READ'; conversationId: string }
  | { type: 'MARK_UNREAD'; conversationId: string }
  | { type: 'MOVE_TO_SPAM'; conversationId: string }
  | { type: 'FETCH_PROFILE_BY_URN'; urn: string }
  | { type: 'GET_DEBUG_LOGS' }
  | { type: 'CLEAR_DEBUG_LOGS' }
  | { type: 'RESET_DB' }
  | { type: 'DIAGNOSTIC_SYNC' }
  | { type: 'GET_SYNC_PROGRESS' }
  | { type: 'RESET_SYNC_STATE' }
  | { type: 'FETCH_POST'; activityUrn: string }
  | { type: 'BURST_DISCOVER'; category: string }
  | { type: 'SEARCH_CONVERSATIONS'; query: string; cursor?: string }
  | { type: 'DELETE_CONVERSATION'; conversationId: string }
  | { type: 'STAR'; conversationId: string }
  | { type: 'UNSTAR'; conversationId: string }
  | { type: 'EDIT_MESSAGE'; conversationId: string; messageId: string; body: string }
  | { type: 'TYPEAHEAD_SEARCH'; query: string }
  | { type: 'CREATE_CONVERSATION'; recipientUrns: string[]; body: string; attachments?: BridgeAttachment[] }
  | { type: 'TOGGLE_SYNC_PAUSE' }
  | { type: 'REEVAL_BACKFILL_WINDOW' }
  | { type: 'PREFETCH_MESSAGES'; conversationIds: string[] };

export type BridgeResponse = {
  success: boolean;
  data?: any;
  error?: string;
};

export function sendBridgeMessage(message: BridgeMessage): Promise<BridgeResponse> {
  return chrome.runtime.sendMessage(message);
}
