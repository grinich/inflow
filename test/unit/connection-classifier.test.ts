/**
 * The AI connection classifier: prompt building, tolerant JSON parsing, and
 * batched classification with incremental onBatch callbacks.
 */
import {
  buildClassifyPrompt,
  parseClassifyResponse,
  classifyConnections,
  CLASSIFY_BATCH_SIZE,
  type ClassifyInput,
} from '@/lib/connection-classifier';

function person(profileUrn: string, fullName: string, headline: string): ClassifyInput {
  return { profileUrn, fullName, headline };
}

// Disable throttle/backoff so behavioral tests run instantly (single attempt).
const NO_THROTTLE = { batchDelayMs: 0, backoffMs: 0, maxRetries: 0, sleep: async () => {} };

describe('buildClassifyPrompt', () => {
  it('lists people with indices and includes the interest tags', () => {
    const prompt = buildClassifyPrompt(
      [person('u1', 'Ada Lovelace', 'Partner at Foo Ventures')],
      ['Investors', 'Potential customers'],
    );
    expect(prompt).toContain('0. Ada Lovelace — Partner at Foo Ventures');
    expect(prompt).toContain('Investors, Potential customers');
    expect(prompt).toContain('Investor'); // role list present
  });

  it('handles missing headline and empty interests', () => {
    const prompt = buildClassifyPrompt([person('u1', 'Alan Turing', '')], []);
    expect(prompt).toContain('(no headline)');
    expect(prompt).toContain('no interest tags');
  });
});

describe('parseClassifyResponse', () => {
  it('parses a clean JSON array', () => {
    const out = parseClassifyResponse(
      '[{"i":0,"role":"Investor","interests":["Investors"]},{"i":1,"role":"Engineering","interests":[]}]',
      ['Investors'],
    );
    expect(out.get(0)).toEqual({ roleCategory: 'Investor', interestTags: ['Investors'] });
    expect(out.get(1)).toEqual({ roleCategory: 'Engineering', interestTags: [] });
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const text = 'Here you go:\n```json\n[{"i":0,"role":"Founder","interests":[]}]\n```\nDone.';
    const out = parseClassifyResponse(text, []);
    expect(out.get(0)?.roleCategory).toBe('Founder');
  });

  it('collapses unknown roles to Other', () => {
    const out = parseClassifyResponse('[{"i":0,"role":"Wizard","interests":[]}]', []);
    expect(out.get(0)?.roleCategory).toBe('Other');
  });

  it('validates interest tags case-insensitively and normalizes casing', () => {
    const out = parseClassifyResponse(
      '[{"i":0,"role":"Investor","interests":["investors","Made up tag"]}]',
      ['Investors'],
    );
    // "investors" → canonical "Investors"; "Made up tag" dropped (not requested).
    expect(out.get(0)?.interestTags).toEqual(['Investors']);
  });

  it('returns an empty map on non-JSON garbage', () => {
    expect(parseClassifyResponse('the model refused', ['Investors']).size).toBe(0);
  });
});

