// Voyager API response types — loosely typed since LinkedIn's API is undocumented

export interface VoyagerResponse {
  data: any;
  included: VoyagerEntity[];
  paging?: {
    count: number;
    start: number;
    total: number;
  };
}

export interface VoyagerEntity {
  $type: string;
  entityUrn: string;
  [key: string]: any;
}

export interface VoyagerConversation {
  entityUrn: string;
  lastActivityAt: number;
  read: boolean;
  archived: boolean;
  categories: string[];
  participants: string[];
  events: string[];
}

export interface VoyagerMessagingEvent {
  entityUrn: string;
  createdAt: number;
  subtype: string;
  eventContent: {
    'com.linkedin.voyager.messaging.event.MessageEvent'?: {
      body: string;
      attachments?: any[];
    };
  };
  from: {
    'com.linkedin.voyager.messaging.MessagingMember': {
      miniProfile: VoyagerMiniProfile;
    };
  };
}

export interface VoyagerMiniProfile {
  entityUrn: string;
  publicIdentifier: string;
  firstName: string;
  lastName: string;
  occupation: string;
  picture?: {
    'com.linkedin.common.VectorImage': {
      rootUrl: string;
      artifacts: Array<{
        width: number;
        height: number;
        fileIdentifyingUrlPathSegment: string;
      }>;
    };
  };
}
