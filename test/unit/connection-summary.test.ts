/**
 * connection-summary: builds a conservative one-line summary prompt and cleans
 * the model's response.
 */
import { buildSummaryPrompt, summarizeConnection } from '@/lib/connection-summary';

describe('buildSummaryPrompt', () => {
  it('includes name and headline', () => {
    const p = buildSummaryPrompt('Ada Lovelace', 'Partner at Foo Ventures');
    expect(p).toContain('Ada Lovelace');
    expect(p).toContain('Partner at Foo Ventures');
  });
  it('marks a missing headline', () => {
    expect(buildSummaryPrompt('Ada', '')).toContain('(none)');
  });
});

describe('summarizeConnection', () => {
  it('returns the model text, stripped of wrapping quotes', async () => {
    const predict = vi.fn().mockResolvedValue('"Growth-equity investor at Silversmith."');
    const out = await summarizeConnection('Becca', 'Growth Equity Investor at Silversmith', predict);
    expect(out).toBe('Growth-equity investor at Silversmith.');
    // Uses the full-response, low-temperature summary settings.
    expect(predict.mock.calls[0][1]).toMatchObject({ fullResponse: true, temperature: 0.2 });
  });

  it('skips the model entirely when there is no headline', async () => {
    const predict = vi.fn();
    const out = await summarizeConnection('Becca', '   ', predict);
    expect(out).toBeNull();
    expect(predict).not.toHaveBeenCalled();
  });

  it('returns null when the model yields nothing', async () => {
    const predict = vi.fn().mockResolvedValue('   ');
    expect(await summarizeConnection('X', 'Engineer', predict)).toBeNull();
  });
});
