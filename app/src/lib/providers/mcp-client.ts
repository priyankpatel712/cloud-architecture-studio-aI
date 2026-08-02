import 'server-only';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpServersFor, type McpPurpose, type McpServerConfig } from '@/lib/providers/mcp-registry';
import type { ProviderId } from '@/lib/providers/types';

/**
 * Thin client for the official provider MCP servers (Constitution I, research R1/R2).
 * Servers are launched as stdio subprocesses; which servers exist, what they are
 * called and which tools they expose is owned by mcp-registry.ts.
 *
 * WHICH SERVER TO USE IS A REGISTRY QUESTION (008 FR-028). Adapters ask for a
 * (provider, purpose) pair and get back configured servers in resolution order —
 * they no longer read `process.env.AWS_MCP_COMMAND` and friends themselves.
 * That indirection is the whole point: adding or reordering a server is a
 * registry edit, and no adapter has to learn the new variable's name.
 *
 * The connection pool below is still keyed by COMMAND, not by registry id, so
 * two registry entries pointing at the same command share one subprocess and a
 * registry change cannot orphan a live client.
 *
 * No configured server for a purpose means the official tool is unavailable here —
 * callers surface the labelled indicative degraded mode (spec Assumptions).
 */

const clients = new Map<string, Promise<Client>>();

function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const [cmd, ...args] = parts.map((p) => p.replaceAll('"', ''));
  return { cmd, args };
}

async function connect(command: string): Promise<Client> {
  const { cmd, args } = parseCommand(command);
  // The SDK inherits only a small env safelist by default — the official servers
  // need the app's server-side env (AWS_REGION, AWS credentials, MDB_* etc.).
  // These are our own trusted, env-configured commands (Constitution I), never
  // user-supplied, so passing the process env through is safe here.
  const env = { ...getDefaultEnvironment() };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const transport = new StdioClientTransport({ command: cmd, args, env });
  const client = new Client({ name: 'cloud-architecture-studio', version: '0.1.0' });
  await client.connect(transport);
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
