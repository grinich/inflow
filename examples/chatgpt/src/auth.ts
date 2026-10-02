import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { oauthCustomProvider } from 'mcp-use/oauth';
import type { MCPServer } from 'mcp-use';
import { bodyLimit } from 'hono/body-limit';

export function equalSecret(a: string, b: string) {
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return Boolean(a && b) && timingSafeEqual(hash(a), hash(b));
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** A private, single-owner OAuth provider. Codes and refresh-token families are
 * in memory; restarting requires sign-in again once existing access tokens expire. No inbox
 * state, LinkedIn credentials, or user identity comes from client metadata. */
export function createAuth(base: string, signingSecret: string, loginSecret: string) {
  const key = new TextEncoder().encode(signingSecret);
  const resource = `${base}/mcp`;
  const configured = signingSecret.length >= 32 && loginSecret.length >= 32;
  const codes = new Map<
    string,
    { client: string; redirect: string; challenge: string; expires: number }
  >();
  const refreshFamilies = new Map<
    string,
    { client: string; currentToken: string; expires: number }
  >();
  const maxRefreshFamilies = 1000;
  const refreshLifetimeSeconds = 7 * 24 * 60 * 60;
  const metadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['inflow'],
  };
  async function sign(kind: string, data: JWTPayload, life: string | number) {
    if (!configured) throw new Error('Authentication is not configured');
    return new SignJWT({ ...data, kind })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(base)
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime(life)
      .sign(key);
  }
  async function verify(token: string, kind: string) {
    if (!configured) throw new Error('Authentication is not configured');
    const { payload } = await jwtVerify(token, key, {
      issuer: base,
      audience: resource,
      algorithms: ['HS256'],
    });
    if (payload.kind !== kind) throw new Error('Wrong token type');
    return payload;
  }
  const provider = oauthCustomProvider({
    resource,
    requiredScopes: ['inflow'],
    scopesSupported: ['inflow'],
    oauthMetadata: metadata,
    createTokenVerifier: () => ({
      async verifyAccessToken(token: string) {
        const p = await verify(token, 'access');
        return {
          token,
          clientId: String(p.client),
          scopes: ['inflow'],
          expiresAt: p.exp,
          resource: new URL(resource),
          extra: { sub: 'owner' },
        };
      },
    }),
    mapAuthInfo: () => ({
      user: { id: 'owner' },
      payload: { sub: 'owner' },
      permissions: ['inflow'],
    }),
  });
  function routes(server: MCPServer<{ id: string }>) {
    server.get('/.well-known/oauth-authorization-server', (c) => c.json(metadata));
    server.use('/oauth/*', async (c, next) => {
      c.header('Cache-Control', 'no-store');
      c.header('Referrer-Policy', 'no-referrer');
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      );
      if (!configured) return c.json({ error: 'temporarily_unavailable' }, 503);
      await next();
    });
    server.use(
      '/oauth/*',
      bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: 'invalid_request' }, 413) }),
    );
    server.post('/oauth/register', async (c) => {
      try {
        const body = await c.req.json();
        if (
          !Array.isArray(body.redirect_uris) ||
          !body.redirect_uris.length ||
          body.redirect_uris.length > 10
        )
          throw new Error();
        const uris: string[] = body.redirect_uris;
        for (const value of uris) {
          if (typeof value !== 'string' || value.length > 2048) throw new Error();
          const u = new URL(value);
          if (
            u.username ||
            u.password ||
            u.hash ||
            !(
              u.protocol === 'https:' ||
              (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
            )
          )
            throw new Error();
        }
        const client = await sign(
          'client',
          { redirects: uris, nonce: randomBytes(12).toString('hex') },
          '365d',
        );
        return c.json(
          {
            client_id: client,
            redirect_uris: uris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          },
          201,
        );
      } catch {
        return c.json({ error: 'invalid_client_metadata' }, 400);
      }
    });
    async function validate(params: Record<string, string>) {
      const client = await verify(params.client_id || '', 'client');
      if (!Array.isArray(client.redirects) || !client.redirects.includes(params.redirect_uri))
        throw new Error('Invalid redirect');
      if (
        params.response_type !== 'code' ||
        params.code_challenge_method !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || '')
      )
        throw new Error('PKCE S256 is required');
      if (params.resource && params.resource !== resource) throw new Error('Invalid resource');
      if (params.scope && params.scope !== 'inflow') throw new Error('Invalid scope');
    }
    server.get('/oauth/authorize', async (c) => {
      try {
        const p = c.req.query();
        await validate(p);
        const transaction = await sign('transaction', { params: p }, '10m');
        return c.html(
          `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Inflow</title><style>body{font:16px system-ui;background:#f7f8fa;color:#16201b;padding:8vh 24px}main{max-width:440px;margin:auto;background:white;border:1px solid #e1e6e2;border-radius:20px;padding:32px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:14px;border-radius:9px;border:1px solid #ccd5cd}button{background:#1b5f42;color:white;font:inherit}p{line-height:1.6;color:#526257}</style><main><h1>Connect Inflow</h1><p>This connection can read your LinkedIn inbox and use the actions enabled in Inflow. Enter your private connection key to continue.</p><form method="post"><input type="hidden" name="transaction" value="${escapeHtml(transaction)}"><label>Connection key<input name="key" type="password" required autocomplete="current-password"></label><button>Connect my inbox</button></form></main></html>`,
        );
      } catch {
        return c.text('Invalid authorization request', 400);
      }
    });
    server.post('/oauth/authorize', async (c) => {
      try {
        if (c.req.header('origin') && c.req.header('origin') !== base)
          return c.text('Invalid origin', 403);
        const body = await c.req.parseBody();
        const transaction = await verify(String(body.transaction || ''), 'transaction');
        const p = transaction.params as Record<string, string>;
        await validate(p);
        if (!equalSecret(String(body.key || ''), loginSecret))
          return c.text('Incorrect connection key. Go back to retry.', 403);
        for (const [id, item] of codes) if (item.expires < Date.now()) codes.delete(id);
        if (codes.size >= 1000) return c.text('Try again later', 429);
        const code = randomBytes(32).toString('base64url');
        codes.set(code, {
          client: p.client_id,
          redirect: p.redirect_uri,
          challenge: p.code_challenge,
          expires: Date.now() + 300000,
        });
        const target = new URL(p.redirect_uri);
        target.searchParams.set('code', code);
        if (p.state) target.searchParams.set('state', p.state);
        return c.redirect(target.href);
      } catch {
        return c.text('Authorization expired. Start the connection again.', 400);
      }
    });
    server.post('/oauth/token', async (c) => {
      try {
        const p = await c.req.parseBody();
        const client = String(p.client_id || '');
        await verify(client, 'client');
        if (p.resource && p.resource !== resource) throw new Error();
        const now = Math.floor(Date.now() / 1000);
        for (const [id, family] of refreshFamilies) {
          if (family.expires <= now) refreshFamilies.delete(id);
        }
        let familyId: string;
        let family: { client: string; currentToken: string; expires: number };
        if (p.grant_type === 'authorization_code') {
          const code = String(p.code || '');
          const item = codes.get(code);
          const verifier = String(p.code_verifier || '');
          if (
            !item ||
            item.expires < Date.now() ||
            item.client !== client ||
            item.redirect !== p.redirect_uri ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            createHash('sha256').update(verifier).digest('base64url') !== item.challenge
          )
            throw new Error();
          if (refreshFamilies.size >= maxRefreshFamilies)
            return c.json({ error: 'temporarily_unavailable' }, 503);
          codes.delete(code);
          familyId = randomBytes(32).toString('base64url');
          family = { client, currentToken: '', expires: now + refreshLifetimeSeconds };
          refreshFamilies.set(familyId, family);
        } else if (p.grant_type === 'refresh_token') {
          const refresh = await verify(String(p.refresh_token || ''), 'refresh');
          if (
            refresh.client !== client ||
            typeof refresh.family !== 'string' ||
            typeof refresh.jti !== 'string'
          )
            throw new Error();
          familyId = refresh.family;
          const existing = refreshFamilies.get(familyId);
          if (!existing || existing.client !== client) throw new Error();
          if (existing.currentToken !== refresh.jti) {
            // A valid but consumed token means this family may be compromised.
            // Revoke its current refresh token too, requiring a fresh sign-in.
            refreshFamilies.delete(familyId);
            throw new Error();
          }
          family = existing;
        } else throw new Error();
        // Rotate before any await, so concurrent uses cannot both succeed.
        // Preserve the original deadline: exchanges do not extend the family.
        family.currentToken = randomBytes(32).toString('base64url');
        return c.json({
          access_token: await sign('access', { sub: 'owner', client }, '1h'),
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'inflow',
          refresh_token: await sign(
            'refresh',
            { sub: 'owner', client, family: familyId, jti: family.currentToken },
            family.expires,
          ),
        });
      } catch {
        return c.json({ error: 'invalid_grant' }, 400);
      }
    });
  }
  return { provider, routes, sign, verify };
}
