import { validateInput } from '@/lib/agent-tools/validate';
import type { ToolInputSchema } from '@/lib/agent-tools/types';

const schema: ToolInputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tab: { type: 'string', enum: ['focused', 'other'] },
    note: { type: 'string', maxLength: 5 },
    limit: { type: 'number', minimum: 1, maximum: 10 },
    flag: { type: 'boolean' },
  },
  required: ['id'],
};

describe('validateInput', () => {
  it('accepts valid input and treats null/undefined as empty object', () => {
    const ok = validateInput(schema, { id: 'x', limit: 5, flag: true });
    expect(ok).toEqual({ ok: true, value: { id: 'x', limit: 5, flag: true } });
    // No required keys → {} is fine
    const empty = validateInput({ type: 'object', properties: {} }, undefined);
    expect(empty.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    for (const bad of ['str', 42, [1, 2]]) {
      const r = validateInput(schema, bad);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects unknown keys, naming the key', () => {
    const r = validateInput(schema, { id: 'x', tabb: 'focused' });
    expect(r).toEqual({ ok: false, error: 'unknown parameter "tabb"' });
  });

  it('rejects missing required keys, naming the key', () => {
    const r = validateInput(schema, {});
    expect(r).toEqual({ ok: false, error: 'missing required parameter "id"' });
  });

  it('type-checks strings, numbers, booleans', () => {
    expect(validateInput(schema, { id: 7 })).toMatchObject({ ok: false, error: '"id" must be a string' });
    expect(validateInput(schema, { id: 'x', limit: '5' })).toMatchObject({ ok: false });
    expect(validateInput(schema, { id: 'x', limit: NaN })).toMatchObject({ ok: false });
    expect(validateInput(schema, { id: 'x', flag: 'yes' })).toMatchObject({ ok: false });
  });

  it('enforces enum, maxLength, minimum, maximum', () => {
    expect(validateInput(schema, { id: 'x', tab: 'spam' })).toMatchObject({
      ok: false, error: '"tab" must be one of: focused, other',
    });
    expect(validateInput(schema, { id: 'x', note: 'toolong' })).toMatchObject({
      ok: false, error: '"note" exceeds max length 5',
    });
    expect(validateInput(schema, { id: 'x', limit: 0 })).toMatchObject({
      ok: false, error: '"limit" must be >= 1',
    });
    expect(validateInput(schema, { id: 'x', limit: 11 })).toMatchObject({
      ok: false, error: '"limit" must be <= 10',
    });
  });
});
