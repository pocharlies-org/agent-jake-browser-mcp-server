#!/usr/bin/env node
/**
 * Does the protocol artifact a consumer vendored equal the pack of THIS source?
 * verify.mjs proves an artifact is consistent with its own provenance; this proves it is the one pack.mjs builds
 * from packages/protocol today (a forged-but-consistent or stale tgz passes verify, not this).
 *
 *   node compare.mjs <vendored.tgz> <vendored provenance.json> <source.tgz> <source provenance.json>
 *
 * Content, not gzip bytes: compares the extracted files and the recorded wire/catalog versions.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyArtifact } from './verify.mjs';

const extract = (tgz, dir) => execFileSync('tar', ['-xzf', tgz, '-C', dir]);
/** `diff -r` exits 1 on differences; its listing is the evidence. */
function diffTrees(a, b) {
  try {
    execFileSync('diff', ['-rq', a, b], { encoding: 'utf8' });
    return '';
  } catch (err) {
    if (err.status !== 1) throw err;
    return String(err.stdout).split(a).join('vendored').split(b).join('source').trim();
  }
}

/** Returns { ok, errors[] }; never throws for a bad artifact. */
export async function compareArtifacts({ vendored, source }) {
  const own = await verifyArtifact(vendored);
  const errors = own.errors.map((e) => `vendored artifact: ${e}`);
  const dir = mkdtempSync(join(tmpdir(), 'ajb-compare-'));
  try {
    mkdirSync(join(dir, 'vendored'));
    mkdirSync(join(dir, 'source'));
    extract(vendored.tgz, join(dir, 'vendored'));
    extract(source.tgz, join(dir, 'source'));
    const diff = diffTrees(join(dir, 'vendored'), join(dir, 'source'));
    if (diff) errors.push(`vendored tgz differs from the pack of this source:\n${diff}`);
  } catch (err) {
    errors.push(`comparison failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const v = JSON.parse(readFileSync(vendored.provenance, 'utf8'));
  const s = JSON.parse(readFileSync(source.provenance, 'utf8'));
  if (v.catalogVersion !== s.catalogVersion) errors.push(`catalogVersion: vendored ${v.catalogVersion}, source ${s.catalogVersion}`);
  if (JSON.stringify(v.supportedProtocolVersions) !== JSON.stringify(s.supportedProtocolVersions)) {
    errors.push(`supportedProtocolVersions: vendored ${JSON.stringify(v.supportedProtocolVersions)}, source ${JSON.stringify(s.supportedProtocolVersions)}`);
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [vTgz, vProv, sTgz, sProv] = process.argv.slice(2);
  if (!sProv) {
    console.error('usage: compare.mjs <vendored.tgz> <vendored provenance.json> <source.tgz> <source provenance.json>');
    process.exit(2);
  }
  const { ok, errors } = await compareArtifacts({
    vendored: { tgz: vTgz, provenance: vProv },
    source: { tgz: sTgz, provenance: sProv },
  });
  if (!ok) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
  }
  console.log('vendored protocol artifact equals the pack of this source');
}
