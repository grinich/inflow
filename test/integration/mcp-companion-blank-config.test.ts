/**
 * Regression: a .mcpb field the user left blank arrived as its own placeholder.
 *
 * The install dialog's optional "Gemini API key" was never filled in, but the
 * companion received the literal string "${user_config.gemini_api_key}" rather
 * than an empty string. Every truthiness check read that as a real key, so the
 * companion told inflow it held one; inflow believed it, hid the browser paste
 * box, routed Gemini server-side, and each call reached Google with
 * "${user_config.gemini_api_key}" as the API key. Nothing reported a
 * misconfiguration — requests simply failed.
 *
 * Verified against a live install before the fix: the bridge owner's
 * environment held exactly that 29-character string.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMPANION = join(process.cwd(), 'mcp-companion', 'src', 'index.mjs');

/** Start the companion with the given env and capture its startup banner. */
function banner(env: Record<string, string>): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'inflow-home-'));
  mkdirSync(join(home, '.inflow-mcp'), { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [COMPANION], {
      env: { ...process.env, HOME: home, INFLOW_MCP_PORT: '8194', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', reject);
    proc.stdin.on('error', () => {});

    setTimeout(() => {
      proc.kill();
      rmSync(home, { recursive: true, force: true });
      resolve(err);
    }, 1200);
  });
}

it('treats an unexpanded placeholder as a key that was never set', async () => {
  const out = await banner({
    GEMINI_API_KEY: '${user_config.gemini_api_key}',
    ANTHROPIC_API_KEY: '${user_config.anthropic_api_key}',
    INFLOW_PAIRING_CODE: 'TEST-0000',
  });

  expect(out).toMatch(/Gemini \(Google\):\s+not set/);
  expect(out).toMatch(/Claude \(Anthropic\):\s+not set/);
}, 15_000);

it('still accepts a key the user actually typed', async () => {
  const out = await banner({
    GEMINI_API_KEY: 'AIzaSyFAKE-not-a-real-key-000000000000000',
    ANTHROPIC_API_KEY: 'sk-ant-fake-000',
    INFLOW_PAIRING_CODE: 'TEST-0000',
  });

  expect(out).toMatch(/Gemini \(Google\):\s+GEMINI_API_KEY set/);
  expect(out).toMatch(/Claude \(Anthropic\):\s+ANTHROPIC_API_KEY set/);
}, 15_000);

it('falls back to a generated pairing code when that field was left blank too', async () => {
  // The pairing code is required in the dialog, but the same substitution
  // would otherwise make "${user_config.pairing_code}" the literal code.
  const out = await banner({ INFLOW_PAIRING_CODE: '${user_config.pairing_code}' });
  expect(out).not.toMatch(/\$\{user_config/);
  expect(out).toMatch(/Pairing code:\s+\S+/);
}, 15_000);