describe('classifyConnections', () => {
  it('maps results back to profileUrns', async () => {
    const predict = vi
      .fn()
      .mockResolvedValue('[{"i":0,"role":"Investor","interests":["Investors"]},{"i":1,"role":"Founder","interests":[]}]');
    const out = await classifyConnections(
      [person('u1', 'A', 'GP'), person('u2', 'B', 'CEO')],
      ['Investors'],
      predict,
      undefined,
      undefined,
      NO_THROTTLE,
    );
    expect(out.get('u1')).toEqual({ roleCategory: 'Investor', interestTags: ['Investors'] });
    expect(out.get('u2')).toEqual({ roleCategory: 'Founder', interestTags: [] });
    expect(predict).toHaveBeenCalledTimes(1);
  });

  it('splits into batches and fires onBatch per batch', async () => {
    const people = Array.from({ length: CLASSIFY_BATCH_SIZE + 3 }, (_, i) =>
      person(`u${i}`, `P${i}`, 'Engineer'),
    );
    // Return a response sized to whatever batch was asked for.
    const predict = vi.fn(async (prompt: string) => {
      const n = (prompt.match(/^\d+\. /gm) || []).length;
      return JSON.stringify(
        Array.from({ length: n }, (_, i) => ({ i, role: 'Engineering', interests: [] })),
      );
    });

    const batches: number[] = [];
    const out = await classifyConnections(people, [], predict, (b) => {
      batches.push(b.length);
    }, undefined, NO_THROTTLE);

    expect(predict).toHaveBeenCalledTimes(2);
    expect(batches).toEqual([CLASSIFY_BATCH_SIZE, 3]);
    expect(out.size).toBe(CLASSIFY_BATCH_SIZE + 3);
  });

  it('reports a null-response batch via onError instead of mislabeling', async () => {
    const predict = vi.fn().mockResolvedValue(null);
    const onError = vi.fn();
    const out = await classifyConnections([person('u1', 'A', 'x')], ['Investors'], predict, undefined, onError, NO_THROTTLE);
    expect(out.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(['u1'], expect.any(Error));
  });

  it('reports a thrown batch via onError and continues to the next batch', async () => {
    const people = Array.from({ length: CLASSIFY_BATCH_SIZE + 1 }, (_, i) => person(`u${i}`, `P${i}`, 'x'));
    const predict = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce('[{"i":0,"role":"Founder","interests":[]}]');
    const onError = vi.fn();
    const out = await classifyConnections(people, [], predict, undefined, onError, NO_THROTTLE);
    // First (full) batch errored; second (1 person) succeeded.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out.get(`u${CLASSIFY_BATCH_SIZE}`)?.roleCategory).toBe('Founder');
  });

  it('stamps model-omitted people in a responded batch as Other', async () => {
    // Two people asked; model only answers index 0.
    const predict = vi.fn().mockResolvedValue('[{"i":0,"role":"Investor","interests":[]}]');
    const onBatch = vi.fn();
    const out = await classifyConnections(
      [person('u1', 'A', 'x'), person('u2', 'B', 'y')],
      [],
      predict,
      onBatch,
      undefined,
      NO_THROTTLE,
    );
    expect(out.get('u1')?.roleCategory).toBe('Investor');
    expect(out.get('u2')?.roleCategory).toBe('Other'); // omitted → Other, not left hanging
  });
});

describe('classifyConnections throttle + backoff', () => {
  it('paces successful batches with the batch delay', async () => {
    const people = Array.from({ length: CLASSIFY_BATCH_SIZE + 1 }, (_, i) => person(`u${i}`, 'P', 'x'));
    const predict = vi.fn(async (p: string) => {
      const n = (p.match(/^\d+\. /gm) || []).length;
      return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, role: 'Engineering', interests: [] })));
    });
    const sleeps: number[] = [];
    await classifyConnections(people, [], predict, undefined, undefined, {
      batchDelayMs: 250, maxRetries: 0, backoffMs: 0, sleep: async (ms) => { sleeps.push(ms); },
    });
    // One delay between the two batches.
    expect(sleeps).toEqual([250]);
  });

  it('retries a failing batch with exponential backoff, then succeeds', async () => {
    const predict = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('[{"i":0,"role":"Founder","interests":[]}]');
    const onError = vi.fn();
    const sleeps: number[] = [];
    const out = await classifyConnections([person('u1', 'A', 'x')], [], predict, undefined, onError, {
      batchDelayMs: 0, maxRetries: 3, backoffMs: 100, sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(predict).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(out.get('u1')?.roleCategory).toBe('Founder');
    expect(sleeps).toEqual([100, 200]); // backoff doubles between attempts
  });

  it('gives up after maxRetries and reports onError', async () => {
    const predict = vi.fn().mockResolvedValue(null);
    const onError = vi.fn();
    await classifyConnections([person('u1', 'A', 'x')], [], predict, undefined, onError, {
      batchDelayMs: 0, maxRetries: 2, backoffMs: 1, sleep: async () => {},
    });
    expect(predict).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(onError).toHaveBeenCalled();
  });

  it('stops early after several batches fail in a row (circuit breaker)', async () => {
    const people = Array.from({ length: CLASSIFY_BATCH_SIZE * 6 }, (_, i) => person(`u${i}`, 'P', 'x'));
    const predict = vi.fn().mockResolvedValue(null);
    await classifyConnections(people, [], predict, undefined, vi.fn(), {
      batchDelayMs: 0, maxRetries: 0, backoffMs: 0, sleep: async () => {},
    });
    // 6 batches available, but the run stops after 3 consecutive full failures.
    expect(predict).toHaveBeenCalledTimes(3);
  });

  it('stops promptly when aborted', async () => {
    const signal = { aborted: true };
    const predict = vi.fn().mockResolvedValue('[{"i":0,"role":"Founder","interests":[]}]');
    await classifyConnections([person('u1', 'A', 'x')], [], predict, undefined, undefined, { signal });
    expect(predict).not.toHaveBeenCalled();
  });
});
