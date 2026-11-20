import { z } from 'zod';

/**
 * Schemas of the 1Password Connect REST responses (API 1.8.1) that `browser_save_secret` reads
 * while resolving a vault and item. They live here, in the only schema home (C6d); core validates
 * the responses against them and never echoes their bodies. `.passthrough()` keeps fields the
 * writer does not look at (and the secret values of other fields) out of the parsed shape's type
 * but inside the raw object it re-sends on a write.
 */
export const CONNECT_ID = z.string().regex(/^[a-z0-9]{26}$/);

export const CONNECT_FIELD = z
  .object({ id: z.string().optional(), label: z.string().optional(), type: z.string().optional(), value: z.string().optional() })
  .passthrough();

export const CONNECT_ITEM = z
  .object({ id: CONNECT_ID, vault: z.object({ id: CONNECT_ID }).passthrough(), version: z.number().int().positive(), fields: z.array(CONNECT_FIELD).optional() })
  .passthrough();

export const CONNECT_VAULT = z.object({ id: CONNECT_ID, name: z.string() });

/** An entry of the `?filter=title eq "..."` list: the writer checks `title`/`vault.id` equal the requested ones. */
export const CONNECT_LIST_ITEM = z.object({ id: CONNECT_ID, title: z.string(), vault: z.object({ id: CONNECT_ID }) });
