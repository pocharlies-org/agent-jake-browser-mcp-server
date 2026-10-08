/**
 * Contract v3 (INFRA-721): the tool set grew, so the catalog is a NEW entry next to the frozen v2 one. v2 is never
 * edited (its digest is pinned below as a literal) and v3 only adds.
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOG_VERSION,
  CATALOG_VERSION_V2,
  FILL_SECRET_ARGS,
  PASSKEY_ARGS,
  TOOL_CATALOG,
  TOOL_CATALOG_V2,
  computeCatalogDigest,
} from '../src/index.js';

/** Digest of the catalog of browser-harness-v2.md as merged in M1B. If this literal has to change, the contract was edited: don't. */
const V2_DIGEST = 'sha256:f7e7d2f5178afea3caa13fd262b7e1c81afe94cf550bbaceea3bd30e25cfe9b5';

describe('catalog v2 is frozen, v3 only adds', () => {
  it('v2 keeps its published digest and its 40 tools', () => {
    expect(computeCatalogDigest(TOOL_CATALOG_V2)).toBe(V2_DIGEST);
    expect(CATALOG_VERSION_V2).toBe(V2_DIGEST);
    expect(TOOL_CATALOG_V2).toHaveLength(40);
  });
  it('v3 = v2 untouched + browser_fill_secret + browser_passkey, under a different digest', () => {
    expect(TOOL_CATALOG.slice(0, 40)).toEqual([...TOOL_CATALOG_V2]);
    expect(TOOL_CATALOG.slice(40).map((t) => t.name)).toEqual(['browser_fill_secret', 'browser_passkey']);
    expect(CATALOG_VERSION).not.toBe(V2_DIGEST);
    expect(CATALOG_VERSION).toBe(computeCatalogDigest(TOOL_CATALOG));
  });
  it('the new entries say what they are: server-process only, and a capability the browser must offer', () => {
    const by = Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, t]));
    expect(by.browser_fill_secret).toMatchObject({ risk: 'dangerous', serverSide: true });
    expect(by.browser_passkey).toMatchObject({ risk: 'dangerous', capability: 'passkey' });
  });
});

describe('argument schemas of the added tools live here, strict about what they take', () => {
  it('fill_secret needs an op:// reference without control characters, and a target', () => {
    const ok = { selector: '#pw', secretRef: 'op://vault with spaces/item/field?attribute=otp' };
    expect(FILL_SECRET_ARGS.parse(ok)).toMatchObject({ ...ok, clear: true });
    for (const bad of [{ selector: '#pw', secretRef: 'op:/x' }, { selector: '#pw', secretRef: 'op://a\nb' }, { secretRef: 'op://a/b/c' }]) {
      expect(FILL_SECRET_ARGS.safeParse(bad).success).toBe(false);
    }
  });
  it('passkey needs a mode and a target', () => {
    expect(PASSKEY_ARGS.safeParse({ ref: 'e1', mode: 'use' }).success).toBe(true);
    for (const bad of [{ ref: 'e1' }, { ref: 'e1', mode: 'steal' }, { mode: 'use' }]) {
      expect(PASSKEY_ARGS.safeParse(bad).success).toBe(false);
    }
  });
});
