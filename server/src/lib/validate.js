import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses `data` with a zod schema, turning failures into a 400 with per-field messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.entries(fields)[0];
    throw badRequest(first ? `${first[0]}: ${first[1]}` : 'Invalid input', { fields });
  }
  return result.data;
}

export const uuid = z.string().uuid();

/** Converts a decimal amount like "1234.5" or 1234.5 into integer minor units (123450). */
export function toMinor(amount) {
  const str = typeof amount === 'number' ? amount.toFixed(2) : String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw badRequest('Amount must be a positive number with at most 2 decimals');
  const [whole, frac = ''] = str.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const moneyInput = z.union([z.number(), z.string()]).transform((v, ctx) => {
  try {
    return toMinor(v);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e.message });
    return z.NEVER;
  }
});
