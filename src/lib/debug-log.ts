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

/**
 * Strip personally-identifying LinkedIn identifiers (member/conversation/profile
 * URNs and bare member IDs) from a log line. Stored log entries are exportable
 * via the "Report a bug" flow, so in production builds we scrub them first.
 */
export function redactPII(text: string): string {
  return text
    // urn:li:msg_conversation:(...) and other parenthesized URNs
    .replace(/urn:li:[a-zA-Z_]+:\([^)]*\)/g, (m) => `${m.slice(0, m.indexOf(':('))}:[redacted]`)
    // urn:li:fsd_profile:ACoAA... and other bare-id URNs
    .replace(/urn:li:[a-zA-Z_]+:[A-Za-z0-9_-]+/g, (m) => `${m.slice(0, m.lastIndexOf(':'))}:[redacted]`)
    // bare member/profile id tokens (e.g. ACoAAB...)
    .replace(/\bACoAA[A-Za-z0-9_-]{8,}/g, '[id]');
}

export function debugLog(level: LogEntry['level'], ...args: unknown[]) {
  let message = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');

  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH) + `… (truncated)`;
  }

  // Scrub URNs/IDs from stored (exportable) entries in production. Dev keeps
  // full detail; the raw console output below is unaffected on either.
  if (!import.meta.env.DEV) message = redactPII(message);

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
