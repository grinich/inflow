import type { ToolInputSchema } from './types';

/**
 * Strict input validation against the schema subset in types.ts. Deliberately
 * unforgiving: unknown keys are rejected so a typo'd parameter fails loudly
 * instead of silently acting as a default, and every error names the key so
 * the agent can self-correct.
 */
export function validateInput(
  schema: ToolInputSchema,
  input: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'input must be a JSON object' };
  }
  const value = input as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    if (!schema.properties[key]) {
      return { ok: false, error: `unknown parameter "${key}"` };
    }
  }

  for (const key of schema.required ?? []) {
    if (value[key] === undefined) {
      return { ok: false, error: `missing required parameter "${key}"` };
    }
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = value[key];
    if (v === undefined) continue;
    if (prop.type === 'string') {
      if (typeof v !== 'string') return { ok: false, error: `"${key}" must be a string` };
      if (prop.maxLength !== undefined && v.length > prop.maxLength) {
        return { ok: false, error: `"${key}" exceeds max length ${prop.maxLength}` };
      }
      if (prop.enum && !prop.enum.includes(v)) {
        return { ok: false, error: `"${key}" must be one of: ${prop.enum.join(', ')}` };
      }
    } else if (prop.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, error: `"${key}" must be a number` };
      }
      if (prop.minimum !== undefined && v < prop.minimum) {
        return { ok: false, error: `"${key}" must be >= ${prop.minimum}` };
      }
      if (prop.maximum !== undefined && v > prop.maximum) {
        return { ok: false, error: `"${key}" must be <= ${prop.maximum}` };
      }
    } else if (prop.type === 'boolean') {
      if (typeof v !== 'boolean') return { ok: false, error: `"${key}" must be a boolean` };
    }
  }

  return { ok: true, value };
}
