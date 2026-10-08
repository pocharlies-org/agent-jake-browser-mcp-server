import { z } from 'zod';

/**
 * Argument schemas of the tools added after the M1B catalog (contract v3). They live here, in the only schema home;
 * core builds its MCP tools from them. The older tools' schemas are still in core until M1B.3 moves them.
 */

const target = (data: { ref?: string; selector?: string }) => Boolean(data.ref || data.selector);
const TARGET_MESSAGE = { message: 'Either ref or selector must be provided' };

/** `op://vault/item/field`, optionally `?attribute=otp`. Spaces are legal (vault names), control characters are not. */
export const SECRET_REF = /^op:\/\/[^\u0000-\u001f\u007f]+$/;

export const FILL_SECRET_ARGS = z
  .object({
    ref: z.string().optional().describe('Element reference from browser_state/snapshot'),
    selector: z.string().optional().describe('CSS selector to find the element'),
    secretRef: z
      .string()
      .regex(SECRET_REF, 'secretRef must be an op:// reference')
      .describe('1Password secret reference, op://vault/item/field. TOTP code: op://vault/item/<OTP field id>?attribute=otp'),
    clear: z.boolean().optional().default(true).describe('Clear existing text before typing'),
  })
  .refine(target, TARGET_MESSAGE);

export const PASSKEY_ARGS = z
  .object({
    ref: z.string().optional().describe('Element reference from browser_state/snapshot of the button that starts the passkey ceremony'),
    selector: z.string().optional().describe('CSS selector of that button'),
    mode: z
      .enum(['enroll', 'use'])
      .describe('"use" signs in with the agent passkey enrolled for the tab host; "enroll" creates it (the site must be signed in)'),
  })
  .refine(target, TARGET_MESSAGE);
