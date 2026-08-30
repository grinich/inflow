// The sent-invitations pages are not Voyager, so they needed their own cookie
// rule. The first version matched all of www.linkedin.com at a higher priority
// than the Voyager rule — and when several declarativeNetRequest modifyHeaders
// rules match one request, the highest priority sets the header. So it quietly
// rewrote the Referer on every API call the extension makes, the realtime
// stream included, claiming each came from the invitation manager.
//
// Nothing visible breaks, which is exactly why it is worth pinning: Referer is
// the sort of header an anti-abuse system reads.
import { ensureCookieRule, invalidateCookieRule } from '../../entrypoints/background/api/client';

vi.mock('../../entrypoints/background/auth/cookies', () => ({
  getLinkedInCookies: vi.fn(async () => ({ jsessionId: '"ajax:123"', liAt: 'x' })),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

let rules: any[] = [];

beforeEach(() => {
  rules = [];
  invalidateCookieRule();
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    runtime: { id: 'extid' },
    cookies: { getAll: async () => [{ name: 'li_at', value: 'x' }] },
    declarativeNetRequest: {
      updateSessionRules: async ({ addRules }: any) => { rules = addRules; },
    },
  };
});

const ruleById = (id: number) => rules.find((r) => r.id === id);
const refererOf = (id: number) =>
  ruleById(id)?.action.requestHeaders.find((h: any) => h.header === 'Referer')?.value;

describe('regression #164: cookie rules do not overlap', () => {
  it('installs a rule for the non-Voyager pages', async () => {
    await ensureCookieRule();

    expect(ruleById(3)).toBeTruthy();
    expect(refererOf(3)).toContain('/mynetwork/invitation-manager/sent/');
  });

  it('scopes that rule by path, not to the whole domain', async () => {
    await ensureCookieRule();

    // A domain-wide condition is what let it capture Voyager requests.
    expect(ruleById(3).condition.requestDomains).toBeUndefined();
    expect(ruleById(3).condition.regexFilter).toBeTruthy();
  });

  it('matches only the pages that need it', async () => {
    await ensureCookieRule();
    const re = new RegExp(ruleById(3).condition.regexFilter);

    expect(re.test('https://www.linkedin.com/mynetwork/invitation-manager/sent/')).toBe(true);
    expect(re.test('https://www.linkedin.com/flagship-web/rsc-action/actions/pagination')).toBe(true);
    // The ones that must keep their own Referer.
    expect(re.test('https://www.linkedin.com/voyager/api/relationships/invitationViews')).toBe(false);
    expect(re.test('https://www.linkedin.com/realtime/connect')).toBe(false);
  });

  it('leaves the Voyager rule its own Referer', async () => {
    await ensureCookieRule();

    expect(refererOf(1)).toBe('https://www.linkedin.com/messaging/');
    expect(refererOf(1)).not.toBe(refererOf(3));
  });

  it('does not outrank the Voyager rule', async () => {
    // Belt and braces: even if the scoping regressed, an equal-or-lower
    // priority keeps it from winning the header on an overlap.
    await ensureCookieRule();

    expect(ruleById(3).priority).toBeLessThanOrEqual(ruleById(1).priority);
  });
});
