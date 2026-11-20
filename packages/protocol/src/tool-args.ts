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

/** Argumentos de los plugins del servidor (INFRA-909): herramientas que no tocan el navegador. */
export const DELEGAR_ARGS = z.object({
  orden: z.string().min(1).describe('Qué tiene que hacer el agente, con todo el contexto necesario.'),
  titulo: z.string().max(60).optional().describe('Título corto del agente (<= 60 caracteres).'),
  proveedor: z.string().optional().describe('Par proveedor/modelo, p. ej. claude/qwen38-flash-next. Por defecto, el del servidor.'),
});

export const DELEGAR_ESTADO_ARGS = z.object({
  agente: z.string().min(1).describe('El id que devolvió `delegar`.'),
});

export const PASSKEY_ARGS = z
  .object({
    ref: z.string().optional().describe('Element reference from browser_state/snapshot of the button that starts the passkey ceremony'),
    selector: z.string().optional().describe('CSS selector of that button'),
    mode: z
      .enum(['enroll', 'use'])
      .describe('"use" signs in with the agent passkey enrolled for the tab host; "enroll" creates it (the site must be signed in)'),
  })
  .refine(target, TARGET_MESSAGE);

/** Destination of `browser_save_secret`: one field of one item of one vault. */
export const SAVE_SECRET_DESTINATION = z.object({
  vault: z.string().describe('1Password vault, by name or id. Must be one the server allows (AGENT_BROWSER_SAVE_VAULTS)'),
  item: z.string().describe('Item title, or its 26-character id. Created when no item has that title'),
  field: z.string().describe('Field label (or id) that receives the value'),
});

/**
 * Arguments of `browser_save_secret` (SC-2102): copy a value shown on the page into a 1Password
 * field. At least one of ref/selector/regex picks the value; the value itself is never an argument.
 */
export const SAVE_SECRET_ARGS = z
  .object({
    ref: z.string().optional().describe('Element reference from browser_state/snapshot'),
    selector: z.string().optional().describe('CSS selector; it must match exactly one element'),
    regex: z.string().min(1).max(256).optional().describe('Regex (no flags) whose capture group 1 is the value, applied to the element text (or the page text without ref/selector)'),
    destination: SAVE_SECRET_DESTINATION,
    type: z.enum(['concealed', 'otp']).optional().default('concealed').describe('Kind of 1Password field'),
    template: z.string().max(512).optional().describe('Fixed text around the value, with {value} once. Never put a secret in it'),
    overwrite: z.boolean().optional().default(false).describe('Replace a field that already has a value'),
  })
  .refine((data) => Boolean(data.ref || data.selector || data.regex), { message: 'ref, selector or regex must be provided' });
