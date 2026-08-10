/**
 * The Anthropic Messages API client: request shape (headers, thinking policy,
 * system prompt), text extraction, and null-on-failure contract.
 */
import { predictAnthropic, anthropicErrorMessage, ANTHROPIC_URL } from '@/lib/anthropic-client';

function okResponse(text: string) {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('predictAnthropic', () => {
  it('posts to the Messages API with browser-access headers and returns the text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('  hello there  '));
    vi.stubGlobal('fetch', fetchMock);

    const out = await predictAnthropic('hi', 'sk-ant-abc', 'claude-sonnet-5', {
      maxTokens: 100,
      systemPrompt: 'be nice',
    });

    expect(out).toBe('hello there');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ANTHROPIC_URL);
    expect(init.headers['x-api-key']).toBe('sk-ant-abc');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toBe('be nice');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('disables thinking for the Claude 5 family (would otherwise eat max_tokens)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('x'));
    vi.stubGlobal('fetch', fetchMock);
    await predictAnthropic('hi', 'k', 'claude-sonnet-5');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('omits thinking for Haiku (off by default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('x'));
    vi.stubGlobal('fetch', fetchMock);
    await predictAnthropic('hi', 'k', 'claude-haiku-4-5');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect('thinking' in body).toBe(false);
  });

  it('floors max_tokens so a response can never be truncated to nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('x'));
    vi.stubGlobal('fetch', fetchMock);
    await predictAnthropic('hi', 'k', 'claude-haiku-4-5', { maxTokens: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBeGreaterThanOrEqual(64);
  });

  it('concatenates multiple text blocks and ignores non-text blocks', async () => {
    const res = new Response(
      JSON.stringify({ content: [{ type: 'thinking', text: 'ignored' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
      { status: 200 },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    expect(await predictAnthropic('hi', 'k', 'claude-haiku-4-5')).toBe('ab');
  });

  it('returns null on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    expect(await predictAnthropic('hi', 'k', 'claude-haiku-4-5')).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await predictAnthropic('hi', 'k', 'claude-haiku-4-5')).toBeNull();
  });

  it('returns null (not a throw) when aborted', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    expect(await predictAnthropic('hi', 'k', 'claude-haiku-4-5')).toBeNull();
  });
});

describe('anthropicErrorMessage', () => {
  it('maps common statuses to readable reasons', () => {
    expect(anthropicErrorMessage(401)).toMatch(/invalid api key/i);
    expect(anthropicErrorMessage(429)).toMatch(/rate limit/i);
    expect(anthropicErrorMessage(404)).toMatch(/model not found/i);
    expect(anthropicErrorMessage(500)).toMatch(/HTTP 500/);
  });
});
