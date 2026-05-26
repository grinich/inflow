import { linkedInVariables, encodeConversationUrn, raw } from '../../entrypoints/background/api/encode';

describe('encode', () => {
  describe('linkedInVariables()', () => {
    it('encodes string values with URN-safe encoding', () => {
      const result = linkedInVariables({ mailboxUrn: 'urn:li:fsd_profile:ABC123' });
      expect(result).toBe('(mailboxUrn:urn%3Ali%3Afsd_profile%3AABC123)');
    });

    it('passes number values through unencoded', () => {
      const result = linkedInVariables({ count: 20 });
      expect(result).toBe('(count:20)');
    });

    it('passes boolean values through unencoded', () => {
      const result = linkedInVariables({ showRead: true });
      expect(result).toBe('(showRead:true)');
    });

    it('handles multiple key-value pairs', () => {
      const result = linkedInVariables({
        mailboxUrn: 'urn:li:fsd_profile:ABC',
        count: 10,
        includeRead: false,
      });
      expect(result).toBe(
        '(mailboxUrn:urn%3Ali%3Afsd_profile%3AABC,count:10,includeRead:false)'
      );
    });

    it('encodes parentheses in string values', () => {
      const result = linkedInVariables({
        conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:AAA,2-bbb)',
      });
      expect(result).toContain('%28');
      expect(result).toContain('%29');
      expect(result).not.toContain('(urn');
    });

    it('encodes commas in string values', () => {
      const result = linkedInVariables({
        urn: 'urn:li:msg_conversation:(a,b)',
      });
      expect(result).toContain('%2C');
    });

    it('encodes equals signs in string values', () => {
      const result = linkedInVariables({ key: 'ACoAAA==' });
      expect(result).toBe('(key:ACoAAA%3D%3D)');
    });

    it('encodes spaces in string values', () => {
      const result = linkedInVariables({ query: 'hello world' });
      expect(result).toBe('(query:hello%20world)');
    });

    it('passes raw() wrapped values without encoding', () => {
      const result = linkedInVariables({
        categories: raw('List(INBOX)'),
      });
      expect(result).toBe('(categories:List(INBOX))');
    });

    it('mixes raw, string, number, and boolean values', () => {
      const result = linkedInVariables({
        mailboxUrn: 'urn:li:fsd_profile:X',
        count: 5,
        active: true,
        categories: raw('List(PRIMARY_INBOX)'),
      });
      expect(result).toBe(
        '(mailboxUrn:urn%3Ali%3Afsd_profile%3AX,count:5,active:true,categories:List(PRIMARY_INBOX))'
      );
    });

    it('returns empty parens for empty params', () => {
      const result = linkedInVariables({});
      expect(result).toBe('()');
    });
  });

  describe('encodeConversationUrn()', () => {
    it('builds and encodes a full conversation URN', () => {
      const result = encodeConversationUrn(
        'urn:li:fsd_profile:ACoAABcdEfG',
        '2-abc123def'
      );
      expect(result).toBe(
        'urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AACoAABcdEfG%2C2-abc123def%29'
      );
    });

    it('preserves hyphens and alphanumerics in conversation ID', () => {
      const result = encodeConversationUrn(
        'urn:li:fsd_profile:ABC',
        '2-xyz789'
      );
      // Hyphens and alphanumeric should NOT be encoded
      expect(result).toContain('2-xyz789');
    });

    it('encodes all special URN characters', () => {
      const result = encodeConversationUrn(
        'urn:li:fsd_profile:ABC',
        '2-test'
      );
      // No raw colons, parens, or commas
      expect(result).not.toContain(':');
      expect(result).not.toContain('(');
      expect(result).not.toContain(')');
      expect(result).not.toContain(',');
    });
  });

  describe('raw()', () => {
    it('returns an object with __raw property', () => {
      const result = raw('List(INBOX)');
      expect(result).toEqual({ __raw: 'List(INBOX)' });
    });

    it('wraps empty string', () => {
      const result = raw('');
      expect(result).toEqual({ __raw: '' });
    });
  });
});
