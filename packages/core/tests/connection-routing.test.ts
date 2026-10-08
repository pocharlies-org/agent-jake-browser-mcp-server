/**
 * Browser choice on the LEGACY endpoint (INFRA-721, C7b): connection names and a configured default from the deployment
 * (AGENT_BROWSER_CONNECTION_LABELS / AGENT_BROWSER_DEFAULT_CONNECTION), a choice that belongs to each MCP session, and
 * no guessing between several browsers. The negotiated endpoint keeps binding through the SessionBroker.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createHttpServer, type HttpServer } from '../src/http/server.js';
import { TOKEN, ready, type TestClient } from './harness-helpers.js';

const WORK = 'a1b2c3d4-0001-4000-8000-000000000001';
const HOME = 'a1b2c3d4-0002-4000-8000-000000000002';
const LABELS = { [WORK]: 'work', [HOME]: 'home' };

interface FakeExtension { socket: WebSocket; messages: Array<Record<string, any>> }
const sockets: WebSocket[] = [];
const servers: HttpServer[] = [];

const wsPortOf = (http: HttpServer) => (http.context.wsServer.server.address() as AddressInfo).port;
async function start(options: Parameters<typeof createHttpServer>[0]) {
  const http = createHttpServer({ port: 0, wsPort: 0, ...options });
  servers.push(http);
  const base = `http://127.0.0.1:${((await http.listen()).address() as AddressInfo).port}`;
  return { http, base };
}

function connectExtension(http: HttpServer, connectionId: string, label?: string): Promise<FakeExtension> {
  const query = new URLSearchParams({ connectionId, ...(label ? { label } : {}) });
  const socket = new WebSocket(`ws://127.0.0.1:${wsPortOf(http)}/?${query}`);
  sockets.push(socket);
  const messages: Array<Record<string, any>> = [];
  socket.on('message', (data) => {
    const m = JSON.parse(data.toString());
    messages.push(m);
    socket.send(JSON.stringify({ id: m.id, success: true, result: { ok: true } }));
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () => resolve({ socket, messages }));
  });
}

const ACCEPT = 'application/json, text/event-stream';
const payload = (text: string): any => {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const line = t.split('\n').find((l) => l.startsWith('data:'));
  return line ? JSON.parse(line.slice(5)) : null;
};
async function mcpSession(base: string) {
  const post = (body: unknown, sid?: string) =>
    fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: ACCEPT, ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '1' } } });
  const sid = init.headers.get('mcp-session-id')!;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
  let n = 1;
  return async (name: string, args: Record<string, unknown> = {}) => {
    n += 1;
    const res = await post({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } }, sid);
    return payload(await res.text()).result;
  };
}
const open = async (http: HttpServer, n: number) => {
  for (let i = 0; i < 100 && http.context.listConnections().filter((c) => c.open).length < n; i += 1) await new Promise((r) => setTimeout(r, 20));
};

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const h of servers.splice(0)) await h.close();
});

describe('labelled browsers on the legacy endpoint', () => {
  it('a call without `connection` goes to the connection labelled home, the configured default', async () => {
    const { http, base } = await start({ connectionLabels: LABELS, defaultConnection: 'home' });
    const work = await connectExtension(http, WORK);
    const home = await connectExtension(http, HOME);
    await open(http, 2);
    const call = await mcpSession(base);

    const r = await call('browser_reload');
    expect(r.isError).toBeUndefined();
    expect(home.messages.map((m) => m.type)).toEqual(['browser_reload']);
    expect(work.messages).toEqual([]);
  });

  it('a name chosen in a call sticks for THAT session only; other sessions keep the default; `connection` never reaches the browser', async () => {
    const { http, base } = await start({ connectionLabels: LABELS, defaultConnection: 'home' });
    const work = await connectExtension(http, WORK);
    const home = await connectExtension(http, HOME);
    await open(http, 2);
    const a = await mcpSession(base);
    const b = await mcpSession(base);

    await a('browser_navigate', { url: 'https://example.com', connection: 'work' });
    await a('browser_reload'); // no connection: A's own choice
    await b('browser_reload'); // B never chose: the default
    expect(work.messages.map((m) => m.type)).toEqual(['browser_navigate', 'browser_reload']);
    expect(home.messages.map((m) => m.type)).toEqual(['browser_reload']);
    expect(JSON.stringify(work.messages)).not.toContain('connection');
  });

  it('with the chosen browser gone the session goes back to the default, and an unknown name is an error that sends nothing', async () => {
    const { http, base } = await start({ connectionLabels: LABELS, defaultConnection: 'home' });
    const work = await connectExtension(http, WORK);
    const home = await connectExtension(http, HOME);
    await open(http, 2);
    const call = await mcpSession(base);
    await call('browser_reload', { connection: WORK }); // by id also works
    work.socket.close();
    await expect.poll(() => http.context.listConnections().filter((c) => c.open).length).toBe(1);
    await call('browser_reload');
    expect(home.messages).toHaveLength(1);

    const bad = await call('browser_reload', { connection: 'ipad' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('browser_list_connections');
    expect(home.messages).toHaveLength(1);
  });

  it('nothing configured: the legacy rule is untouched (several browsers, no choice => the most recently used)', async () => {
    const { http, base } = await start({ connectionLabels: {}, defaultConnection: '' });
    const first = await connectExtension(http, 'conn-first');
    const second = await connectExtension(http, 'conn-second');
    await open(http, 2);
    const call = await mcpSession(base);

    expect((await call('browser_reload')).isError).toBeUndefined();
    expect([first.messages.length, second.messages.length]).toEqual([0, 1]);
    await call('browser_reload', { connection: 'conn-first' });
    await call('browser_reload'); // last used is now the first one
    expect([first.messages.length, second.messages.length]).toEqual([2, 1]);
  });

  it('a default is configured but not connected and several others are: it asks instead of guessing', async () => {
    const { http, base } = await start({ connectionLabels: { ...LABELS, 'conn-c': 'ipad' }, defaultConnection: 'home' });
    const work = await connectExtension(http, WORK);
    const ipad = await connectExtension(http, 'conn-c');
    await open(http, 2);
    const call = await mcpSession(base);

    const r = await call('browser_reload');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(`work (${WORK})`);
    expect(r.content[0].text).toContain('ipad (conn-c)');
    expect(work.messages.length + ipad.messages.length).toBe(0);
  });

  it('a single browser is used even with no default and no name', async () => {
    const { http, base } = await start({ connectionLabels: LABELS, defaultConnection: '' });
    const home = await connectExtension(http, HOME);
    await open(http, 1);
    const call = await mcpSession(base);
    expect((await call('browser_reload')).isError).toBeUndefined();
    expect(home.messages).toHaveLength(1);
  });

  it('browser_list_connections shows names, this session\'s pick and the configured default, and waits for no browser', async () => {
    const { http, base } = await start({ connectionLabels: LABELS, defaultConnection: 'home' });
    const call = await mcpSession(base);
    expect(JSON.parse((await call('browser_list_connections')).content[0].text)).toEqual([]);

    await connectExtension(http, WORK);
    await connectExtension(http, HOME);
    await open(http, 2);
    await call('browser_reload', { connection: 'work' });
    const rows = JSON.parse((await call('browser_list_connections')).content[0].text);
    expect(rows[0]).toHaveProperty('connectionId'); // the legacy fields are still there
    expect(rows.map((r: any) => [r.name, r.thisSession, r.configuredDefault]).sort()).toEqual([
      ['home', false, true],
      ['work', true, false],
    ]);
  });

  it('the deployment variables are read when no option is given', async () => {
    const prev = [process.env.AGENT_BROWSER_CONNECTION_LABELS, process.env.AGENT_BROWSER_DEFAULT_CONNECTION];
    process.env.AGENT_BROWSER_CONNECTION_LABELS = JSON.stringify(LABELS);
    process.env.AGENT_BROWSER_DEFAULT_CONNECTION = 'home';
    try {
      const { http, base } = await start({});
      const work = await connectExtension(http, WORK);
      const home = await connectExtension(http, HOME);
      await open(http, 2);
      await (await mcpSession(base))('browser_reload');
      expect([home.messages.length, work.messages.length]).toEqual([1, 0]);
    } finally {
      for (const [i, k] of ['AGENT_BROWSER_CONNECTION_LABELS', 'AGENT_BROWSER_DEFAULT_CONNECTION'].entries()) {
        if (prev[i] === undefined) delete process.env[k];
        else process.env[k] = prev[i];
      }
    }
  });

  it('the label a browser announces in its handshake is a name too', async () => {
    const { http, base } = await start({ connectionLabels: {}, defaultConnection: '' });
    const x = await connectExtension(http, 'conn-x', 'work-laptop');
    await connectExtension(http, 'conn-y', 'home');
    await open(http, 2);
    await (await mcpSession(base))('browser_reload', { connection: 'WORK-laptop' });
    expect(x.messages).toHaveLength(1);
  });
});

describe('the negotiated endpoint is not touched by those names (SessionBinding of M1B)', () => {
  const prevToken = process.env.BROWSER_WS_TOKEN;
  const clients: TestClient[] = [];
  afterAll(() => {
    for (const c of clients.splice(0)) c.close();
    if (prevToken === undefined) delete process.env.BROWSER_WS_TOKEN;
    else process.env.BROWSER_WS_TOKEN = prevToken;
  });
  beforeAll(() => {
    process.env.BROWSER_WS_TOKEN = TOKEN;
  });

  it('two ready browsers and a configured default: the session still gets browser_selection_required, nothing is sent', async () => {
    const { http } = await start({ connectionLabels: LABELS, defaultConnection: 'home', harness: { port: 0, house: 'house-a' } });
    await http.harness!.listening;
    const port = http.harness!.port();
    for (const platform of ['home', 'work']) {
      const { client } = await ready(port, { installationId: `inst-${platform}`, platform });
      clients.push(client);
    }
    await expect(http.harness!.broker.call('s1', 'browser_state', {})).rejects.toMatchObject({ code: 'browser_selection_required' });
    expect(clients.flatMap((c) => c.frames)).toEqual([]);
    expect(http.harness!.broker.binding('s1')).toBeNull();
  });
});
