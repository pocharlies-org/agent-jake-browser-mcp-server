import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// SC-2133: pack.mjs must never rewrite packages/protocol/dist — other test files of the same
// `npm run test:contract` run import it through node_modules while this suite runs in parallel.
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(pkgDir, 'dist');
const sentinel = join(distDir, 'sc2133-pack-must-not-clean-dist.txt');
const work = mkdtempSync(join(tmpdir(), 'ajb-pack-dist-test-'));
afterAll(() => {
  rmSync(sentinel, { force: true });
  rmSync(work, { recursive: true, force: true });
});

describe('pack.mjs leaves this package dist untouched (SC-2133)', () => {
  it('a sentinel inside dist survives a full pack run', () => {
    expect(existsSync(join(distDir, 'index.js'))).toBe(true); // test:contract requires `npm run build` first
    writeFileSync(sentinel, 'must survive pack');
    execFileSync('node', ['tools/pack.mjs', join(work, 'out')], { cwd: pkgDir, stdio: 'pipe' });
    expect(existsSync(sentinel)).toBe(true);
  }, 120_000);
});
