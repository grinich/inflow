/**
 * Follow-up message drafting.
 */
import { buildFollowUpDraftPrompt, draftFollowUpMessage } from '@/lib/connection-message';

describe('buildFollowUpDraftPrompt', () => {
  it('includes the name and headline', () => {
    const p = buildFollowUpDraftPrompt('Ada Lovelace', 'Partner at Foo Ventures');
    expect(p).toContain('Ada Lovelace');
    expect(p).toContain('Partner at Foo Ventures');
  });
});

describe('draftFollowUpMessage', () => {
  it('returns the model text, stripped of quotes', async () => {
    const predict = vi.fn().mockResolvedValue('"Hey Ada, would love to reconnect!"');
    const out = await draftFollowUpMessage('Ada', 'Investor', predict);
    expect(out).toBe('Hey Ada, would love to reconnect!');
    expect(predict.mock.calls[0][1]).toMatchObject({ fullResponse: true });
  });

  it('returns null when the model yields nothing', async () => {
    expect(await draftFollowUpMessage('Ada', 'Investor', vi.fn().mockResolvedValue(''))).toBeNull();
  });
});
