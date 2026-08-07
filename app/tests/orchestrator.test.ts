import { beforeAll, describe, expect, it } from 'vitest';
import { orchestrateChatTurn } from '@/lib/generate/orchestrator';

/**
 * Tool-attachment rules (FR-014a–d) in the offline degraded mode: no LLM key and
 * no MCP commands configured, so results must be honestly labelled indicative and
 * scoped to the attached providers only.
 */

beforeAll(() => {
  delete process.env.LLM_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.AWS_MCP_COMMAND;
  // Also the fallback documentation rung: .env.local configures it with the
  // hosted Knowledge MCP URL (vitest loads .env files), and a reachable server
  // here would turn these offline/indicative assertions into network flakes.
  delete process.env.AWS_DOCS_MCP_COMMAND;
  delete process.env.AWS_DOCS_MCP_TOOL;
  delete process.env.AWS_COST_MCP_COMMAND;
  delete process.env.MONGODB_MCP_COMMAND;
});

const emptyInput = {
  text: 'Design a serverless API for 10k users',
  nodes: [],
  edges: [],
  containers: [],
  annotations: [],
  guidance: {},
  defaultRegion: 'us-east-1',
};

describe('chat orchestrator tool attachment (FR-014a–d)', () => {
  it('asks to attach a tool instead of guessing when none is attached', async () => {
    const result = await orchestrateChatTurn({ ...emptyInput, activeTools: [] });
    expect(result.changed).toBe(false);
    expect(result.nodes).toHaveLength(0);
    expect(result.mcpCalls).toHaveLength(0);
    expect(result.reply.toLowerCase()).toContain('attach');
  });

  it('invokes only the attached provider and labels offline results indicative', async () => {
    const result = await orchestrateChatTurn({ ...emptyInput, activeTools: ['aws'] });
    expect(result.indicative).toBe(true);
    // MCP falls back to official architectural guidance when live server unconfigured
    expect(result.mcpCalls).toEqual([{ provider: 'aws', tool: 'aws___search_documentation', status: 'ok' }]);
    // Every produced node belongs to the attached provider only.
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.every((n) => n.provider === 'aws')).toBe(true);
    expect(result.nodes.every((n) => n.costBasis === 'indicative')).toBe(true);
  });

  it('covers both providers when both tools are attached', async () => {
    const result = await orchestrateChatTurn({ ...emptyInput, activeTools: ['aws', 'mongodb'] });
    const providers = new Set(result.nodes.map((n) => n.provider));
    expect(providers.has('aws')).toBe(true);
    expect(providers.has('mongodb')).toBe(true);
    expect(result.mcpCalls.map((c) => c.provider).sort()).toEqual(['aws', 'mongodb']);
  });

  it('preserves existing work when it cannot safely edit (no LLM configured)', async () => {
    const existing = {
      nodeId: 'keep1',
      serviceId: 'aws-lambda',
      provider: 'aws' as const,
      category: 'Compute',
      position: { x: 10, y: 20 },
      config: { memory: '512' },
      cost: 10,
      costBasis: 'indicative' as const,
    };
    const result = await orchestrateChatTurn({
      ...emptyInput,
      activeTools: ['aws'],
      nodes: [existing],
    });
    const kept = result.nodes.find((n) => n.nodeId === 'keep1');
    expect(kept).toBeDefined();
    expect(kept!.config.memory).toBe('512');
    expect(kept!.position).toEqual({ x: 10, y: 20 });
  });
});
