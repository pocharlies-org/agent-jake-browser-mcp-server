/**
 * What the extension CI published: latest.json (read by the installed extensions' update check) and the zip /download
 * serves. The module reads a folder; the HTTP routes expose it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionZipPath, readPublishedVersion, PUBLISHED_ZIP_NAME } from '../src/published-extension.js';
import { createHttpServer, type HttpServer } from '../src/http/server.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ajb-pub-'));
const LATEST = { version: '2.4.0.119', build: 119, sha: '1e729af', publishedAt: '2026-10-03T10:00:00Z' };

describe('readPublishedVersion', () => {
  it('reads a published build', () => {
    const d = dir();
    writeFileSync(join(d, 'latest.json'), JSON.stringify({ ...LATEST, extra: 'ignored' }));
    expect(readPublishedVersion(d)).toEqual(LATEST);
  });

  it('reads nothing when nothing or garbage was published', () => {
    expect(readPublishedVersion(dir())).toBeNull();
    const d = dir();
    writeFileSync(join(d, 'latest.json'), '{not json');
    expect(readPublishedVersion(d)).toBeNull();
    writeFileSync(join(d, 'latest.json'), JSON.stringify({ ...LATEST, build: '119' }));
    expect(readPublishedVersion(d)).toBeNull();
  });
});

describe('extensionZipPath', () => {
  it('prefers an explicit BROWSER_EXTENSION_ZIP, then the published zip, then the image one', () => {
    const d = dir();
    expect(extensionZipPath({ BROWSER_EXTENSION_ZIP: '/x.zip' }, d)).toBe('/x.zip');
    expect(extensionZipPath({}, d)).toBe('/app/extension/agent-jake-browser-extension.zip');
    writeFileSync(join(d, PUBLISHED_ZIP_NAME), 'zip');
    expect(extensionZipPath({}, d)).toBe(join(d, PUBLISHED_ZIP_NAME));
  });
});

describe('GET /download/latest.json and /download', () => {
  let published: string;
  let http: HttpServer;
  let base: string;
  const prevZip = process.env.BROWSER_EXTENSION_ZIP;
  beforeAll(async () => {
    delete process.env.BROWSER_EXTENSION_ZIP;
    published = dir();
    http = createHttpServer({ port: 0, wsPort: 0, extensionDir: published });
    base = `http://127.0.0.1:${((await http.listen()).address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await http.close();
    rmSync(published, { recursive: true, force: true });
    if (prevZip !== undefined) process.env.BROWSER_EXTENSION_ZIP = prevZip;
  });

  it('is a 404 with nothing published, and also for a malformed file', async () => {
    expect((await fetch(`${base}/download/latest.json`)).status).toBe(404);
    writeFileSync(join(published, 'latest.json'), '{not json');
    expect((await fetch(`${base}/download/latest.json`)).status).toBe(404);
  });

  it('serves the published build, uncached, readable from the extension origin, and points at /download', async () => {
    writeFileSync(join(published, 'latest.json'), JSON.stringify(LATEST));
    const res = await fetch(`${base}/download/latest.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ ...LATEST, download: '/download' });
  });

  it('/download serves the published zip as soon as it appears, without a restart', async () => {
    writeFileSync(join(published, PUBLISHED_ZIP_NAME), 'published-zip-bytes');
    const res = await fetch(`${base}/download`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('published-zip-bytes');
  });
});
