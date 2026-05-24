export type KeyContext = 'global' | 'list' | 'thread' | 'compose';

export interface Shortcut {
  key: string;
  context: KeyContext | KeyContext[];
  description: string;
  handler: (e: KeyboardEvent) => void;
  meta?: boolean;
  shift?: boolean;
}

class KeyboardManager {
  private shortcuts: Shortcut[] = [];
  private contextStack: KeyContext[] = ['global', 'list'];

  register(shortcut: Shortcut) {
    this.shortcuts.push(shortcut);
  }

  registerAll(shortcuts: Shortcut[]) {
    this.shortcuts.push(...shortcuts);
  }

  clear() {
    this.shortcuts = [];
  }

  pushContext(context: KeyContext) {
    if (!this.contextStack.includes(context)) {
      this.contextStack.push(context);
    }
  }

  popContext(context: KeyContext) {
    this.contextStack = this.contextStack.filter((c) => c !== context);
  }

  setContext(contexts: KeyContext[]) {
    this.contextStack = contexts;
  }

  getActiveContexts(): KeyContext[] {
    return [...this.contextStack];
  }

  getShortcuts(): Shortcut[] {
    return [...this.shortcuts];
  }

  handleKeyDown = (e: KeyboardEvent) => {
    // Don't intercept when typing in inputs (unless compose-specific)
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (isInput && !this.contextStack.includes('compose')) {
      return;
    }

    for (const shortcut of this.shortcuts) {
      const contexts = Array.isArray(shortcut.context) ? shortcut.context : [shortcut.context];
      const isActiveContext = contexts.some((c) => this.contextStack.includes(c));
      if (!isActiveContext) continue;

      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
      const metaMatch = shortcut.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

      // Special case: allow Enter in compose without special matching
      if (shortcut.key === 'Enter' && contexts.includes('compose') && isInput) {
        if (keyMatch && (shortcut.meta ? (e.metaKey || e.ctrlKey) : true)) {
          e.preventDefault();
          shortcut.handler(e);
          return;
        }
      }

      if (keyMatch && metaMatch && shiftMatch && !isInput) {
        e.preventDefault();
        shortcut.handler(e);
        return;
      }

      // Allow meta shortcuts even in inputs
      if (keyMatch && shortcut.meta && (e.metaKey || e.ctrlKey) && shiftMatch) {
        e.preventDefault();
        shortcut.handler(e);
        return;
      }
    }
  };

  attach() {
    document.addEventListener('keydown', this.handleKeyDown);
  }

  detach() {
    document.removeEventListener('keydown', this.handleKeyDown);
  }
}

export const keyboardManager = new KeyboardManager();
