// @vitest-environment jsdom
// The network header sat on px-3 py-2 while the inbox used px-4 py-3, and its
// first row had no floor under it. So crossing between the two views changed
// the header's height and shifted the search field down the page — the one
// element you are most likely to be aiming at when you switch.
//
// jsdom does no layout, so heights cannot be measured here. What CAN be
// pinned is the contract that produces them: both headers share a shell and
// both first rows carry the same minimum height.
import '../dom-setup';

const read = (p: string) => require('node:fs').readFileSync(p, 'utf8');

const NETWORK = read('src/components/network/NetworkView.tsx');
const INBOX = read('src/components/conversations/ConversationListHeader.tsx');

/** The padding/gap classes that decide the header's outer box. */
function shellClasses(source: string): string[] {
  const match = source.match(/className="([^"]*flex flex-col gap-2 border-b border-edge[^"]*)"/);
  if (!match) throw new Error('no header shell found');
  return match[1]
    .split(/\s+/)
    // @container is an inbox-only concern (its tabs collapse to a select on
    // narrow widths) and does not affect the box.
    .filter((c) => c !== '@container')
    .sort();
}

describe('regression #157: the two headers are the same height', () => {
  it('share the same padding and gap', () => {
    expect(shellClasses(NETWORK)).toEqual(shellClasses(INBOX));
  });

  it('both put a floor under the first row', () => {
    // Without this the network row is shorter: the inbox row is sized by an
    // h1 at text-base, which the network header has no equivalent of.
    expect(NETWORK).toMatch(/className="flex min-h-6 items-center/);
    expect(INBOX).toMatch(/className="flex min-h-6 items-center/);
  });

  // The tabs drifted twice: first to their own pill shape, then to a spaced
  // layout that dropped the track — and the selected pill is `bg-surface`,
  // which only reads as selected against the track's `bg-surface-input`.
  it('wraps the tabs in the same track', () => {
    const track = /className="flex shrink-0 rounded-md bg-surface-input p-0\.5"/;
    expect(NETWORK).toMatch(track);
    expect(INBOX).toMatch(/rounded-md bg-surface-input p-0\.5/);
  });

  it('gives selected and unselected tabs the same treatment as the inbox', () => {
    const selected = /'bg-surface text-fg-strong shadow-sm'/;
    const unselected = /'text-fg-muted hover:text-fg-secondary'/;
    for (const source of [NETWORK, INBOX]) {
      expect(source).toMatch(selected);
      expect(source).toMatch(unselected);
    }
  });

  it('sizes the tab buttons the same', () => {
    const size = /cursor-pointer rounded px-1\.5 py-0\.5 text-\[11px\] font-medium transition-colors/;
    expect(NETWORK).toMatch(size);
    expect(INBOX).toMatch(size);
  });

  it('spaces the search field by the shell gap, not an ad-hoc margin', () => {
    // An `mt-2` on the filter row would stack with the shell's gap-2 and push
    // the field lower than the inbox's.
    expect(NETWORK).not.toMatch(/className="mt-2 flex items-center gap-2"/);
  });
});
