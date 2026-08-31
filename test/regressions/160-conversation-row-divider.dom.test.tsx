// @vitest-environment jsdom
// Conversation rows run edge to edge with nothing between them, while the
// network list separates its rows with a hairline — so the two lists in the
// same app disagreed about whether rows have boundaries.
//
// Worth pinning rather than leaving to taste: a divider is the kind of thing
// that vanishes in a refactor and is then hard to attribute, and the two lists
// should not drift apart again.
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { ConversationRow } from '@/components/conversations/ConversationRow';
import { InvitationRow } from '@/components/network/InvitationRow';
import { makeConversation } from '../fixtures/factories';
import type { Invitation } from '@/types/network';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

function renderConversationRow(selected = false) {
  const conversation = makeConversation({ participantNames: ['Ada Lovelace'] });
  const { container } = render(
    <ConversationRow
      conversation={conversation}
      selected={selected}
      index={0}
      onOpen={() => {}}
      draftText=""
      draftAttachmentCount={0}
      hasFailed={false}
      timeTick={0}
    />
  );
  return container.querySelector('[data-conversation-id]') ?? container.firstElementChild!;
}

const invitation: Invitation = {
  id: 'i1', sharedSecret: 's', fromUrn: 'urn:li:fsd_profile:p1', name: 'Grace Hopper',
  headline: 'Rear Admiral', pictureUrl: '', publicId: 'grace', message: '',
  sentAt: 1_750_000_000_000, status: 'pending', mutualCount: 0, mutualNames: [],
};

describe('regression #160: rows are separated in both lists', () => {
  it('draws a divider under a conversation row', () => {
    const row = renderConversationRow();

    expect(row.className).toContain('border-b');
    expect(row.className).toContain('border-edge');
  });

  it('keeps the divider on the selected row', () => {
    // The selected row swaps its background; it must not lose its boundary.
    const row = renderConversationRow(true);

    expect(row.className).toContain('border-b');
    expect(row.className).toContain('bg-surface-active');
  });

  it('insets the avatar the same in both lists', () => {
    // The conversation row reserves a 16px column for the unread/star mark
    // before the avatar. Network rows had no equivalent, so their avatars sat
    // further left and the two lists did not line up.
    const { container } = render(
      <InvitationRow invitation={invitation} selected={false} onSelect={() => {}} />
    );
    const networkRow = container.querySelector('[data-network-row]')!;

    for (const row of [networkRow, renderConversationRow()]) {
      expect(row.className).toContain('gap-1.5');
      expect(row.className).toContain('py-3');
      expect(row.className).toContain('pl-1.5');
      expect(row.querySelector('.w-4.shrink-0')).toBeTruthy();
    }
  });

  it('does not bold the name in the network list', () => {
    // Over in the inbox, weight means unread. Bolding every network name
    // borrows that meaning to say nothing.
    const { container } = render(
      <InvitationRow invitation={invitation} selected={false} onSelect={() => {}} />
    );
    const name = [...container.querySelectorAll('span')].find((el) => el.textContent === 'Grace Hopper')!;

    expect(name.className).not.toContain('font-semibold');
    expect(name.className).toContain('text-sm');
    expect(name.className).toContain('text-fg-secondary');
  });

  it('uses the same divider the network list uses', () => {
    const { container } = render(
      <InvitationRow invitation={invitation} selected={false} onSelect={() => {}} />
    );
    const networkRow = container.querySelector('[data-network-row]')!;

    expect(networkRow.className).toContain('border-b border-edge');
    expect(renderConversationRow().className).toContain('border-b border-edge');
  });
});
