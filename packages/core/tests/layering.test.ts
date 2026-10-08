import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const FORBIDDEN = /house-pocharlies|house-staticduo|op-safe/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('core has no houses (D2)', () => {
  for (const pkg of ['packages/core', 'packages/protocol']) {
    it(`${pkg}: no reference to a house adapter or op-safe anywhere in the package`, () => {
      const offenders = walk(join(root, pkg))
        .filter((f) => !f.endsWith('layering.test.ts'))
        .filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});

// C6d (INFRA-390): packages/protocol is the only home of schemas. Until M1B.3 extracts the tool-argument schemas
// from core, the existing ones are listed; a new schema anywhere else (or one more in a listed file) fails here.
// M1B.3 lowers these numbers as schemas move to the protocol. Never raise one: use packages/protocol instead.
const SCHEMA_MARKERS = /\bz\.(?:strict|loose)?[oO]bject\(|type: 'object'|^\s*tool\(/gm;
const BASELINE: Record<string, number> = {
  'packages/core/src/http/server.ts': 1,
  'packages/core/src/tools/connections.ts': 1,
  'packages/core/src/tools/interaction.ts': 10,
  'packages/core/src/tools/navigation.ts': 4,
  'packages/core/src/tools/queries.ts': 5,
  'packages/core/src/tools/snapshot.ts': 1,
  'packages/core/src/tools/state.ts': 2,
  'packages/core/src/tools/tabs.ts': 7,
  'packages/core/src/tools/utility.ts': 12,
};

/** Schema markers per source file of every package but the protocol. */
function schemaCopies(base: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const pkg of readdirSync(join(base, 'packages')).filter((p) => p !== 'protocol')) {
    const src = join(base, 'packages', pkg, 'src');
    for (const f of statSync(src, { throwIfNoEntry: false })?.isDirectory() ? walk(src) : []) {
      const n = readFileSync(f, 'utf8').match(SCHEMA_MARKERS)?.length ?? 0;
      if (n) found[relative(base, f)] = n;
    }
  }
  return found;
}
const offenders = (found: Record<string, number>) =>
  [...new Set([...Object.keys(found), ...Object.keys(BASELINE)])].filter((f) => found[f] !== BASELINE[f]).sort();

describe('protocol is the only schema source (C6d)', () => {
  it('core and the houses hold no schema beyond the listed ones', () => {
    expect(offenders(schemaCopies(root))).toEqual([]);
  });
  describe('fails on a new copy', () => {
    const dirs: string[] = [];
    /** A fresh tree with the listed layout (n markers per listed file) plus `extra` files. */
    const tree = (extra: Record<string, string> = {}) => {
      const tmp = mkdtempSync(join(tmpdir(), 'ajb-schemas-'));
      dirs.push(tmp);
      const files = { ...Object.fromEntries(Object.entries(BASELINE).map(([rel, n]) => [rel, 'z.object({})\n'.repeat(n)])), ...extra };
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(tmp, rel)), { recursive: true });
        writeFileSync(join(tmp, rel), text);
      }
      return tmp;
    };
    afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

    it('the listed layout is clean', () => expect(offenders(schemaCopies(tree()))).toEqual([]));
    it('a schema in a new file (a house, say)', () => {
      const tmp = tree({ 'packages/house-pocharlies/src/copy.ts': 'export const S = z.object({ url: z.string() });\n' });
      expect(offenders(schemaCopies(tmp))).toEqual(['packages/house-pocharlies/src/copy.ts']);
    });
    it('one more schema in a listed file', () => {
      const tmp = tree({ 'packages/core/src/tools/state.ts': 'z.object({})\n'.repeat(3) });
      expect(offenders(schemaCopies(tmp))).toEqual(['packages/core/src/tools/state.ts']);
    });
  });
});
