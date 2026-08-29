// @vitest-environment jsdom
/**
 * The shortcuts pane carries its own close button, so it can be dismissed by
 * pointer as well as by key. The Esc hint was dropped from the header (Esc
 * still closes it — see useKeyboard); the `?` hint stays, because `?` is the
 * only way to reopen the pane and is worth teaching.
 */
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutOverlay } from '@/components/common/ShortcutOverlay';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  useUIStore.setState({ shortcutOverlayOpen: true });
});

describe('shortcuts pane header', () => {
  it('closes the pane when the close button is clicked', async () => {
    render(<ShortcutOverlay />);

    const close = screen.getByRole('button', { name: /close shortcuts/i });
    await userEvent.click(close);

    expect(useUIStore.getState().shortcutOverlayOpen).toBe(false);
  });

  it('puts the close button before the heading', () => {
    render(<ShortcutOverlay />);

    const close = screen.getByRole('button', { name: /close shortcuts/i });
    const heading = screen.getByRole('heading', { name: /shortcuts/i });
    // Node.DOCUMENT_POSITION_FOLLOWING: the heading comes after the button.
    expect(close.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('keeps the ? hint in the header and drops the Esc one', () => {
    render(<ShortcutOverlay />);
    const header = screen.getByRole('heading', { name: /shortcuts/i }).parentElement!;

    expect(header.textContent).toContain('?');
    // Scoped to the header on purpose: Esc is still a listed shortcut ("Go
    // back") in the columns below, and still closes the pane.
    expect(header.textContent).not.toMatch(/Esc/);
  });
});
