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

  it('fixes the first row height rather than flooring it', () => {
    // A floor holds only while both rows share a tallest child, and they do
    // not: the inbox's is the compose button (~25px), the network's a 21px
    // pill. The field below then sat a couple of pixels higher on one side.
    expect(NETWORK).toMatch(/className="flex h-7 items-center/);
    expect(INBOX).toMatch(/className="flex h-7 items-center/);
    expect(NETWORK).not.toMatch(/min-h-6/);
    expect(INBOX).not.toMatch(/min-h-6/);
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

  // The field looked identical but sat in a different box: the network's was
  // inside a flex row sharing space with the sort control, so it was narrower
  // on one tab and the row's height was decided by whichever child was
  // tallest. Crossing between views moved it.
  it('puts the field in the same bare wrapper', () => {
    const wrapper = /<div className="relative">\s*<input/;
    expect(NETWORK).toMatch(wrapper);
    expect(INBOX).toMatch(wrapper);
  });

  it('gives the field no siblings that could resize it', () => {
    // A flex row here is what made the field narrower on the Connections tab.
    expect(NETWORK).not.toMatch(/relative min-w-0 flex-1/);
  });

  it('uses the same field classes', () => {
    const field =
      /className="w-full rounded-lg bg-surface-input px-3 py-1\.5 pr-8 text-sm text-fg placeholder-fg-faint outline-none ring-1 ring-ring-muted transition-colors focus:ring-blue-500\/50"/;
    expect(NETWORK).toMatch(field);
    expect(INBOX).toMatch(field);
  });

  it('caps the sort control so it cannot set the tab row height', () => {
    // It moved up beside the tabs; h-6 is the row's min-h-6, so it can sit
    // there without deciding anything.
    expect(NETWORK).toMatch(/ml-auto h-6 shrink-0 cursor-pointer/);
  });

  it('spaces the search field by the shell gap, not an ad-hoc margin', () => {
    // An `mt-2` on the filter row would stack with the shell's gap-2 and push
    // the field lower than the inbox's.
    expect(NETWORK).not.toMatch(/className="mt-2 flex items-center gap-2"/);
  });
});
