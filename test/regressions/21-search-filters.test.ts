import { describe, it, expect } from 'vitest';
import { stripFilterTokens } from '@/lib/search-filters';

describe('stripFilterTokens', () => {
  it('strips every supported filter token, leaving the free text', () => {
    expect(stripFilterTokens('is:unread hello')).toBe('hello');
    expect(stripFilterTokens('from:ada design review')).toBe('design review');
    expect(stripFilterTokens('has:attachment is:starred budget')).toBe('budget');
    expect(stripFilterTokens('from:alice after:2026-01-01 q3')).toBe('q3');
    expect(stripFilterTokens('newer:7d older:30d ping')).toBe('ping');
    expect(stripFilterTokens('has:draft is:read is:group notes')).toBe('notes');
  });

  it('is case-insensitive and collapses leftover whitespace', () => {
    expect(stripFilterTokens('IS:UNREAD   Hello   World')).toBe('Hello World');
  });

  it('returns empty string when the query is only tokens', () => {
    expect(stripFilterTokens('is:unread from:bob')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(stripFilterTokens('quarterly planning')).toBe('quarterly planning');
  });

  it('regression: non-has: tokens no longer block highlighting (the free text survives)', () => {
    // Previously only has:* was stripped, so "is:unread report" stayed intact and
    // never matched the rendered text. Now the residual is just "report".
    expect(stripFilterTokens('is:unread report')).toBe('report');
  });
});
