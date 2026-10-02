import { startFixtureBridge } from './fixtures.mjs';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
const secrets = process.env;
if (!secrets.INFLOW_SIGNING_KEY || !secrets.INFLOW_BRIDGE_KEY)
  throw new Error('Load verification credentials with --env-file=.env');
const base = 'http://localhost:3000';
const token = await new SignJWT({ kind: 'access', sub: 'owner', client: 'preview' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer(base)
  .setAudience(`${base}/mcp`)
  .setIssuedAt()
  .setExpirationTime('10m')
  .sign(new TextEncoder().encode(secrets.INFLOW_SIGNING_KEY));
const headers = {
  authorization: `Bearer ${secrets.INFLOW_BRIDGE_KEY}`,
  'content-type': 'application/json',
};
const stopFixture = startFixtureBridge(base, headers);
await new Promise((r) => setTimeout(r, 300));
const child = spawn(
  'npx',
  [
    'mcp-use',
    'screenshot',
    '--mcp',
    `${base}/mcp`,
    '-H',
    `Authorization: Bearer ${token}`,
    '--tool',
    'open_inbox',
    'conversationId=maya',
    '--width',
    process.env.PREVIEW_WIDTH || '1150',
    '--height',
    '780',
    '--theme',
    process.env.PREVIEW_THEME || 'light',
    '--output',
    process.env.PREVIEW_OUTPUT || '../inflow-preview.png',
    '--delay',
    '1200',
    '--json',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const exit = await new Promise((r) => child.on('exit', r));
await stopFixture();
process.exit(exit || 0);
