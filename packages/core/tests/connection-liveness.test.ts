/**
 * SC-2858: a frozen extension keeps its socket OPEN while answering nothing, and
 * every tool call routed to it died on the 30 s timeout for hours. The registry
 * exposes the silent ones and the WS server's watchdog terminates them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { ConnectionRegistry } from '../src/connection-registry.js';
import { createWSServer, type WSServer } from '../src/ws-server.js';

const openSocket = () => ({ readyState: WebSocket.OPEN } as unknown as WebSocket);
const closedSocket = () => ({ readyState: WebSocket.CLOSED } as unknown as WebSocket);

describe('ConnectionRegistry.staleConnections', () => {
  it('reports only open connections silent past the deadline', () => {
    const registry = new ConnectionRegistry();
    registry.add({ connectionId: 'fresh', ws: openSocket(), now: 1_000 });
    registry.add({ connectionId: 'silent', ws: openSocket(), now: 1_000 });
    registry.add({ connectionId: 'dead-socket', ws: closedSocket(), now: 1_000 });
    registry.touch('fresh', 10_000);

    const stale = registry.staleConnections(5_000, 10_000);

    expect(stale.map((c) => c.connectionId)).toEqual(['silent']);
  });

  it('keeps a connection alive while its heartbeats land', () => {
    const registry = new ConnectionRegistry();
    registry.add({ connectionId: 'beating', ws: openSocket(), now: 0 });
    registry.touch('beating', 4_000);

    expect(registry.staleConnections(5_000, 8_000)).toEqual([]);
  });
});

describe('WS server liveness watchdog', () => {
  const servers: WSServer[] = [];
  const sockets: WebSocket[] = [];

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    for (const server of servers) await server.close();
  });

  it('terminates a connection that stops heartbeating', async () => {
    const server = createWSServer({
      port: 0,
      liveness: { deadlineMs: 300, checkIntervalMs: 50 },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.server.once('listening', resolve));
    const port = (server.server.address() as AddressInfo).port;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/?connectionId=zombie`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    expect(server.registry.openIds()).toContain('zombie');

    // Simulate the frozen service worker: its last heartbeat was long ago.
    server.registry.touch('zombie', Date.now() - 10_000);

    await new Promise<void>((resolve, reject) => {
      const guard = setTimeout(() => reject(new Error('watchdog did not evict')), 3_000);
      socket.once('close', () => {
        clearTimeout(guard);
        resolve();
      });
    });

    expect(server.registry.openIds()).not.toContain('zombie');
  }, 10_000);
});
