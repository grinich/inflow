/**
 * LinkedIn's Voyager GraphQL variables use a special encoding format.
 * Chrome's fetch() normalizes %28/%29 back to () since parentheses are valid
 * in URL query strings. We must manually encode the URL to match exactly
 * what LinkedIn's frontend sends.
 */

/**
 * Encode a URN value for use in LinkedIn GraphQL variables.
 * Encodes : ( ) , = but leaves alphanumeric, -, _ alone.
 */
export function encodeUrnChars(s: string): string {
  return s
    .replace(/%/g, '%25') // must run first so we don't double-encode the escapes below
    .replace(/:/g, '%3A')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/,/g, '%2C')
    .replace(/=/g, '%3D')
    .replace(/&/g, '%26')
    .replace(/#/g, '%23')
    .replace(/\+/g, '%2B')
    .replace(/ /g, '%20');
}

/**
 * Build a LinkedIn GraphQL variables string with multiple key-value pairs.
 * Values that are strings get URN-encoded; numbers and booleans are left as-is.
 * Use `raw()` wrapper to pass values without encoding (e.g. List() expressions).
 */
export function linkedInVariables(params: Record<string, string | number | boolean | RawValue>): string {
  const parts = Object.entries(params).map(([key, value]) => {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${key}:${value}`;
    }
    if (value && typeof value === 'object' && '__raw' in value) {
      return `${key}:${value.__raw}`;
    }
    return `${key}:${encodeUrnChars(value as string)}`;
  });
  return `(${parts.join(',')})`;
}

/** Wrapper to pass raw (unencoded) values to linkedInVariables. */
export interface RawValue { __raw: string }
export function raw(value: string): RawValue {
  return { __raw: value };
}

/**
 * Encode a conversation URN for use in Voyager Dash API query parameters.
 * e.g. urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc) -> urn%3Ali%3Amsg_conversation%3A%28...%29
 */
export function encodeConversationUrn(memberUrn: string, conversationId: string): string {
  const fullUrn = `urn:li:msg_conversation:(${memberUrn},${conversationId})`;
  return encodeUrnChars(fullUrn);
}
