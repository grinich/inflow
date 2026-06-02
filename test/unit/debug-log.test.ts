describe('debug-log', () => {
  let debugLog: typeof import('@/lib/debug-log').debugLog;
  let getDebugLogs: typeof import('@/lib/debug-log').getDebugLogs;
  let clearDebugLogs: typeof import('@/lib/debug-log').clearDebugLogs;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('@/lib/debug-log');
    debugLog = mod.debugLog;
    getDebugLogs = mod.getDebugLogs;
    clearDebugLogs = mod.clearDebugLogs;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('debugLog()', () => {
    it('adds an info entry to the log', () => {
      debugLog('info', 'hello');
      const logs = getDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('hello');
    });

    it('adds a warn entry to the log', () => {
      debugLog('warn', 'caution');
      const logs = getDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toBe('caution');
    });

    it('adds an error entry to the log', () => {
      debugLog('error', 'something broke');
      const logs = getDebugLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('something broke');
    });

    it('sets a timestamp on the entry', () => {
      const before = Date.now();
      debugLog('info', 'timestamped');
      const after = Date.now();
      const logs = getDebugLogs();
      expect(logs[0].ts).toBeGreaterThanOrEqual(before);
      expect(logs[0].ts).toBeLessThanOrEqual(after);
    });

    it('joins multiple arguments with spaces', () => {
      debugLog('info', 'part1', 'part2', 'part3');
      const logs = getDebugLogs();
      expect(logs[0].message).toBe('part1 part2 part3');
    });

    it('JSON-stringifies non-string arguments', () => {
      debugLog('info', 'data:', { key: 'value' });
      const logs = getDebugLogs();
      expect(logs[0].message).toContain('data:');
      expect(logs[0].message).toContain('"key":"value"');
    });

    it('forwards info messages to console.log', () => {
      debugLog('info', 'forwarded');
      expect(console.log).toHaveBeenCalledWith('[Inflow]', 'forwarded');
    });

    it('forwards warn messages to console.warn', () => {
      debugLog('warn', 'warning');
      expect(console.warn).toHaveBeenCalledWith('[Inflow]', 'warning');
    });

    it('forwards error messages to console.error', () => {
      debugLog('error', 'error msg');
      expect(console.error).toHaveBeenCalledWith('[Inflow]', 'error msg');
    });

    it('caps entries at 200 (MAX_ENTRIES)', () => {
      for (let i = 0; i < 210; i++) {
        debugLog('info', `msg-${i}`);
      }
      const logs = getDebugLogs();
      expect(logs).toHaveLength(200);
      // The first 10 should have been shifted off
      expect(logs[0].message).toBe('msg-10');
      expect(logs[199].message).toBe('msg-209');
    });
  });

  describe('getDebugLogs()', () => {
    it('returns an empty array when no logs exist', () => {
      expect(getDebugLogs()).toEqual([]);
    });

    it('returns a copy of the logs (not the internal array)', () => {
      debugLog('info', 'test');
      const logs1 = getDebugLogs();
      const logs2 = getDebugLogs();
      expect(logs1).toEqual(logs2);
      expect(logs1).not.toBe(logs2);
    });
  });

  describe('clearDebugLogs()', () => {
    it('removes all log entries', () => {
      debugLog('info', 'one');
      debugLog('warn', 'two');
      debugLog('error', 'three');
      expect(getDebugLogs()).toHaveLength(3);
      clearDebugLogs();
      expect(getDebugLogs()).toHaveLength(0);
    });

    it('is idempotent on empty logs', () => {
      clearDebugLogs();
      expect(getDebugLogs()).toEqual([]);
    });
  });
});
