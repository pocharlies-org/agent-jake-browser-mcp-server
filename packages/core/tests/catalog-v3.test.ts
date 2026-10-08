/** Contract v3 (INFRA-721): a browser that vendored the frozen v2 catalog is rejected explicitly. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_VERSION, CATALOG_VERSION_V2 } from '@agent-jake-browser/protocol';
import { createHarnessServer, type HarnessServer } from '../src/harness-server.js';
import { TOKEN, connect, helloFrame, type TestClient } from './harness-helpers.js';

describe('a browser that vendored the v2 catalog is rejected explicitly', () => {
  let harness: HarnessServer;
  let port: number;
  const open: TestClient[] = [];
  const prevToken = process.env.BROWSER_WS_TOKEN;
  beforeAll(async () => {
    process.env.BROWSER_WS_TOKEN = TOKEN;
    harness = createHarnessServer({ port: 0 });
    await harness.listening;
    port = harness.port();
  });
  afterAll(async () => {
    await harness.close();
    if (prevToken === undefined) delete process.env.BROWSER_WS_TOKEN;
    else process.env.BROWSER_WS_TOKEN = prevToken;
  });
  afterEach(() => {
    for (const c of open.splice(0)) c.close();
  });

  it('hello with the v2 digest => hello_reject catalog_version_mismatch, 4406, never registered', async () => {
    const c = await connect(port);
    open.push(c);
    c.send(helloFrame({ catalogVersion: CATALOG_VERSION_V2 }));
    const reply = await c.next();
    expect(reply).toMatchObject({ type: 'hello_reject', error: { code: 'catalog_version_mismatch' } });
    expect((await c.closed).code).toBe(4406);
    expect(harness.broker.list()).toEqual([]);
  });
  it('hello with the v3 digest is accepted', async () => {
    const c = await connect(port);
    open.push(c);
    c.send(helloFrame({ catalogVersion: CATALOG_VERSION }));
    expect((await c.next()).type).toBe('hello_ack');
  });
});
