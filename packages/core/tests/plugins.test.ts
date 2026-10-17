/**
 * Plugins (INFRA-909): lo que el servidor anuncia sin tocar el navegador, y lo que el copiloto
 * consume por `tools/list` sin conocer el servicio de detrás.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMcpTools } from '../src/tools/index.js';
import { getPluginTools } from '../src/tools/plugins.js';

const ENV = { PASEO_MCP_URL: 'http://paseo.test:6767/mcp/agents', PASEO_MCP_TOKEN: 'tok', PASEO_DEFAULT_PROVIDER: 'claude/test', PROVIDER: 'claude/test' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('plugins del servidor', () => {
  it('sin configurar paseo, no se anuncia nada: mejor no tener la herramienta que anunciar una que falla', () => {
    vi.stubEnv('PASEO_MCP_URL', '');
    vi.stubEnv('PASEO_MCP_TOKEN', '');
    expect(getPluginTools()).toEqual([]);
    expect(getMcpTools().map((t) => t.schema.name)).not.toContain('delegar');
  });

  it('con paseo configurado, entran por tools/list y no llevan el argumento connection', () => {
    vi.stubEnv('PASEO_MCP_URL', ENV.PASEO_MCP_URL);
    vi.stubEnv('PASEO_MCP_TOKEN', ENV.PASEO_MCP_TOKEN);
    const names = getMcpTools().map((t) => t.schema.name);
    expect(names).toContain('delegar');
    expect(names).toContain('delegar_estado');
    const delegar = getMcpTools().find((t) => t.schema.name === 'delegar')!;
    expect(delegar.external).toBe(true);
    expect(delegar.serverSide).toBe(true);
    expect(delegar.schema.inputSchema.properties).not.toHaveProperty('connection');
  });

  it('delegar lanza un agente en paseo con el contexto completo y no espera a que termine', async () => {
    vi.stubEnv('PASEO_MCP_URL', ENV.PASEO_MCP_URL);
    vi.stubEnv('PASEO_MCP_TOKEN', ENV.PASEO_MCP_TOKEN);
    vi.stubEnv('PASEO_DEFAULT_PROVIDER', ENV.PROVIDER);
    const calls: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ body, headers: init.headers });
      return {
        ok: true, status: 200, headers: new Headers(),
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{"agentId":"ag-1"}' }] } }),
      };
    }));

    const delegar = getPluginTools().find((t) => t.schema.name === 'delegar')!;
    const result = await delegar.handle({} as never, { orden: 'Monta el informe de octubre con esta tabla' });

    expect(result).toMatchObject({ content: [{ type: 'text', text: '{"agentId":"ag-1"}' }] });
    expect(calls[0].body).toMatchObject({
      method: 'tools/call',
      params: { name: 'create_agent', arguments: {
        title: 'Monta el informe de octubre con esta tabla',
        provider: 'claude/test',
        initialPrompt: 'Monta el informe de octubre con esta tabla',
        background: true,
      } },
    });
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
  });

  it('un paseo caído llega al modelo como error, no como un turno roto', async () => {
    vi.stubEnv('PASEO_MCP_URL', ENV.PASEO_MCP_URL);
    vi.stubEnv('PASEO_MCP_TOKEN', ENV.PASEO_MCP_TOKEN);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const estado = getPluginTools().find((t) => t.schema.name === 'delegar_estado')!;
    const result = await estado.handle({} as never, { agente: 'ag-1' });

    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('ECONNREFUSED') }] });
  });
});
