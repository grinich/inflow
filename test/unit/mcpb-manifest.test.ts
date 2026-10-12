/**
 * The .mcpb install dialog renders each user_config `description` TWICE: as the
 * help line under the label, and as the input's placeholder. The manifest spec
 * has no separate placeholder field, so a long description is duplicated and
 * then truncated mid-sentence inside the box — which is what it used to do.
 *
 * Keep descriptions placeholder-length and let `title` carry what the field is
 * for. These bounds are the point of the test, not incidental.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'mcp-companion', 'manifest.json'), 'utf8'),
);

/** Beyond this the text is visibly clipped in the input box. */
const MAX_DESCRIPTION = 60;

it('every configurable field has a title and a placeholder-length description', () => {
  const entries = Object.entries(manifest.user_config as Record<string, any>);
  expect(entries.length).toBeGreaterThan(0);
  for (const [name, field] of entries) {
    expect(field.title, `${name} needs a title`).toBeTruthy();
    expect(field.description, `${name} needs a description`).toBeTruthy();
    expect(
      field.description.length,
      `${name}: description doubles as the input placeholder — keep it under ${MAX_DESCRIPTION} chars (got ${field.description.length})`,
    ).toBeLessThanOrEqual(MAX_DESCRIPTION);
  }
});

it('keeps the pairing code required and every secret marked sensitive', () => {
  expect(manifest.user_config.pairing_code.required).toBe(true);
  for (const [name, field] of Object.entries(manifest.user_config as Record<string, any>)) {
    expect(field.sensitive, `${name} holds a secret and must be marked sensitive`).toBe(true);
  }
});

it('wires every configured field through to the server environment', () => {
  const env = manifest.server.mcp_config.env as Record<string, string>;
  for (const name of Object.keys(manifest.user_config)) {
    expect(
      Object.values(env).some((v) => v.includes(`user_config.${name}`)),
      `${name} is collected from the user but never passed to the server`,
    ).toBe(true);
  }
});

it('ships an icon that actually exists in the bundle', () => {
  // The install dialog falls back to a generic placeholder when `icon` is
  // missing or points at a file that was never packed — and nothing errors,
  // so the only symptom is a blank-looking extension.
  expect(manifest.icon, 'manifest should declare an icon').toBeTruthy();
  const iconPath = resolve(process.cwd(), 'mcp-companion', manifest.icon);
  expect(existsSync(iconPath), `icon ${manifest.icon} is declared but not present`).toBe(true);
});

it('keeps the install-dialog description to what the connector does', () => {
  // The dialog shows this one line. It used to end with a promise about what
  // Claude never does, which belongs in the tool descriptions (where it is
  // enforced) rather than in marketing copy the user reads once at install.
  expect(manifest.description).not.toMatch(/never sends/i);
  expect(manifest.description.length).toBeLessThanOrEqual(160);
});

it('declares that the tool list comes from the browser at runtime', () => {
  // The extension hands the catalog over at pairing, so the bundle never holds
  // the authoritative list — default-tools.json is only a cold-start fallback.
  expect(manifest.tools_generated).toBe(true);
});
