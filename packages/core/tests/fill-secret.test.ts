/**
 * browser_fill_secret: the secret is read on the server, typed through browser_type with the `secret` flag, and never
 * shows up in the result, in an error, in a log line or in the transcript of the negotiated endpoint. Success requires
 * the extension to acknowledge with typed=true and verified=true; every other answer is an error (fork behavior).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callToolViaHarness } from '../src/harness-routing.js';
import { fillSecretTool } from '../src/tools/interaction.js';
import { fakeContext, isError, resultText } from './fake-context.js';
import { useHarness } from './harness-fixture.js';
import type { Context, ExtensionResponse } from '../src/types.js';

const SECRET = 'hunter2-Sup3r$ecret';
const tool = fillSecretTool;
const OK = { typed: true, verified: true };

const originalGate = process.env.AGENT_BROWSER_FILL_SECRET_ENABLED;
beforeEach(() => { process.env.AGENT_BROWSER_FILL_SECRET_ENABLED = 'true'; });
afterEach(() => {
  if (originalGate === undefined) delete process.env.AGENT_BROWSER_FILL_SECRET_ENABLED;
  else process.env.AGENT_BROWSER_FILL_SECRET_ENABLED = originalGate;
  delete process.env.AGENT_BROWSER_OP_BIN;
  vi.restoreAllMocks();
});

async function fakeOp(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'op-'));
  const bin = join(dir, 'op');
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  process.env.AGENT_BROWSER_OP_BIN = bin;
}

describe('browser_fill_secret', () => {
  it('types the secret flagged as secret and keeps it out of the result', async () => {
    await fakeOp(`[ "$1" = read ] && [ "$2" = "op://Private/item/password" ] && printf '%s\\n' '${SECRET}'`);
    const { context, sent } = fakeContext(OK);
    const r = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(sent).toEqual([{ type: 'browser_type', payload: { ref: 'e5', selector: undefined, text: SECRET, clear: true, secret: true } }]);
    const out = JSON.stringify(r);
    expect(out).not.toContain(SECRET);
    expect(out).toContain('Filled and verified');
    expect(out).not.toContain('op://Private');
    expect(out).not.toContain(`${SECRET.length} chars`);
  });

  it('reads references with spaces in the vault name and the TOTP attribute', async () => {
    await fakeOp(`[ "$2" = "op://familia leila dani/Google/TOTP_abc?attribute=otp" ] && printf '123456\\n'`);
    const { context, sent } = fakeContext(OK);
    const r = await tool.handle(context, { selector: '#otp', secretRef: 'op://familia leila dani/Google/TOTP_abc?attribute=otp' });
    expect(isError(r)).toBe(false);
    expect(sent[0].payload.text).toBe('123456');
  });

  it('fails without typing when the secret cannot be read', async () => {
    await fakeOp('exit 1');
    const { context, sent } = fakeContext();
    const r = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(isError(r)).toBe(true);
    expect(sent).toEqual([]);
  });

  it('does not expose reader stderr when a configured wrapper fails', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}' >&2; exit 1`);
    const { context, sent } = fakeContext();
    const r = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(isError(r)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain('op://Private');
    expect(sent).toEqual([]);
  });

  it('an empty secret types nothing', async () => {
    await fakeOp(`printf '\\n'`);
    const { context, sent } = fakeContext();
    expect(isError(await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' }))).toBe(true);
    expect(sent).toEqual([]);
  });

  it('is an error when the extension reports the field did not end up with the secret', async () => {
    // Regression: a hidden tab got none of the keys and the tool still said "Filled (6 chars)".
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    const { context } = fakeContext({ typed: SECRET, cleared: true, fieldLength: 0, warning: `the field holds 0 characters after typing ${SECRET.length}` });
    const r = await tool.handle(context, { selector: '#otp', secretRef: 'op://Private/item/password' });
    expect(isError(r)).toBe(true);
    const out = JSON.stringify(r);
    expect(out).toContain('Did not fill the target field as expected');
    expect(out).not.toContain(SECRET);
  });

  it('does not expose a typed secret from extension error or warning text', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    const { context } = fakeContext({ warning: `Field value was ${SECRET}` });
    const warningResult = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(isError(warningResult)).toBe(true);
    expect(JSON.stringify(warningResult)).not.toContain(SECRET);

    const failingContext = {
      ...context,
      send: async () => ({ id: 'x', success: false, error: { message: `Typing ${SECRET} failed` } }),
    } as unknown as Context;
    const errorResult = await tool.handle(failingContext, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(isError(errorResult)).toBe(true);
    expect(JSON.stringify(errorResult)).not.toContain(SECRET);
  });

  it('handles a transport rejection without reflecting its message or typed value', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    const { context } = fakeContext();
    const rejectingContext = {
      ...context,
      send: async () => { throw new Error(`Could not send ${SECRET}`); },
    } as unknown as Context;
    const r = await tool.handle(rejectingContext, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(isError(r)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it.each([
    { success: true, result: {} },
    { success: true, result: { typed: true, verified: false } },
    { success: true, result: { typed: false, verified: true } },
    { success: true, result: { typed: 'true', verified: true } },
    { success: true, result: { typed: true, verified: 'true' } },
    { success: 'true', result: { typed: true, verified: true } },
    { success: 'false', result: { typed: true, verified: true } },
    { success: true, result: null },
    null,
  ])('rejects legacy or malformed acknowledgement %j', async response => {
    await fakeOp(`printf '%s' '${SECRET}'`);
    const { context } = fakeContext();
    context.send = async () => response as unknown as ExtensionResponse;
    const result = await tool.handle(context, { ref: 'e5', secretRef: 'op://v/i/f' });
    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each(['', 'op:/x', 'https://x', 'op://a\nb', 'op://a\u0000b', '-h'])('rejects the reference %j before reading anything', async (secretRef) => {
    await fakeOp(`touch "$0.ran"; printf '%s\\n' '${SECRET}'`);
    const { context, sent } = fakeContext();
    const r = await tool.handle(context, { ref: 'e5', secretRef });
    expect(isError(r)).toBe(true);
    expect(sent).toEqual([]);
    const { existsSync } = await import('node:fs');
    expect(existsSync(`${process.env.AGENT_BROWSER_OP_BIN}.ran`)).toBe(false);
  });

  it('needs a ref or a selector', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    const { context, sent } = fakeContext();
    expect(isError(await tool.handle(context, { secretRef: 'op://Private/item/password' }))).toBe(true);
    expect(sent).toEqual([]);
  });

  it('the MCP listing never asks for the secret itself, only a reference', () => {
    const props = Object.keys((tool.schema.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(props.sort()).toEqual(['clear', 'ref', 'secretRef', 'selector']);
  });
});

describe('browser_fill_secret on the negotiated endpoint', () => {
  const fixture = useHarness();

  it('the browser gets browser_type with the flag; the MCP result, the server log and stderr never hold the secret', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    const lines: string[] = [];
    for (const target of [process.stderr, process.stdout]) {
      vi.spyOn(target, 'write').mockImplementation(((chunk: unknown) => (lines.push(String(chunk)), true)) as never);
    }
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    }

    const { client, ack } = await fixture.browser({ installationId: 'inst-secret' });
    const call = callToolViaHarness(fixture.harness(), tool, 'browser_fill_secret', { selector: '#pw', secretRef: 'op://Private/item/password' }, { sessionId: 's-secret' });
    const req = await client.next();
    expect(req).toMatchObject({ type: 'tool_request', tool: 'browser_type', args: { selector: '#pw', text: SECRET, secret: true } });
    client.send({ type: 'tool_result', id: req.id, sessionId: req.sessionId, connectionId: ack.connectionId, house: ack.house, ok: true, data: { typed: true, verified: true } });
    const r = await call;

    expect(isError(r)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
    fixture.harness().broker.closeSession('s-secret');
  });
});
