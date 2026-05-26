import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';
import type { Profile } from '@/types/profile';
import type { PendingAction, SyncState, SyncQueueItem } from '@/db/database';

let convCounter = 0;
export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  convCounter++;
  return {
    id: `2-conv-${convCounter}`,
    participantUrns: [`urn:li:fsd_profile:participant-${convCounter}`],
    participantNames: [`User ${convCounter}`],
    participantPictures: [''],
    lastMessage: `Message ${convCounter}`,
    lastActivityAt: Date.now() - convCounter * 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...overrides,
  };
}

let msgCounter = 0;
export function makeMessage(overrides: Partial<Message> = {}): Message {
  msgCounter++;
  return {
    id: `urn:li:msg_message:msg-${msgCounter}`,
    conversationId: '2-conv-1',
    senderUrn: `urn:li:fsd_profile:sender-${msgCounter}`,
    senderName: `Sender ${msgCounter}`,
    senderPicture: '',
    body: `Test message ${msgCounter}`,
    createdAt: Date.now() - msgCounter * 1000,
    isFromMe: false,
    ...overrides,
  };
}

let profileCounter = 0;
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  profileCounter++;
  return {
    urn: `urn:li:fsd_profile:profile-${profileCounter}`,
    publicId: `profile${profileCounter}`,
    firstName: `First${profileCounter}`,
    lastName: `Last${profileCounter}`,
    fullName: `First${profileCounter} Last${profileCounter}`,
    occupation: 'Engineer',
    location: 'San Francisco',
    pictureUrl: '',
    ...overrides,
  };
}

let actionCounter = 0;
export function makePendingAction(overrides: Partial<PendingAction> = {}): PendingAction {
  actionCounter++;
  return {
    id: `action-${actionCounter}`,
    type: 'archive',
    conversationId: `2-conv-${actionCounter}`,
    status: 'queued',
    timestamp: Date.now() - actionCounter * 100,
    ...overrides,
  };
}

export function makeSyncQueueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    conversationId: '2-conv-1',
    category: 'PRIMARY_INBOX',
    lastActivityAt: Date.now(),
    messagesSyncedAt: 0,
    status: 'pending',
    failCount: 0,
    lastFailedAt: 0,
    priority: Number.MAX_SAFE_INTEGER - Date.now(),
    ...overrides,
  };
}

export function makeSyncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    category: 'PRIMARY_INBOX',
    phase: 'idle',
    cursor: '',
    totalDiscovered: 0,
    discoveryCompletedAt: 0,
    lastSyncStartedAt: 0,
    lastSyncCompletedAt: 0,
    ...overrides,
  };
}

export function resetFactories() {
  convCounter = 0;
  msgCounter = 0;
  profileCounter = 0;
  actionCounter = 0;
}
