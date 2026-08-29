/**
 * Dragging across the thread header used to leave "Report Bug" and "Archive E"
 * highlighted — the app's own chrome selected like body text, which reads as a
 * bug and never helps anyone.
 *
 * The rule lives in global.css because it has to cover every button in the app,
 * not the handful that happened to be noticed. jsdom does not apply that
 * stylesheet, so this asserts the rule is present and — the part that actually
 * matters — that it is scoped narrowly enough to leave message text alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(
  join(__dirname, '..', '..', 'entrypoints', 'app', 'global.css'),
  'utf8',
);

/** Comments sit between rules, so they must go before selectors are read. */
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block containing `user-select: none`, with its selectors. */
const RULE = /([^}]*)\{[^}]*user-select:\s*none[^}]*\}/;

describe('app chrome is not selectable', () => {
  const match = RULE.exec(CSS_NO_COMMENTS);
  const selectors = (match?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  it('turns selection off for buttons and keycaps', () => {
    expect(match, 'global.css has no user-select:none rule').not.toBeNull();
    expect(selectors).toContain('button');
    expect(selectors).toContain('[role="button"]');
    expect(selectors).toContain('kbd');
  });

  it('ships the -webkit- prefix Chrome still wants', () => {
    expect(CSS).toMatch(/-webkit-user-select:\s*none/);
  });

  it('never disables selection on message content', () => {
    // A blanket rule here would stop people copying their own messages, which
    // is the one thing the app must not take away.
    for (const forbidden of ['*', 'body', 'html', 'p', 'div', ':root']) {
      expect(selectors, `${forbidden} would swallow message text`)
        .not.toContain(forbidden);
    }
  });
});
