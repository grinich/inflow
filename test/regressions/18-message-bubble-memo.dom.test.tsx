// @vitest-environment jsdom
// Guards the MessageBubble React.memo comparator (arePropsEqual). useThread hands
// MessageBubble a fresh message object on every live query, so memoization relies
// on a field-level comparator instead of reference identity. These tests ensure it
// (a) skips re-render for content-identical props and (b) never wrongly skips when
// a rendered field changes — the failure mode that would freeze a bubble's UI.
import '../dom-setup';

// useCachedImage hits the DB/image cache; stub it to passthrough so we can render.
vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

import { render, screen } from '@testing-library/react';
import { arePropsEqual, MessageBubble } from '@/components/thread/MessageBubble';
import { makeMessage } from '../fixtures/factories';

const base = () =>
  makeMessage({
    id: 'urn:li:msg_message:1',
    conversationId: 'c1',
    senderUrn: 'urn:li:fsd_profile:A',
    senderName: 'Ada',
    body: 'hello',
    isFromMe: false,
    createdAt: 1000,
  });

function props(over: Partial<Parameters<typeof MessageBubble>[0]> = {}) {
  return { message: base(), grouped: false, isLastInGroup: false, senderProfileUrl: null, ...over };
}

describe('arePropsEqual', () => {
  it('treats a fresh message object with identical fields as equal (skips render)', () => {
    expect(arePropsEqual(props(), props())).toBe(true);
  });

  it.each([
    ['body', { body: 'changed' }],
    ['status', { status: 'failed' as const }],
    ['failReason', { failReason: 'boom' }],
    ['editedAt', { editedAt: 5 }],
    ['seenAt', { seenAt: 5 }],
    ['senderName', { senderName: 'Grace' }],
    ['senderPicture', { senderPicture: 'x' }],
    ['createdAt', { createdAt: 2000 }],
  ])('detects a change to message.%s', (_label, patch) => {
    const a = props();
    const b = props({ message: makeMessage({ ...base(), ...patch }) });
    expect(arePropsEqual(a, b)).toBe(false);
  });

  it('detects reaction changes (deep)', () => {
    const a = props({ message: makeMessage({ ...base(), reactions: [{ emoji: '👍', count: 1, firstReactedAt: 0, viewerReacted: false }] }) });
    const b = props({ message: makeMessage({ ...base(), reactions: [{ emoji: '👍', count: 2, firstReactedAt: 0, viewerReacted: true }] }) });
    expect(arePropsEqual(a, b)).toBe(false);
  });

  it('detects attachment and repliedMessage changes (deep)', () => {
    const a = props();
    expect(arePropsEqual(a, props({ message: makeMessage({ ...base(), attachments: [{ type: 'image', imageUrl: 'u' }] }) }))).toBe(false);
    expect(arePropsEqual(a, props({ message: makeMessage({ ...base(), repliedMessage: { senderName: 'X', body: 'q' } }) }))).toBe(false);
  });

  it('detects layout / prop changes', () => {
    expect(arePropsEqual(props(), props({ grouped: true }))).toBe(false);
    expect(arePropsEqual(props(), props({ isLastInGroup: true }))).toBe(false);
    expect(arePropsEqual(props(), props({ senderProfileUrl: 'https://x' }))).toBe(false);
  });

  it('detects callback presence changes but ignores callback identity', () => {
    expect(arePropsEqual(props({ onRetry: () => {} }), props({ onRetry: () => {} }))).toBe(true);
    expect(arePropsEqual(props(), props({ onRetry: () => {} }))).toBe(false);
    expect(arePropsEqual(props(), props({ onDelete: () => {} }))).toBe(false);
  });
});

describe('MessageBubble rendering', () => {
  it('links the avatar to the provided senderProfileUrl', () => {
    render(<MessageBubble {...props({ senderProfileUrl: 'https://www.linkedin.com/in/ada' })} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/ada');
  });

  it('renders no profile link when senderProfileUrl is null', () => {
    render(<MessageBubble {...props({ senderProfileUrl: null })} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders voice messages with inline audio controls', () => {
    render(
      <MessageBubble
        {...props({
          message: makeMessage({
            ...base(),
            body: '',
            attachments: [{
              type: 'audio',
              externalUrl: 'https://audio.linkedin.com/voice.m4a',
              fallbackText: 'Voice message',
            }],
          }),
        })}
      />
    );

    const audio = screen.getByLabelText('Voice message') as HTMLAudioElement;
    expect(audio.tagName).toBe('AUDIO');
    expect(audio).toHaveAttribute('controls');
    expect(audio).toHaveAttribute('preload', 'metadata');
    expect(audio).toHaveAttribute('src', 'https://audio.linkedin.com/voice.m4a');
  });

  it('shows an unavailable state when a voice message has no playable URL', () => {
    render(
      <MessageBubble
        {...props({
          message: makeMessage({
            ...base(),
            body: '',
            attachments: [{ type: 'audio', fallbackText: 'Voice message' }],
          }),
        })}
      />
    );

    expect(screen.queryByLabelText('Voice message')).toBeNull();
    expect(screen.getByText('Voice message unavailable')).toBeInTheDocument();
  });
});
