/**
 * Bridge protocol — the message contract between the extension and the companion.
 * Pure logic: no real WebSocket, we drive it with fake inbound frames and assert
 * what it sends and how it reports status/activity.
 */
import { createBridgeSession, activityLabel, describeCompanion, describeBuildMatch } from '@/lib/mcp/bridge-protocol';

describe('describeBuildMatch', () => {
  it('judges staleness on the companion code, not the repo it was packed from', () => {
    // The whole point: inflow has moved on, but the companion's own code has
    // not, so there is nothing to reinstall. Comparing repo HEAD used to nag
    // after literally any commit.
    expect(describeBuildMatch({ commit: 'packed99', codeCommit: 'code111' }, 'code111')).toBe(
      'Companion is up to date ✓',
    );
  });

  it('names both sides when the companion code really is behind', () => {
    const line = describeBuildMatch({ codeCommit: 'old111' }, 'new222')!;
    expect(line).toMatch(/out of date/i);
    expect(line).toMatch(/old111/);
    expect(line).toMatch(/new222/);
    expect(line).toMatch(/Reinstall/i);
  });

  it('says nothing when either side cannot say, rather than guessing', () => {
    // An older companion sends no codeCommit at all. A wrong nag here costs a
    // pointless reinstall and teaches the user to ignore the real warning.
    expect(describeBuildMatch({ commit: 'abc1234' }, 'code111')).toBeNull();
    expect(describeBuildMatch({ codeCommit: 'code111' }, undefined)).toBeNull();
    expect(describeBuildMatch({ codeCommit: 'unknown' }, 'code111')).toBeNull();
    expect(describeBuildMatch({ codeCommit: 'code111' }, 'nogit')).toBeNull();
    expect(describeBuildMatch(undefined, 'code111')).toBeNull();
  });
});


function harness(callTool = vi.fn(async () => ({ ok: true }))) {
  const sent: any[] = [];
  const status: { s: string; e?: string }[] = [];
  const activity: string[] = [];
  const keys: any[] = [];
  const proxy: { kind: string; id: string; ok: boolean; data: any; error?: string }[] = [];
  const session = createBridgeSession({
    token: 'CODE-123',
    tools: [{ name: 'search_connections', description: 'd', inputSchema: { type: 'object' } }],
    callTool,
    send: (m) => sent.push(m),
    onStatus: (s, e) => status.push({ s, e }),
    onActivity: (t) => activity.push(t),
    onCompanionKeys: (k) => keys.push(k),
    onAnthropicResult: (id, ok, data, error) => proxy.push({ kind: 'anthropic', id, ok, data, error }),
    onGeminiResult: (id, ok, data, error) => proxy.push({ kind: 'gemini', id, ok, data, error }),
  });
  return { session, sent, status, activity, keys, proxy, callTool };
}

it('on open, authenticates and advertises tools', () => {
  const h = harness();
  h.session.open();
  expect(h.status[0].s).toBe('connecting');
  expect(h.sent[0]).toMatchObject({ type: 'hello', token: 'CODE-123' });
  expect(h.sent[0].tools[0].name).toBe('search_connections');
});

it('hello_ack marks connected', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'hello_ack' }));
  expect(h.status.map((x) => x.s)).toContain('connected');
  expect(h.activity).toContain('Connected to Claude');
});

it('hello_ack with keys reports which the companion holds', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'hello_ack', keys: { anthropic: true, gemini: false } }));
  expect(h.keys.at(-1)).toEqual({ anthropic: true, gemini: false });
});

it('hello_ack without keys defaults to Anthropic-only (backward compatible)', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'hello_ack' }));
  // Older companions omit `keys`: keep Anthropic-via-companion, no Gemini.
  expect(h.keys.at(-1)).toEqual({ anthropic: true, gemini: false });
});

it('anthropic_result and gemini_result settle the matching proxy request', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'anthropic_result', id: 'an-1', ok: true, data: { a: 1 } }));
  await h.session.handleMessage(JSON.stringify({ type: 'gemini_result', id: 'gm-1', ok: false, error: 'no key' }));
  expect(h.proxy).toEqual([
    { kind: 'anthropic', id: 'an-1', ok: true, data: { a: 1 }, error: undefined },
    { kind: 'gemini', id: 'gm-1', ok: false, data: undefined, error: 'no key' },
  ]);
});

it('error frame reports the reason', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'error', message: 'bad token' }));
  expect(h.status.at(-1)).toEqual({ s: 'error', e: 'bad token' });
});

