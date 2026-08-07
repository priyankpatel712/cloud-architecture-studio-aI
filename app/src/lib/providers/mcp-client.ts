import 'server-only';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpServersFor, type McpPurpose, type McpServerConfig } from '@/lib/providers/mcp-registry';
import type { ProviderId } from '@/lib/providers/types';

/**
 * Thin client for the official provider MCP servers (Constitution I, research R1/R2).
 * Supports both stdio subprocesses and direct StreamableHTTP HTTP/HTTPS endpoints.
 */

const clients = new Map<string, Promise<Client>>();

function extractHttpUrl(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const match = command.match(/(https?:\/\/[^\s"]+)/i);
  return match ? match[1] : null;
}

function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const [cmd, ...args] = parts.map((p) => p.replaceAll('"', ''));
  return { cmd, args };
}

async function connect(command: string): Promise<Client> {
  const httpUrl = extractHttpUrl(command);
  if (httpUrl) {
    // Direct HTTP/HTTPS connection using StreamableHTTPClientTransport (e.g. AWS Knowledge MCP)
    const transport = new StreamableHTTPClientTransport(new URL(httpUrl));
    const client = new Client({ name: 'cloud-architecture-studio', version: '0.1.0' });
    await client.connect(transport);
    return client;
  }

  const { cmd, args } = parseCommand(command);
  const env = { ...getDefaultEnvironment() };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

  // Serverless safety: ensure npx/uvx write to writable /tmp directory in AWS Lambda / Vercel
  if (!env.HOME || env.HOME === '/') env.HOME = '/tmp';
  if (!env.XDG_CACHE_HOME) env.XDG_CACHE_HOME = '/tmp/.cache';
  if (!env.npm_config_cache) env.npm_config_cache = '/tmp/.npm-cache';

  const transport = new StdioClientTransport({ command: cmd, args, env });
  const client = new Client({ name: 'cloud-architecture-studio', version: '0.1.0' });

  // Bound stdio connection with 12s timeout to prevent serverless function hangs
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`MCP stdio connection timed out after 12s: ${command}`)), 12_000)
  );

  await Promise.race([connectPromise, timeoutPromise]);
  return client;
}

export async function getMcpClient(command: string): Promise<Client> {
  let existing = clients.get(command);
  if (!existing) {
    existing = connect(command).catch((e) => {
      clients.delete(command); // allow retry after a failed launch
      throw e;
    });
    clients.set(command, existing);
  }
  return existing;
}

/** Call a tool on an env-configured MCP server; returns the text content joined. */
export async function callMcpTool(
  command: string,
  tool: string,
  args: Record<string, unknown>
): Promise<string> {
  const client = await getMcpClient(command);
  const result = await client.callTool({ name: tool, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .filter((c): c is { type: 'text'; text: string } => c?.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/** List the tools an env-configured MCP server exposes. */
export async function listMcpTools(command: string): Promise<string[]> {
  const client = await getMcpClient(command);
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

/**
 * Shut down every pooled client and its subprocess.
 *
 * The long-running server never calls this — the pool is the point, and the
 * process owns its children for its lifetime. It exists for SHORT-LIVED
 * callers (CLI scripts): without it the script exits while the servers are
 * still running, and the first thing a child writes to its now-closed stdout
 * kills it with an EPIPE stack trace that looks like a failure of the script.
 */
export async function closeMcpClients(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  await Promise.allSettled(
    open.map(async (pending) => {
      const client = await pending;
      await client.close();
    })
  );
}

/**
 * Configured servers for a (provider, purpose), in resolution order (FR-028).
 *
 * Read through the registry on every call rather than cached: the registry is
 * the seam a database-backed source will replace, and a module-level snapshot
 * would pin the process to whatever configuration existed at import time.
 */
export function mcpServersForPurpose(provider: ProviderId, purpose: McpPurpose): McpServerConfig[] {
  return mcpServersFor(provider, purpose);
}

/** The preferred server for a purpose, or null when none is configured. */
export function resolveMcpServer(provider: ProviderId, purpose: McpPurpose): McpServerConfig | null {
  return mcpServersFor(provider, purpose)[0] ?? null;
}

/**
 * Call a tool on a registry-resolved server.
 *
 * `tool` is optional because the registry already records which tool a server is
 * expected to expose; passing one explicitly is for the servers that expose
 * several (regional availability alongside documentation search, say).
 */
export async function callServerTool(
  server: McpServerConfig,
  args: Record<string, unknown>,
  tool = server.tools[0]
): Promise<string> {
  return callMcpTool(server.command, tool, args);
}
