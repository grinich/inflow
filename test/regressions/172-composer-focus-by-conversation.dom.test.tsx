// @vitest-environment jsdom
// Accepting an invitation drops you into the reply box, and twice it did not
// work: the first character typed went nowhere, and the half-written reply
// vanished when the real thread replaced the placeholder.
//
// Both came from identifying the composer as "the first element with
// data-compose-input" rather than "the composer for this conversation".
// Focusing polled for any such element and focused the first hit — possibly
// another thread's box, and only once, so the swap left it unfocused. The
// draft carried across the swap was read the same loose way.
//
// The attribute now carries the conversation id, focus is requested BY
// conversation and claimed by the composer itself when it mounts, and the
// draft is read from the named box.
import '../dom-setup';

import Dexie from 'dexie';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';
import { useUIStore } from '@/store/ui-store';

let testDb: any;

const mockSendMessage = vi.fn();
const mockSendAndArchive = vi.fn();

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    sendMessage: mockSendMessage,
    sendAndArchive: mockSendAndArchive,
    archiveConversation: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({
    suggestion: null,
    accept: vi.fn(),
    dismiss: vi.fn(),
    isOpen: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({
    suggestions: [],
    isLoading: false,
    clear: vi.fn(),
  }),
}));

beforeEach(async () => {
  testDb = new Dexie(`NamedComposer_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendMessage.mockReset().mockResolvedValue(true);
  mockSendAndArchive.mockReset();
  useUIStore.setState({ composerFocusFor: null, composeActive: false, replyingTo: null });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function mount(convId: string) {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  await testDb.conversations.put(makeConversation({ id: convId }));
  const view = render(
    <ComposeBox conversationId={convId} messages={[]} participantNames={['Someone']} />
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return view;
}

const boxFor = (id: string) =>
  document.querySelector(`[data-compose-input="${id}"]`) as HTMLTextAreaElement | null;

describe('regression #172: the reply box is addressed by conversation', () => {
  it('names its conversation on the element', () => {
    // Everything else here depends on this: without it, "the composer for this
    // conversation" is not a thing that can be looked up.
    return mount('conv-1').then(() => {
      expect(boxFor('conv-1')).toBeTruthy();
    });
  });

  it('takes the cursor when asked for by conversation', async () => {
    await mount('conv-1');

    await act(async () => { useUIStore.getState().requestComposerFocus('conv-1'); });

    expect(document.activeElement).toBe(boxFor('conv-1'));
  });

  it('does not hand the cursor to a different conversation’s box', async () => {
    // The old poll focused the first composer in the DOM. If the thread being
    // jumped to had not rendered yet, that was somebody else's reply box — and
    // the reply went to them.
    await mount('someone-else');

    await act(async () => { useUIStore.getState().requestComposerFocus('the-target'); });

    expect(document.activeElement).not.toBe(boxFor('someone-else'));
  });

  it('claims a request made before it existed', async () => {
    // The whole reason the first character went missing: the request is made
    // while the network view is still up and the box does not exist yet.
    await act(async () => { useUIStore.getState().requestComposerFocus('arrives-later'); });

    await mount('arrives-later');

    expect(document.activeElement).toBe(boxFor('arrives-later'));
  });

  it('claims it again after being remounted', async () => {
    // The placeholder → real thread swap rebuilds the composer. A one-shot
    // focus does not survive that, which is the second half of the report.
    await act(async () => { useUIStore.getState().requestComposerFocus('conv-1'); });
    const first = await mount('conv-1');
    first.unmount();

    await act(async () => { useUIStore.getState().requestComposerFocus('conv-1'); });
    await mount('conv-1');

    expect(document.activeElement).toBe(boxFor('conv-1'));
  });

  it('lets the request outlive a composer it was not meant for', async () => {
    // An unrelated composer unmounting must not cancel a focus meant for the
    // thread arriving next.
    await act(async () => { useUIStore.getState().requestComposerFocus('the-target'); });
    const other = await mount('someone-else');

    other.unmount();

    expect(useUIStore.getState().composerFocusFor).toBe('the-target');
  });

  it('flushes what is typed to the conversation the draft was handed to', async () => {
    // The swap replaces the placeholder thread with the real one. Copying the
    // text across beforehand meant reading the box at some earlier moment and
    // losing everything typed after that read — the box visibly cleared under
    // anyone still typing. The flush happens as the box goes away instead.
    const view = await mount('draft-PERSON');
    const box = boxFor('draft-PERSON')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'half a reply' } }); });

    await act(async () => { useUIStore.getState().carryDraftAcross('draft-PERSON', 'conv-real'); });
    await act(async () => { view.unmount(); });

    expect((await testDb.draftAttachments.get('conv-real'))?.text).toBe('half a reply');
  });

  it('carries the LAST keystroke, not the state at some earlier read', async () => {
    // The reported failure in one line: "the text I typed gets cleared and is
    // gone if I'm still typing".
    const view = await mount('draft-PERSON');
    const box = boxFor('draft-PERSON')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'half a' } }); });
    await act(async () => { useUIStore.getState().carryDraftAcross('draft-PERSON', 'conv-real'); });

    // Still typing after the handover was arranged.
    await act(async () => { fireEvent.change(box, { target: { value: 'half a reply, finished' } }); });
    await act(async () => { view.unmount(); });

    expect((await testDb.draftAttachments.get('conv-real'))?.text).toBe('half a reply, finished');
  });

  it('leaves the destination alone when nothing was typed', async () => {
    // A forced empty write would DELETE the destination's row — and the real
    // thread can have a draft of its own.
    await testDb.draftAttachments.put({
      conversationId: 'conv-real', text: 'written earlier', files: [], names: [], types: [],
    });
    const view = await mount('draft-PERSON');

    await act(async () => { useUIStore.getState().carryDraftAcross('draft-PERSON', 'conv-real'); });
    await act(async () => { view.unmount(); });

    expect((await testDb.draftAttachments.get('conv-real'))?.text).toBe('written earlier');
  });

  it('still saves normally when no handover was asked for', async () => {
    // The ordinary case: leaving a thread keeps its own draft.
    const view = await mount('conv-1');
    const box = boxFor('conv-1')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'come back to this' } }); });

    await act(async () => { view.unmount(); });

    expect((await testDb.draftAttachments.get('conv-1'))?.text).toBe('come back to this');
  });

  it('clears the request once claimed, so it cannot steal focus later', async () => {
    await mount('conv-1');

    await act(async () => { useUIStore.getState().requestComposerFocus('conv-1'); });

    expect(useUIStore.getState().composerFocusFor).toBeNull();
  });
});
