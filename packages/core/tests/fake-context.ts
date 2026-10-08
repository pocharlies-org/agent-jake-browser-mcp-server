/** A Context whose send() records what a tool sends to the extension and answers `result` (or a failure). */
import type { Context, ExtensionResponse } from '../src/types.js';

export function fakeContext(result: unknown = {}, failure?: { message: string }) {
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const context = {
    async send(type: string, payload: Record<string, unknown> = {}): Promise<ExtensionResponse> {
      sent.push({ type, payload });
      return failure
        ? ({ id: 'x', success: false, error: { code: 'ERR', message: failure.message } } as ExtensionResponse)
        : ({ id: 'x', success: true, result } as ExtensionResponse);
    },
    isConnected: () => true,
    listConnections: () => [],
  } as unknown as Context;
  return { context, sent };
}

export const resultText = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;
export const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;
