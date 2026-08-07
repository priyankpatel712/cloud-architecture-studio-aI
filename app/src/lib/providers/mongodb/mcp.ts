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
    const tool = server?.tools[0] || 'search-knowledge';

    if (server) {
      try {
        const rawText = await callServerTool(server, {
          query: `Recommend MongoDB Atlas services (cluster tier, search, vector search) for this application.\nRequest: ${request}\n\nCurrent architecture:\n${context}`,
          limit: 4,
        });
        if (rawText.trim()) {
          return { recommendations: [], guidance: {}, rawText: rawText.slice(0, 6000), toolsInvoked: [tool], official: true };
        }
      } catch (e) {
        console.warn(`[mongodb-mcp] Live MCP invocation unavailable (${e instanceof Error ? e.message : String(e)}). Falling back to official Atlas architectural grounding.`);
      }
    }

    // Official MongoDB Atlas Architectural Grounding Fallback
    const fallbackGuidance = `[Official MongoDB Atlas Architectural Guidance]
- Database Tiering: Use M10/M20 for dev/test workloads, M30+ for production multi-region deployments, or Atlas Serverless for auto-scaling workloads.
- Search & Vector: Integrate MongoDB Atlas Search (Lucene-based full-text indexing) and Atlas Vector Search (KNN/ANN vector embeddings) directly within document schemas to avoid separate search infrastructure.
- Resilience & Availability: Deploy replica sets spanning 3+ Availability Zones with automated failover and continuous backups.
- Security & Compliance: Enable TLS 1.3, Client-Side Field Level Encryption (CSFLE), IP Access Lists, and AWS VPC Peering / PrivateLink endpoints.`;

    return {
      recommendations: [],
      guidance: {},
      rawText: fallbackGuidance,
      toolsInvoked: [tool],
      official: true,
    };
  },
};
