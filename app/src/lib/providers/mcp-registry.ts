import 'server-only';
import type { ProviderId } from '@/lib/providers/types';

/**
 * MCP server registry (feature 008 US4, FR-028;
 * research R10).
 *
 * Before this, each MCP server was an env var read at its own call site, so
 * adding a server meant editing code. Here the set is declarative and seeded
 * from environment, mirroring the provider plugin registry: core code iterates
 * the registry and never hard-codes which servers exist.
 *
 * A database-backed source can replace the env seed later without touching call
 * sites — the shape is chosen so that swap is a one-file change. Env is used for
 * now deliberately: the app must be able to reach its MCPs before any admin UI
 * exists to configure them.
 *
 * Note this is NOT the repo-root `.mcp.json`, which configures the coding
 * agent's own MCP servers. Conflating the two would couple developer tooling to
 * runtime behavior.
 */

export type McpPurpose = 'knowledge' | 'pricing' | 'validation';

export interface McpServerConfig {
  id: string;
  /** Full shell command, e.g. `npx -y mcp-remote@latest https://…`. */
  command: string;
  /** Tool names this server is expected to expose. */
  tools: string[];
  provider: ProviderId;
  purpose: McpPurpose;
  enabled: boolean;
  /**
   * Lower runs first within a purpose. Official first-party servers lead;
   * broader documentation servers act as fallbacks.
   */
  order: number;
}

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

/**
 * The configured servers, in resolution order. A server with no command is
 * omitted entirely rather than returned disabled, so callers never have to
 * distinguish "absent" from "present but unusable".
 */
export function mcpServers(): McpServerConfig[] {
  const all: McpServerConfig[] = [
    {
      id: 'aws-knowledge',
      command: env('AWS_MCP_COMMAND'),
      tools: [
        env('AWS_MCP_TOOL') || 'aws___search_documentation',
        // The AWS Knowledge MCP also answers validated per-region product
        // availability. Advertised only alongside its own search tool: a custom
        // AWS_MCP_TOOL means a different server (aws-api-mcp-server, say), which
        // does not expose this — and callers select by declared tool, so a wrong
        // claim here becomes a failed subprocess call at generation time.
        ...(env('AWS_MCP_TOOL') ? [] : ['aws___get_regional_availability']),
      ],
      provider: 'aws',
      purpose: 'knowledge',
      enabled: true,
      order: 10,
    },
    {
      // 008 — official AWS Labs documentation server, a fallback knowledge rung
      // after the AWS Knowledge MCP (constitution Principle I: official first).
      id: 'aws-documentation',
      command: env('AWS_DOCS_MCP_COMMAND'),
      tools: [
        env('AWS_DOCS_MCP_TOOL') || (env('AWS_DOCS_MCP_COMMAND').includes('knowledge-mcp') ? 'aws___search_documentation' : 'read_documentation'),
      ],
      provider: 'aws',
      purpose: 'knowledge',
      enabled: true,
      order: 20,
    },
    {
      id: 'aws-pricing',
      command: env('AWS_COST_MCP_COMMAND'),
      tools: [env('AWS_COST_MCP_TOOL') || 'get_pricing'],
      provider: 'aws',
      purpose: 'pricing',
      enabled: true,
      order: 10,
    },
    {
      id: 'mongodb-knowledge',
      command: env('MONGODB_MCP_COMMAND'),
      tools: [env('MONGODB_MCP_TOOL') || 'search-knowledge'],
      provider: 'mongodb',
      purpose: 'knowledge',
      enabled: true,
      order: 10,
    },
    {
      // 008 FR-040 — advisory only. Its opinion of the topology informs
      // self-review and is NEVER authoritative, never shown to the user as
      // truth. Off unless explicitly enabled.
      id: 'diagram-crosscheck',
      command: env('DIAGRAM_MCP_COMMAND'),
      tools: ['generate_diagram'],
      provider: 'system',
      purpose: 'validation',
      enabled: process.env.DIAGRAM_MCP_CROSSCHECK_ENABLED === 'true',
      order: 90,
    },
  ];

  return all
    .filter((s) => s.enabled && s.command.length > 0)
    .sort((a, b) => a.order - b.order);
}

/** Servers for one provider and purpose, in resolution order. */
export function mcpServersFor(provider: ProviderId, purpose: McpPurpose): McpServerConfig[] {
  return mcpServers().filter((s) => s.provider === provider && s.purpose === purpose);
}

/** Is any server of this purpose configured for this provider? */
export function hasMcpFor(provider: ProviderId, purpose: McpPurpose): boolean {
  return mcpServersFor(provider, purpose).length > 0;
}
