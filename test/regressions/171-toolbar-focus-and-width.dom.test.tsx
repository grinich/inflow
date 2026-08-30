// @vitest-environment jsdom
// Two problems in the same toolbar row.
//
// The folder selector was a four-button segmented control above 352px and a
// dropdown below it. At the widths people actually use, those four buttons
// plus Unread, Network and compose did not fit, and the row wrapped. It is a
// dropdown at every width now.
//
// And the focus ring sat on whatever you last clicked. The CSS already limits
// rings to :focus-visible, but Chrome re-evaluates the modality on every
// keypress: a button you CLICKED becomes keyboard-focused as soon as you press
// a key, which in an app driven by 1/2/3 is immediately. Clicking Unread and
// then switching folders with a number left the ring on Unread.
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';
import { keyboardFocusOnly } from '@/lib/focus-on-keyboard-only';

describe('regression #171: the folder selector is always a dropdown', () => {
  it('renders no segmented folder buttons', async () => {
    const { ConversationListHeader } = await import(
      '@/components/conversations/ConversationListHeader'
    );
    render(<ConversationListHeader />);

    // Every folder lives in the select; none is its own button.
    for (const label of ['Focused', 'Other', 'Archive', 'Spam']) {
      const hit = screen.getByText(label);
      expect(hit.tagName).toBe('OPTION');
    }
  });

  it('offers every folder in one dropdown', async () => {
    const { ConversationListHeader } = await import(
      '@/components/conversations/ConversationListHeader'
    );
    render(<ConversationListHeader />);

    const select = screen.getByLabelText('Folder') as HTMLSelectElement;

    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Focused', 'Other', 'Archive', 'Spam',
    ]);
  });

  it('does not depend on the pane being wide enough', async () => {
    // The container query was the whole mechanism; if it comes back, so does
    // the wrapping.
    const { ConversationListHeader } = await import(
      '@/components/conversations/ConversationListHeader'
    );
    const { container } = render(<ConversationListHeader />);

    expect(container.innerHTML).not.toContain('@min-[');
    expect(container.innerHTML).not.toContain('@container');
  });
});

describe('regression #171: clicks do not park focus on a toolbar button', () => {
  it('prevents the default on mousedown, so the pointer cannot focus it', () => {
    render(
      <button {...keyboardFocusOnly} onClick={() => {}}>
        Unread
      </button>
    );
    const button = screen.getByText('Unread');

    // fireEvent.mouseDown returns false when a handler called preventDefault.
    const notPrevented = fireEvent.mouseDown(button);

    expect(notPrevented).toBe(false);
  });

  it('leaves keyboard focus alone', () => {
    // Tab must still reach it, and Enter must still activate it WITH a ring —
    // that is the case the ring exists for.
    const onClick = vi.fn();
    render(
      <button {...keyboardFocusOnly} onClick={onClick}>
        Unread
      </button>
    );
    const button = screen.getByText('Unread') as HTMLButtonElement;

    button.focus();
    fireEvent.click(button);

    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalled();
  });

  it('is applied to the buttons that sit next to the folder selector', async () => {
    const { ConversationListHeader } = await import(
      '@/components/conversations/ConversationListHeader'
    );
    render(<ConversationListHeader />);

    for (const label of ['Unread', 'Network']) {
      expect(fireEvent.mouseDown(screen.getByText(label))).toBe(false);
    }
  });

  it('hands focus back after picking a folder', async () => {
    // The select is not a button, so it takes focus on click by design — but
    // it must not keep it, or the next number keypress rings it.
    const { ConversationListHeader } = await import(
      '@/components/conversations/ConversationListHeader'
    );
    render(<ConversationListHeader />);
    const select = screen.getByLabelText('Folder') as HTMLSelectElement;
    select.focus();

    fireEvent.change(select, { target: { value: 'archived' } });

    expect(document.activeElement).not.toBe(select);
  });
});
