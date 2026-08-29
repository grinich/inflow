// @vitest-environment jsdom
/**
 * The inflow mark in the sidebar header links to the marketing site. It must
 * target _top: inside the inflow.im/app shell the app runs in an iframe, and
 * a plain link would render the homepage inside the frame instead of leaving
 * the app. Standalone (extension tab), _top is a normal same-tab navigation.
 */
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { ConversationListHeader } from '@/components/conversations/ConversationListHeader';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn() }));

describe('sidebar logo', () => {
  it('links to inflow.im/home escaping the shell iframe', () => {
    render(<ConversationListHeader />);
    const link = screen.getByRole('link', { name: /in.*ƒlow/ });
    expect(link).toHaveAttribute('href', 'https://inflow.im/home');
    expect(link).toHaveAttribute('target', '_top');
  });
});
