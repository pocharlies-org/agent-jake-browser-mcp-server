/**
 * browser_fill_secret: the secret is read on the server, typed through browser_type with the `secret` flag, and never
 * shows up in the result, in an error, in a log line or in the transcript of the negotiated endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callToolViaHarness } from '../src/harness-routing.js';
import { getAllTools } from '../src/tools/index.js';
import { fakeContext, isError, resultText } from './fake-context.js';
import { useHarness } from './harness-fixture.js';

const SECRET = 'hunter2-Sup3r$ecret';
const tool = getAllTools().find((x) => x.schema.name === 'browser_fill_secret')!;

async function fakeOp(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'op-'));
  const bin = join(dir, 'op');
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  process.env.AGENT_BROWSER_OP_BIN = bin;
}

afterEach(() => {
  delete process.env.AGENT_BROWSER_OP_BIN;
  vi.restoreAllMocks();
});

describe('browser_fill_secret', () => {
  it('types the secret flagged as secret and keeps it out of the result', async () => {
    await fakeOp(`[ "$1" = read ] && [ "$2" = "op://Private/item/password" ] && printf '%s\\n' '${SECRET}'`);
    const { context, sent } = fakeContext();
    const r = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(sent).toEqual([{ type: 'browser_type', payload: { ref: 'e5', selector: undefined, text: SECRET, clear: true, secret: true } }]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(resultText(r)).toContain(`${SECRET.length} chars`);
  });

  it('reads references with spaces in the vault name and the TOTP attribute', async () => {
    await fakeOp(`[ "$2" = "op://familia leila dani/Google/TOTP_abc?attribute=otp" ] && printf '123456\\n'`);
    const { context, sent } = fakeContext();
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

  it('says why op failed: exit code and stderr, never stdout', async () => {
    await fakeOp(`printf '%s' '${SECRET}'; echo 'item not found' >&2; exit 3`);
    const { context } = fakeContext();
    const r = await tool.handle(context, { ref: 'e5', secretRef: 'op://Private/item/password' });
    expect(resultText(r)).toContain('item not found');
    expect(JSON.stringify(r)).not.toContain(SECRET);
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
    expect(resultText(r)).toContain('the field holds 0 characters');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('scrubs the secret from whatever the extension answers back', async () => {
    await fakeOp(`printf '%s\\n' '${SECRET}'`);
    for (const ctx of [
      fakeContext({ warning: `field says ${SECRET}` }),
      fakeContext({}, { message: `could not type ${SECRET}` }),
    ]) {
      const r = await tool.handle(ctx.context, { selector: '#a', secretRef: 'op://Private/item/password' });
      expect(isError(r)).toBe(true);
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
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
    client.send({ type: 'tool_result', id: req.id, sessionId: req.sessionId, connectionId: ack.connectionId, house: ack.house, ok: true, data: { typed: SECRET, cleared: true } });
    const r = await call;

    expect(isError(r)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain(SECRET);
    fixture.harness().broker.closeSession('s-secret');
  });
});
