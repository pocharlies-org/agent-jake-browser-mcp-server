/** A negotiated endpoint for one test file: starts before its tests, closes (and restores the token env) after them. */
import { afterAll, beforeAll } from 'vitest';
import { createHarnessServer, type HarnessServer } from '../src/harness-server.js';
import { TOKEN, ready, type TestClient } from './harness-helpers.js';

export function useHarness() {
  let harness: HarnessServer;
  const open: TestClient[] = [];
  const prevToken = process.env.BROWSER_WS_TOKEN;
  beforeAll(async () => {
    process.env.BROWSER_WS_TOKEN = TOKEN;
    harness = createHarnessServer({ port: 0, house: 'house-a' });
    await harness.listening;
  });
  afterAll(async () => {
    for (const c of open.splice(0)) c.close();
    await harness.close();
    if (prevToken === undefined) delete process.env.BROWSER_WS_TOKEN;
    else process.env.BROWSER_WS_TOKEN = prevToken;
  });
  return {
    harness: () => harness,
    /** Connect a browser, say hello, wait for the ack; it is closed with the file. */
    async browser(hello: Record<string, unknown> = {}) {
      const r = await ready(harness.port(), hello);
      open.push(r.client);
      return r;
    },
  };
}
