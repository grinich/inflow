/**
 * In-memory debug log that can be sent from background -> frontend via messages.
 * Background writes logs, frontend reads them via bridge message.
 */

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE_LENGTH = 10_000;
const entries: LogEntry[] = [];

export function debugLog(level: LogEntry['level'], ...args: unknown[]) {
  let message = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');

  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH) + `… (truncated)`;
  }

  entries.push({ ts: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES) entries.shift();

  // Also forward to real console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[Inflow]`, ...args);
}

export function getDebugLogs(): LogEntry[] {
  return [...entries];
}

export function clearDebugLogs(): void {
  entries.length = 0;
}
