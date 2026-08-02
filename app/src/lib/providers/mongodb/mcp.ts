import 'server-only';
import { McpUnavailableError, type McpAdapter } from '@/lib/providers/types';
import { callServerTool, resolveMcpServer } from '@/lib/providers/mcp-client';

/**
 * MongoDB MCP adapter (FR-014c, research R2).
 * Grounds Atlas recommendations in the official MongoDB MCP server, resolved
 * through the MCP registry (008 FR-028) rather than read from env here. See
 * aws/mcp.ts for the failure contract — unavailability is reported per provider,
 * never a silent guess.
 */
export const mongodbMcp: McpAdapter = {
  async recommend(request, context) {
    const server = resolveMcpServer('mongodb', 'knowledge');
    if (!server) {
      throw new McpUnavailableError('mongodb', 'Official MongoDB MCP is not configured (MONGODB_MCP_COMMAND).');
    }
    // The registry's default tool is 'search-knowledge', the official server's
    // free-text MongoDB knowledge search ({ query }) — the grounding source for
    // Atlas recommendations.
    const tool = server.tools[0];
    try {
      const rawText = await callServerTool(server, {
        query: `Recommend MongoDB Atlas services (cluster tier, search, vector search) for this application.\nRequest: ${request}\n\nCurrent architecture:\n${context}`,
        // Bound the payload — results are inserted into the plan prompt verbatim
        // (the orchestrator additionally caps each provider's guidance).
        limit: 4,
      });
      return { recommendations: [], guidance: {}, rawText: rawText.slice(0, 6000), toolsInvoked: [tool], official: true };
    } catch (e) {
      throw new McpUnavailableError('mongodb', e instanceof Error ? e.message : 'MongoDB MCP call failed');
    }
  },
};
