import { afterEach, describe, expect, it } from 'vitest';
import { mcpServers, mcpServersFor, hasMcpFor } from '@/lib/providers/mcp-registry';

/**
 * Feature 008 US4 — data-driven MCP server registry (FR-028).
 *
 * Before this, each MCP server was an env var read at its own call site, so
 * adding one meant editing code. The registry makes the set declarative, which
 * is what FR-028 ("extensible by configuration, without editing core generation
 * logic") actually requires.
 */

const VARS = [
  'AWS_MCP_COMMAND', 'AWS_MCP_TOOL', 'AWS_DOCS_MCP_COMMAND', 'AWS_COST_MCP_COMMAND', 'AWS_COST_MCP_TOOL',
  'MONGODB_MCP_COMMAND', 'MONGODB_MCP_TOOL', 'DIAGRAM_MCP_COMMAND', 'DIAGRAM_MCP_CROSSCHECK_ENABLED',
] as const;
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

function clear() {
  for (const v of VARS) delete process.env[v];
}

describe('registry composition', () => {
  it('omits servers with no command — absent and unusable are the same thing', () => {
    clear();
    expect(mcpServers()).toEqual([]);
    expect(hasMcpFor('aws', 'knowledge')).toBe(false);
  });

  it('includes a server once its command is configured', () => {
    clear();
    process.env.AWS_MCP_COMMAND = 'npx -y mcp-remote@latest https://knowledge-mcp.global.api.aws';
    const servers = mcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: 'aws-knowledge', provider: 'aws', purpose: 'knowledge' });
    expect(hasMcpFor('aws', 'knowledge')).toBe(true);
  });

  it('orders the official first-party server ahead of the documentation fallback', () => {
    clear();
    process.env.AWS_DOCS_MCP_COMMAND = 'uvx awslabs.aws-documentation-mcp-server@latest';
    process.env.AWS_MCP_COMMAND = 'npx -y mcp-remote@latest https://knowledge-mcp.global.api.aws';
    const knowledge = mcpServersFor('aws', 'knowledge');
    expect(knowledge.map((s) => s.id)).toEqual(['aws-knowledge', 'aws-documentation']);
  });

  it('separates purposes so pricing is not consulted for knowledge', () => {
    clear();
    process.env.AWS_MCP_COMMAND = 'cmd-knowledge';
    process.env.AWS_COST_MCP_COMMAND = 'cmd-pricing';
    expect(mcpServersFor('aws', 'knowledge').map((s) => s.id)).toEqual(['aws-knowledge']);
    expect(mcpServersFor('aws', 'pricing').map((s) => s.id)).toEqual(['aws-pricing']);
  });

  it('honours a configured tool name, falling back to the documented default', () => {
    clear();
    process.env.MONGODB_MCP_COMMAND = 'npx -y mongodb-mcp-server@latest';
    expect(mcpServersFor('mongodb', 'knowledge')[0].tools).toEqual(['search-knowledge']);
    process.env.MONGODB_MCP_TOOL = 'custom-tool';
    expect(mcpServersFor('mongodb', 'knowledge')[0].tools).toEqual(['custom-tool']);
  });
});

describe('declared tools drive selection (FR-028)', () => {
  it('advertises regional availability alongside the Knowledge MCP search tool', () => {
    // aws/mcp.ts picks the availability server by this declared tool rather than
    // by id, so the claim here is what routes the call.
    clear();
    process.env.AWS_MCP_COMMAND = 'npx -y mcp-remote@latest https://knowledge-mcp.global.api.aws';
    const [server] = mcpServersFor('aws', 'knowledge');
    expect(server.tools).toEqual(['aws___search_documentation', 'aws___get_regional_availability']);
  });

  it('withdraws that claim when a custom tool points at a different server', () => {
    // AWS_MCP_TOOL means something other than the Knowledge MCP — most likely
    // aws-api-mcp-server, which has no availability tool. Advertising it anyway
    // would turn a "not supported here" into a failed subprocess call per turn.
    clear();
    process.env.AWS_MCP_COMMAND = 'uvx awslabs.aws-api-mcp-server@latest';
    process.env.AWS_MCP_TOOL = 'suggest_aws_commands';
    expect(mcpServersFor('aws', 'knowledge')[0].tools).toEqual(['suggest_aws_commands']);
  });

  it('never advertises availability on the documentation fallback', () => {
    clear();
    process.env.AWS_DOCS_MCP_COMMAND = 'uvx awslabs.aws-documentation-mcp-server@latest';
    const [docs] = mcpServersFor('aws', 'knowledge');
    expect(docs.tools).not.toContain('aws___get_regional_availability');
  });

  it('lets the pricing tool be overridden without touching the adapter', () => {
    clear();
    process.env.AWS_COST_MCP_COMMAND = 'uvx awslabs.aws-pricing-mcp-server@latest';
    expect(mcpServersFor('aws', 'pricing')[0].tools).toEqual(['get_pricing']);
    process.env.AWS_COST_MCP_TOOL = 'get_pricing_v2';
    expect(mcpServersFor('aws', 'pricing')[0].tools).toEqual(['get_pricing_v2']);
  });
});

describe('advisory diagram cross-check (FR-040)', () => {
  it('stays off even when its command is configured, unless explicitly enabled', () => {
    clear();
    process.env.DIAGRAM_MCP_COMMAND = 'uvx awslabs.aws-diagram-mcp-server@latest';
    expect(mcpServersFor('system', 'validation')).toEqual([]);
  });

  it('appears only when both the command and the flag are set', () => {
    clear();
    process.env.DIAGRAM_MCP_COMMAND = 'uvx awslabs.aws-diagram-mcp-server@latest';
    process.env.DIAGRAM_MCP_CROSSCHECK_ENABLED = 'true';
    const validation = mcpServersFor('system', 'validation');
    expect(validation).toHaveLength(1);
    expect(validation[0].purpose).toBe('validation');
  });

  it('is ordered last so it never precedes a real knowledge source', () => {
    clear();
    process.env.AWS_MCP_COMMAND = 'cmd-knowledge';
    process.env.DIAGRAM_MCP_COMMAND = 'cmd-diagram';
    process.env.DIAGRAM_MCP_CROSSCHECK_ENABLED = 'true';
    expect(mcpServers().at(-1)?.id).toBe('diagram-crosscheck');
  });
});
