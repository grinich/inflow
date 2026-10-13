/**
 * App-wide CSS that compensates for a framework default, where the symptom is
 * cosmetic and easy to miss but affects every control in the app.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'entrypoints/app/global.css'), 'utf8');

it('restores the pointer cursor Tailwind v4 stopped giving buttons', () => {
  // v4's preflight sets `appearance: button` and says nothing about the
  // cursor, where v3 applied `cursor: pointer`. Without a rule of our own,
  // every button in the app shows the arrow cursor — so a control with no ring
  // or fill behind it reads as a plain label rather than something to click,
  // which is exactly how the MCP connector's "Setup" looked.
  const rule = css.match(/button:not\(:disabled\)[^{]*\{[^}]*\}/);
  expect(rule, 'global.css should give enabled buttons a pointer cursor').toBeTruthy();
  expect(rule![0]).toMatch(/cursor:\s*pointer/);
});

it('leaves disabled controls alone, so unavailable still feels unavailable', () => {
  // Send stays disabled until an InMail's recipient is confirmed; a hand
  // cursor there would promise something the click does not deliver.
  const rule = css.match(/button:not\(:disabled\)[^{]*\{[^}]*\}/)![0];
  expect(rule).toMatch(/:not\(:disabled\)/);
  expect(rule).toMatch(/\[role='button'\]:not\(\[aria-disabled='true'\]\)/);
});

describe('theme surfaces', () => {
  /** The token block for a theme selector, e.g. ":root" or ".theme-purple". */
  function tokens(selector: string): Record<string, string> {
    const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
    expect(block, `${selector} should define tokens`).toBeTruthy();
    const out: Record<string, string> = {};
    for (const line of block![1].split(';')) {
      const m = line.match(/(--[\w-]+)\s*:\s*(.+)/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  }

  const translucent = (v: string) => /rgba\([^)]*,\s*0?\.\d+\s*\)/.test(v);

  it.each([':root', '.dark', '.theme-purple'])(
    '%s keeps --surface-raised opaque, since it floats over content',
    (selector) => {
      // A menu, modal or tooltip at less than full opacity lets the rows
      // underneath show through its own text. Purple shipped it at 0.7, which
      // read as the theme bleeding into the background.
      const raised = tokens(selector)['--surface-raised'];
      expect(raised, `${selector} --surface-raised`).toBeTruthy();
      expect(translucent(raised), `${selector} --surface-raised is ${raised}`).toBe(false);
    },
  );

  it('still lets the purple page surface show its gradient', () => {
    // The translucent base is the theme's character, not the bug: nothing sits
    // behind it except the fixed backdrop.
    expect(translucent(tokens('.theme-purple')['--surface'])).toBe(true);
  });
});
