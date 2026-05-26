describe('mark-read-suppression', () => {
  let recordMarkRead: typeof import('../../entrypoints/background/realtime/mark-read-suppression').recordMarkRead;
  let shouldSuppressConversationUpdate: typeof import('../../entrypoints/background/realtime/mark-read-suppression').shouldSuppressConversationUpdate;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../../entrypoints/background/realtime/mark-read-suppression');
    recordMarkRead = mod.recordMarkRead;
    shouldSuppressConversationUpdate = mod.shouldSuppressConversationUpdate;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordMarkRead()', () => {
    it('records a conversation without throwing', () => {
      expect(() => recordMarkRead('conv-1')).not.toThrow();
    });
  });

  describe('shouldSuppressConversationUpdate()', () => {
    it('returns false for a conversation that was never marked read', () => {
      expect(shouldSuppressConversationUpdate('conv-unknown')).toBe(false);
    });

    it('returns true immediately after recording a mark-read', () => {
      recordMarkRead('conv-1');
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(true);
    });

    it('returns true within the 10s TTL window', () => {
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(5_000); // 5 seconds
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(true);
    });

    it('returns true at exactly 10s (boundary)', () => {
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(10_000); // exactly 10 seconds
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(true);
    });

    it('returns false after the 10s TTL expires', () => {
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(10_001); // just past 10 seconds
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(false);
    });

    it('does not suppress unrelated conversations', () => {
      recordMarkRead('conv-1');
      expect(shouldSuppressConversationUpdate('conv-2')).toBe(false);
    });

    it('tracks multiple conversations independently', () => {
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(5_000);
      recordMarkRead('conv-2');
      vi.advanceTimersByTime(5_001);

      // conv-1 was recorded 10,001ms ago — should be expired
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(false);
      // conv-2 was recorded 5,001ms ago — still active
      expect(shouldSuppressConversationUpdate('conv-2')).toBe(true);
    });

    it('cleans up expired entries during check (lazy GC)', () => {
      recordMarkRead('conv-old');
      vi.advanceTimersByTime(11_000); // well past TTL

      // Checking any conversation triggers GC of expired entries
      shouldSuppressConversationUpdate('conv-other');

      // Now conv-old should not suppress even if we go back and check
      expect(shouldSuppressConversationUpdate('conv-old')).toBe(false);
    });

    it('refreshes timestamp when re-recording the same conversation', () => {
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(8_000);

      // Re-record, resetting the timer
      recordMarkRead('conv-1');
      vi.advanceTimersByTime(8_000);

      // 8s since last record — still within window
      expect(shouldSuppressConversationUpdate('conv-1')).toBe(true);
    });
  });
});
