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
