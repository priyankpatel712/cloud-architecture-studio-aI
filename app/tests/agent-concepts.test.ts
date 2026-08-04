import { describe, expect, it } from 'vitest';
import { ACTION_GROUPS, actionGroup, groupForTool, renderActionGroupManifest } from '@/lib/agent/action-groups';
import { AGENT_ROSTER, agentById, agentForStepKind } from '@/lib/agent/roster';
import { STEP_KINDS, type StepKind } from '@/lib/generate/trace-emitter';
import { LLM_ROLES } from '@/lib/llm-roles';

/**
 * Agentic-concepts registries (action-groups.ts, roster.ts). These are the
 * reviewable inventories of what the agents may do and who does what — the
 * assertions here keep them total and internally consistent as step kinds,
 * roles, and tools evolve.
 */

describe('action groups (Tool Use / Action Group)', () => {
  it('declares unique group ids and unique tool names across groups', () => {
    const groupIds = ACTION_GROUPS.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const toolNames = ACTION_GROUPS.flatMap((g) => g.tools.map((t) => t.name));
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('every group has a purpose and at least one tool with a valid kind', () => {
    for (const g of ACTION_GROUPS) {
      expect(g.purpose.length, g.id).toBeGreaterThan(0);
      expect(g.tools.length, g.id).toBeGreaterThan(0);
      for (const t of g.tools) {
        expect(['llm', 'mcp', 'deterministic'], `${g.id}/${t.name}`).toContain(t.kind);
      }
    }
  });

  it('resolves groups by id and by tool name', () => {
    expect(actionGroup('diagram-editing')?.label).toBe('Diagram editing');
    expect(actionGroup('nope')).toBeNull();
    expect(groupForTool('review_draft')?.id).toBe('validation-review');
    expect(groupForTool('plan_chunk')?.id).toBe('diagram-editing');
    expect(groupForTool('unknown_tool')).toBeNull();
  });

  it('renders a manifest line per group', () => {
    const manifest = renderActionGroupManifest();
    for (const g of ACTION_GROUPS) expect(manifest).toContain(`(${g.id})`);
  });
});

describe('multi-agent roster', () => {
  it('maps every trace step kind to exactly one agent', () => {
    for (const kind of STEP_KINDS) {
      const owners = AGENT_ROSTER.filter((a) => a.stepKinds.includes(kind as StepKind));
      expect(owners.length, `step kind '${kind}' must belong to exactly one agent`).toBe(1);
    }
  });

  it('only grants action groups that exist and llm roles that exist', () => {
    for (const a of AGENT_ROSTER) {
      for (const gid of a.actionGroupIds) {
        expect(actionGroup(gid), `${a.id} grants unknown action group '${gid}'`).not.toBeNull();
      }
      if (a.llmRole !== null) {
        expect(LLM_ROLES as readonly string[], `${a.id} uses unknown llm role`).toContain(a.llmRole);
      }
    }
  });

  it('attributes steps to the right specialists', () => {
    expect(agentForStepKind('draft').id).toBe('architect');
    expect(agentForStepKind('review').id).toBe('reviewer');
    expect(agentForStepKind('reason').id).toBe('coordinator');
    expect(agentForStepKind('knowledge').id).toBe('knowledge-curator');
    expect(agentById('cost-analyst')?.stepKinds).toContain('price');
  });
});
