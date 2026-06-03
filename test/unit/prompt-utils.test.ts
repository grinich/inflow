import { describe, it, expect } from 'vitest';
import { stripConversationTags, truncate } from '@/lib/prompt-utils';

describe('stripConversationTags', () => {
  it('removes opening and closing conversation tags', () => {
    expect(stripConversationTags('a <conversation> b </conversation> c')).toBe('a  b  c');
  });

  it('is case-insensitive and strips every occurrence', () => {
    expect(stripConversationTags('<CONVERSATION>x</Conversation><conversation>')).toBe('x');
  });

  it('leaves unrelated angle-bracket text untouched', () => {
    expect(stripConversationTags('a < b > c </convo>')).toBe('a < b > c </convo>');
  });

  it('returns empty string unchanged', () => {
    expect(stripConversationTags('')).toBe('');
  });
});

describe('truncate', () => {
  it('leaves strings at or under the limit unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hi', 5)).toBe('hi');
  });

  it('slices and appends an ellipsis when over the limit', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('handles an empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});
