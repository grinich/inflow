/**
 * "Ask about your network" — context serialization and question answering.
 */
import {
  buildConnectionContext,
  answerConnectionQuestion,
} from '@/lib/connection-chat';
import type { Connection } from '@/types/connection';

function c(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'p',
    connectionUrn: '',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

describe('buildConnectionContext', () => {
  it('serializes name, role, headline, and interests compactly', () => {
    const { text } = buildConnectionContext([
      c({ fullName: 'Ada', roleCategory: 'Investor', headline: 'Partner at Acme', interestTags: ['Investors'] }),
    ]);
    expect(text).toBe('- Ada (Investor) — Partner at Acme [interests: Investors]');
  });

  it('omits the "Other" role and empty fields', () => {
    const { text } = buildConnectionContext([c({ fullName: 'Bob', roleCategory: 'Other' })]);
    expect(text).toBe('- Bob');
  });

  it('grounds each line in the AI summary (about) and conversation recap (history)', () => {
    const { text } = buildConnectionContext([
      c({
        fullName: 'Ada',
        roleCategory: 'Investor',
        headline: 'Partner at Acme',
        aiSummary: 'GP focused on fintech.',
        conversationSummary: 'Discussed a seed round in March.',
      }),
    ]);
    expect(text).toContain('about: GP focused on fintech.');
    expect(text).toContain('history: Discussed a seed round in March.');
  });

  it('caps the number of connections and reports totals', () => {
    const many = Array.from({ length: 5 }, (_, i) => c({ fullName: `P${i}` }));
    const res = buildConnectionContext(many, 2);
    expect(res.included).toBe(2);
    expect(res.total).toBe(5);
    expect(res.text.split('\n')).toHaveLength(2);
  });
});

describe('answerConnectionQuestion', () => {
  it('grounds the system prompt in the connections and returns the answer', async () => {
    const predict = vi.fn().mockResolvedValue('  Ada Lovelace is an investor.  ');
    const answer = await answerConnectionQuestion(
      [c({ fullName: 'Ada Lovelace', roleCategory: 'Investor', headline: 'Partner at Acme' })],
      'Who are my investors?',
      predict,
    );
    expect(answer).toBe('Ada Lovelace is an investor.');
    const opts = predict.mock.calls[0][1];
    expect(opts.fullResponse).toBe(true);
    expect(opts.systemPrompt).toContain('Ada Lovelace');
    // The question is in the user prompt.
    expect(predict.mock.calls[0][0]).toContain('Who are my investors?');
  });

  it('includes prior turns for follow-up context', async () => {
    const predict = vi.fn().mockResolvedValue('Yes.');
    await answerConnectionQuestion(
      [c({ fullName: 'Ada' })],
      'Any at fintechs?',
      predict,
      [
        { role: 'user', content: 'Who are my investors?' },
        { role: 'assistant', content: 'Ada.' },
      ],
    );
    const prompt = predict.mock.calls[0][0];
    expect(prompt).toContain('Who are my investors?');
    expect(prompt).toContain('Assistant: Ada.');
    expect(prompt).toContain('Any at fintechs?');
  });

  it('returns null when the model says nothing', async () => {
    const predict = vi.fn().mockResolvedValue('   ');
    expect(await answerConnectionQuestion([c({})], 'q', predict)).toBeNull();
  });
});