it('answers ping with pong', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'ping' }));
  expect(h.sent).toEqual([{ type: 'pong' }]);
});

it('runs a tool call and returns the result, logging activity', async () => {
  const callTool = vi.fn(async () => ({ total: 3 }));
  const h = harness(callTool);
  await h.session.handleMessage(JSON.stringify({ type: 'call', id: 'x1', name: 'search_connections', args: { query: 'ada' } }));
  expect(callTool).toHaveBeenCalledWith('search_connections', { query: 'ada' });
  expect(h.sent[0]).toEqual({ type: 'result', id: 'x1', ok: true, data: { total: 3 } });
  expect(h.activity[0]).toMatch(/searched your connections.*ada/i);
});

it('reports a tool failure without throwing', async () => {
  const callTool = vi.fn(async () => { throw new Error('boom'); });
  const h = harness(callTool);
  await h.session.handleMessage(JSON.stringify({ type: 'call', id: 'x2', name: 'get_connection', args: {} }));
  expect(h.sent[0]).toEqual({ type: 'result', id: 'x2', ok: false, error: 'boom' });
});

it('ignores malformed frames', async () => {
  const h = harness();
  await h.session.handleMessage('not json');
  expect(h.sent).toEqual([]);
  expect(h.status).toEqual([]);
});

it('activityLabel describes known tools', () => {
  expect(activityLabel('list_connections', { role: 'Investor' })).toMatch(/Investor/);
  expect(activityLabel('get_network_stats')).toMatch(/network stats/i);
  expect(activityLabel('create_draft')).toMatch(/drafted a message/i);
  expect(activityLabel('mystery')).toMatch(/mystery/);
});

// --- companion status in the activity feed ---------------------------------

it('describes the companion it paired with, including the bridge port', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({
    type: 'hello_ack',
    status: { version: '0.1.0', port: 8123, ownsBridge: true, tools: 10 },
  }));
  const line = h.activity.find((t) => /Companion/.test(t))!;
  expect(line).toContain('127.0.0.1:8123');
  expect(line).toContain('10 tools');
  expect(line).toContain('v0.1.0');
});

it('says when the companion is relaying rather than owning the bridge', () => {
  expect(describeCompanion({ ownsBridge: false, tools: 10 })).toMatch(/relaying through another companion/i);
});

it('mentions other attached Claude clients, pluralised', () => {
  expect(describeCompanion({ ownsBridge: true, port: 8123, peers: 1 })).toMatch(/1 other Claude client\b/);
  expect(describeCompanion({ ownsBridge: true, port: 8123, peers: 2 })).toMatch(/2 other Claude clients/);
});

it('does not invent details when an older companion reports no status', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'hello_ack' }));
  expect(h.activity.some((t) => /older build/.test(t))).toBe(true);
});

it('pushes companion-sent activity lines into the feed', async () => {
  const h = harness();
  await h.session.handleMessage(JSON.stringify({ type: 'activity', text: 'Another Claude client attached' }));
  expect(h.activity).toContain('Another Claude client attached');
  // An empty line is ignored rather than cluttering the feed.
  await h.session.handleMessage(JSON.stringify({ type: 'activity' }));
  expect(h.activity.filter(Boolean).length).toBe(h.activity.length);
});

it('reports the companion build and commit so you can tell which is live', () => {
  const line = describeCompanion({ version: '0.1.0.214', commit: '14b533a', ownsBridge: true, port: 8123, tools: 10 });
  expect(line).toContain('v0.1.0.214');
  expect(line).toContain('(14b533a)');
});

it('omits the commit when the build was never stamped', () => {
  expect(describeCompanion({ version: 'dev', ownsBridge: true, port: 8123 })).toBe(
    'Companion vdev ready — bridge on 127.0.0.1:8123',
  );
});

it('adds the match line to the feed on connect', async () => {
  const sent: any[] = [];
  const activity: string[] = [];
  const session = createBridgeSession({
    token: 'T', tools: [], callTool: vi.fn(), send: (m) => sent.push(m),
    onStatus: () => {}, onActivity: (t) => activity.push(t), appCompanionSha: 'code111',
  });
  // The packed-from sha differs and must not matter; only codeCommit does.
  await session.handleMessage(JSON.stringify({ type: 'hello_ack', status: { commit: 'packed99', codeCommit: 'code111', port: 8123, ownsBridge: true } }));
  expect(activity).toContain('Companion is up to date ✓');
});
