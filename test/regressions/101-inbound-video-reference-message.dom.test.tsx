// @vitest-environment jsdom
// Regression: LinkedIn delivers received videos as a `*video` REFERENCE to a
// com.linkedin.videocontent.VideoPlayMetadata entity in included[] — not as an
// inline `video` object. extractAttachments only handled the inline shape, so
// a video message produced no attachment; with an empty body, MessageBubble
// rendered nothing and the message was invisible (worst when the video was the
// only/first message in a conversation: the thread looked empty). The
// conversation-list preview was blank for the same reason.
import '../dom-setup';

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render } from '@testing-library/react';
import { normalizeMessages, normalizeConversations } from '@/lib/voyager-normalizer';
import { MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';
import type { VoyagerResponse } from '../../entrypoints/background/api/types';

const STREAM_URL = 'https://www.linkedin.com/dms/prv/vid/v2/D4E23AQF/video.mp4';
const THUMB_URL = 'https://www.linkedin.com/dms/prv/image/v2/D4E23AQF/thumb.jpg';

// Real shape observed from messengerMessages: the message's renderContent item
// is only {"*video": urn}, and the metadata lives in included[] with rootUrl=''
// and the full thumbnail URL inside fileIdentifyingUrlPathSegment.
const videoPlayMetadata = {
  $type: 'com.linkedin.videocontent.VideoPlayMetadata',
  entityUrn: 'urn:li:digitalmediaAsset:D4E23AQF',
  media: 'urn:li:digitalmediaAsset:D4E23AQF',
  duration: 34775,
  aspectRatio: 1.7777778,
  thumbnail: {
    $type: 'com.linkedin.common.VectorImage',
    rootUrl: '',
    artifacts: [
      { width: 1280, height: 720, fileIdentifyingUrlPathSegment: THUMB_URL },
    ],
  },
  progressiveStreams: [
    {
      streamingLocations: [{ url: STREAM_URL, expiresAt: null }],
      size: 4692697,
      bitRate: 946575,
      width: 640,
      height: 360,
      mediaType: 'video/mp4',
    },
  ],
  adaptiveStreams: [],
};

function makeVideoMessageEntity(overrides: Record<string, any> = {}) {
  return {
    $type: 'com.linkedin.messenger.Message',
    entityUrn: 'urn:li:msg_message:(2-conv,100)',
    '*sender': 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OSCAR',
    body: { text: '' },
    deliveredAt: 1787297149024,
    renderContent: [{ '*video': videoPlayMetadata.entityUrn }],
    ...overrides,
  };
}

describe('normalizeMessages() with a *video reference', () => {
  it('resolves the VideoPlayMetadata entity into a video attachment', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [makeVideoMessageEntity(), videoPlayMetadata],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages).toHaveLength(1);
    expect(messages[0].attachments).toHaveLength(1);
    const att = messages[0].attachments![0];
    expect(att.type).toBe('video');
    expect(att.externalUrl).toBe(STREAM_URL);
    expect(att.imageUrl).toBe(THUMB_URL);
    expect(att.durationMs).toBe(34775);
  });

  it('still yields a video attachment when the reference cannot be resolved', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [makeVideoMessageEntity()], // metadata entity missing
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments![0].type).toBe('video');
    expect(messages[0].attachments![0].fallbackText).toBe('Video');
  });
});

describe('conversation-list preview for a *video-only last message', () => {
  it('falls back to "Sent a video"', () => {
    const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-conv)';
    const response: VoyagerResponse = {
      data: {},
      included: [
        makeVideoMessageEntity({ '*conversation': convUrn }),
        videoPlayMetadata,
        {
          $type: 'com.linkedin.messenger.Conversation',
          entityUrn: convUrn,
          '*conversationParticipants': [],
          lastActivityAt: 1787297149024,
          unreadCount: 1,
          categories: ['INBOX', 'PRIMARY_INBOX'],
        },
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].lastMessage).toBe('Sent a video');
  });
});

describe('MessageBubble with a body-less inbound video message', () => {
  it('renders the video (was: rendered nothing at all)', () => {
    const message = makeMessage({
      id: 'urn:li:msg_message:(2-conv,100)',
      body: '',
      isFromMe: false,
      attachments: [
        {
          type: 'video',
          externalUrl: STREAM_URL,
          imageUrl: THUMB_URL,
          durationMs: 34775,
          width: 1280,
          height: 720,
          fallbackText: 'Video',
        },
      ],
    });

    const { container } = render(
      <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
    );

    const link = container.querySelector(`a[href="${STREAM_URL}"]`);
    expect(link).not.toBeNull();
    const thumb = link!.querySelector('img');
    expect(thumb?.getAttribute('src')).toBe(THUMB_URL);
    expect(link!.textContent).toContain('0:35'); // duration badge
  });

  it('renders a "Video" chip when there is no thumbnail (unresolved reference)', () => {
    const message = makeMessage({
      id: 'urn:li:msg_message:(2-conv,101)',
      body: '',
      isFromMe: false,
      attachments: [{ type: 'video', fallbackText: 'Video' }],
    });

    const { container } = render(
      <MessageBubble message={message} grouped={false} isLastInGroup={false} senderProfileUrl={null} />
    );

    expect(container.textContent).toContain('Video');
  });
});
