// @vitest-environment jsdom
// Coverage for ui-store actions with real logic: tab switching with per-tab
// selection memory, the toast/undo lifecycle, thread open/close, index clamping,
// toggles, and theme cycling.
import '../dom-setup';
import { useUIStore } from '@/store/ui-store';
import { makeMessage } from '../fixtures/factories';

beforeEach(() => {
  useUIStore.setState({
    inboxTab: 'focused',
    tabMemory: {},
    _pendingRestore: null,
    selectedConversationId: null,
    selectedIndex: 0,
    searchQuery: '',
    viewMode: 'list',
    toast: null,
    lastUndoAction: null,
    lastUndoConversationId: null,
    composeActive: false,
    composeNewActive: false,
    paletteOpen: false,
    shortcutOverlayOpen: false,
    replyingTo: null,
  });
});

const s = () => useUIStore.getState();

describe('setInboxTab + tab memory', () => {
  it('saves the current tab selection and restores the target tab on return', () => {
    s().setSelectedConversationId('conv-a');
    s().setSelectedIndex(3);

    s().setInboxTab('other');
    expect(s().inboxTab).toBe('other');
    expect(s().selectedConversationId).toBeNull(); // no memory for "other" yet
    expect(s().selectedIndex).toBe(0);
    expect(s().searchQuery).toBe(''); // cleared on tab switch
    expect(s().tabMemory.focused).toEqual({ conversationId: 'conv-a', index: 3 });

    // Pick something in "other", then go back to focused.
    s().setSelectedConversationId('conv-b');
    s().setSelectedIndex(1);
    s().setInboxTab('focused');
    expect(s().selectedConversationId).toBe('conv-a');
    expect(s().selectedIndex).toBe(3);
    expect(s()._pendingRestore).toEqual({ conversationId: 'conv-a', index: 3 });
  });

  it('is a no-op when switching to the current tab', () => {
    s().setSelectedConversationId('keep');
    s().setInboxTab('focused');
    expect(s().selectedConversationId).toBe('keep'); // unchanged
    expect(s().tabMemory).toEqual({});
  });
});

describe('toast + undo lifecycle', () => {
  it('showToast sets the toast and undo state; dismissToast clears both', () => {
    const undo = () => {};
    s().showToast({ message: 'Archived', undoAction: undo, undoConversationId: 'c1' });
    expect(s().toast?.message).toBe('Archived');
    expect(s().toast?.id).toBeTruthy();
    expect(s().lastUndoAction).toBe(undo);
    expect(s().lastUndoConversationId).toBe('c1');

    s().dismissToast();
    expect(s().toast).toBeNull();
    expect(s().lastUndoAction).toBeNull();
    expect(s().lastUndoConversationId).toBeNull();
  });

  it('clearLastUndo clears only the undo state, not the toast', () => {
    s().showToast({ message: 'x', undoAction: () => {}, undoConversationId: 'c1' });
    s().clearLastUndo();
    expect(s().lastUndoAction).toBeNull();
    expect(s().toast).not.toBeNull();
  });
});

describe('thread open/close', () => {
  it('openThread enters thread mode and selects; closeThread returns to list', () => {
    s().setComposeActive(true);
    s().openThread('c1', 2);
    expect(s().viewMode).toBe('thread');
    expect(s().selectedConversationId).toBe('c1');
    expect(s().selectedIndex).toBe(2);
    expect(s().composeActive).toBe(false);

    s().closeThread();
    expect(s().viewMode).toBe('list');
    expect(s().selectedConversationId).toBeNull();
  });
});

describe('misc actions', () => {
  it('setSelectedIndex clamps to >= 0', () => {
    s().setSelectedIndex(-5);
    expect(s().selectedIndex).toBe(0);
    s().setSelectedIndex(4);
    expect(s().selectedIndex).toBe(4);
  });

  it('toggles flip boolean flags', () => {
    expect(s().paletteOpen).toBe(false);
    s().togglePalette();
    expect(s().paletteOpen).toBe(true);
    s().togglePalette();
    expect(s().paletteOpen).toBe(false);

    s().toggleShortcutOverlay();
    expect(s().shortcutOverlayOpen).toBe(true);
  });

  it('setReplyingTo stores and clears the reply target', () => {
    const msg = makeMessage({ id: 'reply-1' });
    s().setReplyingTo(msg);
    expect(s().replyingTo?.id).toBe('reply-1');
    s().setReplyingTo(null);
    expect(s().replyingTo).toBeNull();
  });

  it('cycleTheme cycles dark -> light -> system -> dark', () => {
    s().setTheme('dark');
    s().cycleTheme();
    expect(s().theme).toBe('light');
    s().cycleTheme();
    expect(s().theme).toBe('system');
    s().cycleTheme();
    expect(s().theme).toBe('dark');
  });
});
