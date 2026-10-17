/**
 * Plugins (INFRA-909): herramientas que este servidor anuncia y responde, pero que no tocan el
 * navegador. El copiloto del navegador las usa sin conocerlas — una capacidad nueva es un fichero
 * aquí, no un cambio en la extensión.
 *
 * `delegar` y `delegar_estado` hablan con el MCP de paseo (streamable HTTP), que es quien lanza los
 * agentes de Claude CLI. Se leen del entorno en cada llamada para que una prueba pueda montar el
 * servidor con variables propias; sin URL o sin token, los plugins no se anuncian: es mejor no
 * tener la herramienta que anunciar una que siempre falla.
 */
import { DELEGAR_ARGS, DELEGAR_ESTADO_ARGS } from '@agent-jake-browser/protocol';
import { createTool, textResult } from './types.js';
import type { Tool, ToolResult } from '../types.js';

const PROTOCOL_VERSION = '2025-03-26';
let seq = 0;

function paseoConfig(): { url: string; token: string; provider: string } | null {
  const url = process.env.PASEO_MCP_URL ?? '';
  const token = process.env.PASEO_MCP_TOKEN ?? '';
  if (!url || !token) return null;
  return { url, token, provider: process.env.PASEO_DEFAULT_PROVIDER || 'claude/qwen38-flash-next' };
}

/** Un POST JSON-RPC al MCP de paseo; acepta la respuesta en JSON o en SSE. */
async function rpc(config: { url: string; token: string }, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, ...(params === undefined ? {} : { params }) }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`paseo ${response.status}: ${body.slice(0, 200)}`);
  const payload = body.includes('data:') ? body.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim() : body;
  const parsed = (payload ? JSON.parse(payload) : {}) as { result?: Record<string, unknown>; error?: { message: string } };
  if (parsed.error) throw new Error(`paseo: ${parsed.error.message}`);
  return parsed.result ?? {};
}

/** Llama a una herramienta de paseo y devuelve su texto. */
async function callPaseo(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const config = paseoConfig();
  if (!config) return textResult('El plugin de paseo no está configurado (PASEO_MCP_URL, PASEO_MCP_TOKEN).', true);
  try {
    const result = await rpc(config, 'tools/call', { name, arguments: args });
    const parts = (result.content as { text?: string }[] | undefined) ?? [];
    const text = parts.map((part) => part.text ?? '').join('\n').trim();
    return result.isError ? textResult(text || `paseo falló: ${name}`, true) : textResult(text);
  } catch (error) {
    return textResult(`No pude hablar con paseo: ${(error as Error).message}`, true);
  }
}

export function getPluginTools(): Tool[] {
  if (!paseoConfig()) return [];
  return [
    createTool({
      name: 'delegar',
      description:
        'Delegar un trabajo a un agente que corre fuera del navegador (Claude CLI en paseo) y devolver en cuanto está lanzado, sin esperar a que termine. ' +
        'Úsalo cuando lo que hace falta no es algo del navegador: escribir código, montar un informe, una tarea larga. ' +
        'El texto de `orden` tiene que traer todo el contexto: el agente no ve esta página ni esta conversación. ' +
        'Con el id que devuelve, `delegar_estado` dice cómo va.',
      schema: DELEGAR_ARGS,
      serverSide: true,
      external: true,
      handle: async (_context, params) => {
        const config = paseoConfig()!;
        const title = (params.titulo ?? params.orden).slice(0, 60);
        return callPaseo('create_agent', {
          title,
          provider: params.proveedor ?? config.provider,
          initialPrompt: params.orden,
          background: true,
        });
      },
    }),
    createTool({
      name: 'delegar_estado',
      description: 'Cómo va un trabajo delegado: estado del agente que devolvió `delegar`.',
      schema: DELEGAR_ESTADO_ARGS,
      serverSide: true,
      external: true,
      handle: async (_context, params) => callPaseo('get_agent_status', { agentId: params.agente }),
    }),
  ];
}
