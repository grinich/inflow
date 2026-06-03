import { describe, it, expect } from 'vitest';
import { buildAutocompletePrompt, MIN_BODY_LENGTH } from '@/lib/autocomplete-prompt';
import { makeMessage } from '../fixtures/factories';

describe('buildAutocompletePrompt (context + windowing)', () => {
  it('returns null below MIN_BODY_LENGTH and builds at the threshold', () => {
    expect(buildAutocompletePrompt([], ['Ada'], 'x'.repeat(MIN_BODY_LENGTH - 1))).toBeNull();
    expect(buildAutocompletePrompt([], ['Ada'], 'x'.repeat(MIN_BODY_LENGTH))).not.toBeNull();
  });

  it('returns null for whitespace-only input even if long', () => {
    expect(buildAutocompletePrompt([], ['Ada'], '          ')).toBeNull();
  });

  it('includes the current draft as the final You: line', () => {
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: 'Ada', body: 'hello' })], ['Ada'], 'thanks for')!;
    expect(p).toContain('You: thanks for');
    expect(p).toContain('Ada: hello');
  });

  it('windows to the last 8 context messages', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMessage({ isFromMe: false, senderName: 'Ada', body: `c${i}` }));
    const p = buildAutocompletePrompt(msgs, ['Ada'], 'my draft')!;
    expect(p).toContain('c19');
    expect(p).toContain('c12'); // 20 - 8 = index 12 is the oldest kept
    expect(p).not.toContain('c11');
  });

  it('falls back to "Them" when no participant name and senderName is blank', () => {
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: '', body: 'ping' })], [], 'my reply')!;
    expect(p).toContain('Them: ping');
  });

  it('truncates long context and draft bodies', () => {
    const long = 'y'.repeat(300);
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: 'Ada', body: long })], ['Ada'], 'z'.repeat(300))!;
    expect(p).not.toContain('y'.repeat(150));
    expect(p).not.toContain('z'.repeat(150));
  });
});
