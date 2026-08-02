import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTraceEmitter } from '@/lib/generate/trace-emitter';
import type { ArchNode } from '@/lib/generate/orchestrator';

/**
 * Agent loop controller (feature 004 FR-001–FR-004, FR-009, FR-011; research
 * R2, R5, R7). The LLM boundary (`@/lib/llm`) is mocked so the loop's
 * iteration/budget/stop/preserve-user-work logic is exercised deterministically
 * without real network calls — the plan-sanitization and pricing/layout paths
 * underneath still run for real (as in orchestrator.test.ts's degraded-mode
 * suite), so this also proves the loop composes those phases correctly.
 */

const llmJsonMock = vi.fn();
let llmAvailableValue = true;

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>();
  return {
    ...actual,
    llmAvailable: () => llmAvailableValue,
    llmJson: (opts: unknown) => llmJsonMock(opts),
  };
});

// 005 — loop-config reads these env vars once at module-load time; intEnv()
// falls back to its default for a non-positive value, so '1' (not '0') is
// the way to keep the chunk-round-loop tests below fast (no real waiting)
// without affecting the *behavior* under test (round counts, termination).
process.env.AGENT_CHUNK_PLAN_DELAY_MS = '1';
process.env.AGENT_CHUNK_RENDER_DELAY_MS = '1';

// Imported AFTER the mock is registered (vi.mock is hoisted by vitest anyway,
// but keeping the import below the mock keeps the causal order obvious).
const { runAgentLoop } = await import('@/lib/generate/agent-loop');
const { CHUNK_ROUND_BUDGET } = await import('@/lib/generate/loop-config');

beforeAll(() => {
  delete process.env.AWS_MCP_COMMAND;
  delete process.env.AWS_COST_MCP_COMMAND;
  delete process.env.MONGODB_MCP_COMMAND;
});

beforeEach(() => {
  llmJsonMock.mockReset();
  llmAvailableValue = true;
});

function mockBySystemPrompt(handlers: { match: string; respond: (opts: { user: string }) => unknown }[]) {
  llmJsonMock.mockImplementation((opts: { system: string; user: string }) => {
    const handler = handlers.find((h) => opts.system.includes(h.match));
    if (!handler) throw new Error(`unexpected llmJson call, system starts: ${opts.system.slice(0, 60)}`);
    return handler.respond(opts);
  });
}

const basePlan = (overrides: Record<string, unknown> = {}) => ({
  reply: 'Updated the architecture.',
  add: [{ serviceId: 'aws-lambda' }],
  remove: [],
  update: [],
  edges: [],
  ...overrides,
});

const passVerdict = { pass: true, unmetCapabilities: [], refinementInstructions: '' };
const failVerdict = (unmet: string[], instructions: string) => ({ pass: false, unmetCapabilities: unmet, refinementInstructions: instructions });

const emptyInput = {
  text: 'Design a serverless API with a queue and a WAF',
  activeTools: ['aws' as const],
  nodes: [],
  edges: [],
  containers: [],
  annotations: [],
  guidance: {},
  defaultRegion: 'us-east-1',
};

function makeCtx(overrides: Partial<{ isStopRequested: () => Promise<boolean> }> = {}) {
  const emitter = createTraceEmitter(() => {});
  return { emitter, isStopRequested: overrides.isStopRequested ?? (async () => false), signal: new AbortController().signal };
}

describe('runAgentLoop', () => {
  it('asks to attach a tool instead of looping when none is attached (FR-014a)', async () => {
    const ctx = makeCtx();
    const result = await runAgentLoop({ ...emptyInput, activeTools: [] }, ctx);
    expect(result.terminalStatus).toBe('converged');
    expect(result.iterations).toBe(1);
    expect(result.reply.toLowerCase()).toContain('attach');
    expect(llmJsonMock).not.toHaveBeenCalled();
  });

  it('degraded mode (no LLM) runs one backbone pass and reports converged, matching legacy behavior', async () => {
    llmAvailableValue = false;
    const ctx = makeCtx();
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.iterations).toBe(1);
    expect(result.terminalStatus).toBe('converged');
    expect(result.converged).toBe(true);
    expect(result.indicative).toBe(true);
    expect(llmJsonMock).not.toHaveBeenCalled();
  });

  it('exits early on the first passing review (US1/AC3)', async () => {
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      { match: 'quality reviewer', respond: () => passVerdict },
    ]);
    const ctx = makeCtx();
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.iterations).toBe(1);
    expect(result.converged).toBe(true);
    expect(result.terminalStatus).toBe('converged');
  });

  it('every generated edge leaves the loop with connection sides assigned', async () => {
    // Wiring guard for the any-side handle feature: the geometry rule lives in
    // edge-sides.test.ts, but if buildResult ever stops calling it, generated
    // edges silently fall back to right→left forever — precisely the "AI never
    // connects from the top or bottom" report this closed.
    mockBySystemPrompt([
      {
        match: 'cloud architecture assistant',
        respond: () =>
          basePlan({
            add: [{ serviceId: 'aws-lambda' }, { serviceId: 'aws-dynamodb' }],
            edges: [{ source: 'new:0', target: 'new:1', label: 'reads/writes' }],
          }),
      },
      { match: 'quality reviewer', respond: () => passVerdict },
    ]);
    const result = await runAgentLoop(emptyInput, makeCtx());
    expect(result.edges.length).toBeGreaterThan(0);
    for (const e of result.edges) {
      expect(['top', 'right', 'bottom', 'left'], `edge ${e.edgeId} sourceHandle`).toContain(e.sourceHandle);
      expect(['top', 'right', 'bottom', 'left'], `edge ${e.edgeId} targetHandle`).toContain(e.targetHandle);
    }
  });

  it('carries the final review coverage into the result (interpretability, 2026-08)', async () => {
    // The route persists result.coverage on the assistant message — if the
    // loop ever stops forwarding the verdict's table, the evaluation panel
    // silently disappears for every turn.
    const coverage = [
      { requirement: 'a serverless API', met: true, evidence: 'aws-lambda (svc-1)', gap: '' },
      { requirement: 'a WAF', met: false, evidence: '', gap: 'No WAF service present.' },
    ];
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      { match: 'quality reviewer', respond: () => ({ ...failVerdict(['WAF'], 'Add a WAF.'), coverage }) },
    ]);
    const result = await runAgentLoop(emptyInput, makeCtx());
    expect(result.coverage).toEqual(coverage);
    expect(result.converged).toBe(false);
  });

  it('caps refinement at the iteration budget and returns best-effort (FR-003/FR-004)', async () => {
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
    ]);
    const ctx = makeCtx();
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.iterations).toBe(3);
    expect(result.converged).toBe(false);
    expect(result.terminalStatus).toBe('best_effort');
    expect(result.reply).toContain('WAF');
    const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
    const reviewCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('quality reviewer'));
    expect(planCalls).toHaveLength(3);
    expect(reviewCalls).toHaveLength(3);
  });

  it('feeds the review refinementInstructions into the next draft pass (research R2)', async () => {
    let call = 0;
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      {
        match: 'quality reviewer',
        respond: () => {
          call++;
          return call === 1 ? failVerdict(['WAF'], 'Please add a WAF in front of the API.') : passVerdict;
        },
      },
    ]);
    const ctx = makeCtx();
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.iterations).toBe(2);
    expect(result.converged).toBe(true);
    const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
    expect(planCalls).toHaveLength(2);
    expect(planCalls[1][0].user).toContain('Please add a WAF in front of the API.');
  });

  it('records a review trace step with pass/fail detail (FR-002)', async () => {
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      { match: 'quality reviewer', respond: () => failVerdict(['WAF', 'multi-region DR'], 'Add both.') },
    ]);
    const emitter = createTraceEmitter(() => {});
    const ctx = { emitter, isStopRequested: async () => false, signal: new AbortController().signal };
    await runAgentLoop(emptyInput, ctx);
    const reviewStep = emitter.steps.find((s) => s.kind === 'review' && s.iteration === 1);
    expect(reviewStep?.status).toBe('done');
    expect(reviewStep?.detail).toContain('WAF');
    expect(reviewStep?.detail).toContain('multi-region DR');
  });

  it('rejects a refine pass that alters a node outside the change scope (FR-011, research R7)', async () => {
    const inputWithExisting = {
      ...emptyInput,
      nodes: [
        { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws' as const, category: 'Compute', position: { x: 0, y: 0 }, config: { memory: '512' }, cost: 5, costBasis: 'indicative' as const },
        { nodeId: 'n2', serviceId: 'aws-s3', provider: 'aws' as const, category: 'Storage', position: { x: 100, y: 0 }, config: { storage: '10' }, cost: 2, costBasis: 'indicative' as const },
      ] as ArchNode[],
    };
    let draftCall = 0;
    mockBySystemPrompt([
      { match: 'You analyze a user request', respond: () => ({ capabilities: ['add a queue'], changeScope: ['n1'] }) },
      {
        match: 'cloud architecture assistant',
        respond: () => {
          draftCall++;
          // Iteration 2 illegally reconfigures the out-of-scope n2 AND adds a marker node.
          return draftCall === 1
            ? basePlan({ add: [{ serviceId: 'aws-sqs' }] })
            : basePlan({ add: [{ serviceId: 'aws-dynamodb' }], update: [{ nodeId: 'n2', config: { storage: '999' } }] });
        },
      },
      { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
    ]);
    const emitter = createTraceEmitter(() => {});
    const ctx = { emitter, isStopRequested: async () => false, signal: new AbortController().signal };
    const result = await runAgentLoop(inputWithExisting, ctx);

    // The violating iteration's output must never be applied.
    expect(result.nodes.some((n) => n.serviceId === 'aws-dynamodb')).toBe(false);
    const n2 = result.nodes.find((n) => n.nodeId === 'n2');
    expect(n2?.config.storage).toBe('10');
    expect(result.converged).toBe(false);
    expect(result.terminalStatus).toBe('best_effort');
    const refineStep = emitter.steps.find((s) => s.kind === 'refine');
    expect(refineStep?.status).toBe('failed');
  });

  it('stops promptly when a stop is requested between phases and persists nothing beyond the last completed phase (FR-009)', async () => {
    let calls = 0;
    mockBySystemPrompt([
      { match: 'cloud architecture assistant', respond: () => basePlan() },
      { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
    ]);
    // isStopRequested is checked 3x within iteration 1 (top-of-loop, post-draft,
    // post-validate) plus 2x before the loop starts (post-understand, post-gather).
    // Returning true on the 6th call fires it at iteration 2's top-of-loop check —
    // i.e. right after iteration 1 fully completes, before iteration 2 starts.
    const isStopRequested = async () => {
      calls++;
      return calls > 5;
    };
    const ctx = makeCtx({ isStopRequested });
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.terminalStatus).toBe('stopped');
    expect(result.stopped).toBe(true);
    expect(result.converged).toBe(false);
    const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
    expect(planCalls).toHaveLength(1);
  });

  it('propagates the first draft failure unchanged (003 architecture-phase failure contract)', async () => {
    mockBySystemPrompt([
      {
        match: 'cloud architecture assistant',
        respond: () => {
          throw new Error('boom');
        },
      },
    ]);
    const ctx = makeCtx();
    await expect(runAgentLoop(emptyInput, ctx)).rejects.toThrow('boom');
  });

  it('keeps the previous best draft when a later refine draft call fails', async () => {
    let draftCall = 0;
    mockBySystemPrompt([
      {
        match: 'cloud architecture assistant',
        respond: () => {
          draftCall++;
          if (draftCall === 1) return basePlan();
          throw new Error('transient failure');
        },
      },
      { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
    ]);
    const ctx = makeCtx();
    const result = await runAgentLoop(emptyInput, ctx);
    expect(result.converged).toBe(false);
    expect(result.terminalStatus).toBe('best_effort');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  // 005 — chunk-planning round loop (FR-001/004/006/007/010, research R1/R3).
  describe('chunk-planning rounds', () => {
    it('a single-round response (moreNeeded:false) makes exactly one plan call per iteration (FR-009/SC-003)', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan({ moreNeeded: false }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls).toHaveLength(1);
      expect(result.iterations).toBe(1);
    });

    it('runs a second chunk-planning round when moreNeeded:true, aware of the first round\'s result, then stops (FR-001/004)', async () => {
      let call = 0;
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () => {
            call++;
            return call === 1
              ? basePlan({ moreNeeded: true, add: [{ serviceId: 'aws-lambda' }] })
              : basePlan({ moreNeeded: false, add: [{ serviceId: 'aws-dynamodb' }] });
          },
        },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls).toHaveLength(2);
      // FR-004 — round 2's context already includes round 1's applied node.
      expect(planCalls[1][0].user).toContain('aws-lambda');
      expect(result.nodes.some((n) => n.serviceId === 'aws-lambda')).toBe(true);
      expect(result.nodes.some((n) => n.serviceId === 'aws-dynamodb')).toBe(true);
      expect(result.iterations).toBe(1);
    });

    it('enforces a chunk-round safety cap even if the model never sets moreNeeded:false', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan({ moreNeeded: true }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls).toHaveLength(CHUNK_ROUND_BUDGET);
      expect(result.terminalStatus).not.toBe('stopped');
    });

    it('a chunk round failing after the first preserves every prior round\'s applied chunks (FR-010)', async () => {
      let call = 0;
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () => {
            call++;
            if (call === 1) return basePlan({ moreNeeded: true, add: [{ serviceId: 'aws-lambda' }] });
            throw new Error('transient round failure');
          },
        },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      // Round 1's chunk survives even though round 2 failed.
      expect(result.nodes.some((n) => n.serviceId === 'aws-lambda')).toBe(true);
      expect(result.terminalStatus).not.toBe('stopped');
    });

    it('a stop requested between chunk rounds ends the turn as stopped, keeping the first round\'s chunk (FR-007)', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan({ moreNeeded: true, add: [{ serviceId: 'aws-lambda' }] }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      let calls = 0;
      // isStopRequested is polled 3x before round 1 even starts (post-understand,
      // post-gather, top-of-iteration-1); round 1 itself makes no such call, so
      // the round loop's own check (before round 2) is the 4th call — the first
      // opportunity to observe a stop once round 1's chunk is already applied.
      const isStopRequested = async () => {
        calls++;
        return calls > 3;
      };
      const ctx = makeCtx({ isStopRequested });
      const result = await runAgentLoop(emptyInput, ctx);
      expect(result.terminalStatus).toBe('stopped');
      expect(result.stopped).toBe(true);
      expect(result.nodes.some((n) => n.serviceId === 'aws-lambda')).toBe(true);
    });
  });

  // Requirements-coverage loop (generation-quality improvement, Anthropic
  // evaluator-optimizer): the understand phase extracts a checklist even on an
  // empty canvas; the planner sees it as MUSTs and the reviewer grades it item
  // by item, with unmet coverage a code-side hard gate.
  describe('requirements coverage', () => {
    it('extracts requirements on an EMPTY canvas and feeds the checklist to the planner prompt', async () => {
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['a serverless API', 'a queue', 'a WAF'], changeScope: [] }) },
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      await runAgentLoop(emptyInput, ctx);
      const understandCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('You analyze a user request'));
      expect(understandCalls).toHaveLength(1);
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls[0][0].user).toContain('REQUIREMENTS CHECKLIST');
      expect(planCalls[0][0].user).toContain('a WAF');
    });

    it('passes the checklist to the reviewer and an unmet coverage entry is a hard gate even when the model says pass', async () => {
      let reviewCall = 0;
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['a serverless API', 'a WAF'], changeScope: [] }) },
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        {
          match: 'quality reviewer',
          respond: () => {
            reviewCall++;
            // Review 1: model claims pass, but its own coverage grading says the
            // WAF is unmet — the code-side gate must overrule pass:true.
            return reviewCall === 1
              ? {
                  pass: true,
                  unmetCapabilities: [],
                  refinementInstructions: '',
                  coverage: [
                    { requirement: 'a serverless API', met: true, evidence: 'aws-lambda', gap: '' },
                    { requirement: 'a WAF', met: false, evidence: '', gap: 'no WAF service present' },
                  ],
                }
              : {
                  pass: true,
                  unmetCapabilities: [],
                  refinementInstructions: '',
                  coverage: [
                    { requirement: 'a serverless API', met: true, evidence: 'aws-lambda', gap: '' },
                    { requirement: 'a WAF', met: true, evidence: 'aws-waf', gap: '' },
                  ],
                };
          },
        },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      expect(result.iterations).toBe(2);
      expect(result.converged).toBe(true);
      const reviewCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('quality reviewer'));
      expect(reviewCalls[0][0].user).toContain('Requirements checklist');
      expect(reviewCalls[0][0].user).toContain('a WAF');
      // The unmet requirement's gap is fed into the next draft's refinement instructions.
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls[1][0].user).toContain('WAF');
    });

    it('confirms full coverage in the final reply when the review passes with a graded checklist', async () => {
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['a serverless API'], changeScope: [] }) },
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        {
          match: 'quality reviewer',
          respond: () => ({
            pass: true,
            unmetCapabilities: [],
            refinementInstructions: '',
            coverage: [{ requirement: 'a serverless API', met: true, evidence: 'aws-lambda', gap: '' }],
          }),
        },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      expect(result.converged).toBe(true);
      expect(result.reply).toContain('Requirements check');
      expect(result.reply).toContain('1 requirement');
    });
  });

  describe('empty-container hygiene', () => {
    it('prunes an AI-created container that ends the draft phase empty', async () => {
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () =>
            basePlan({
              add: [{ serviceId: 'aws-lambda', containerRef: 'newContainer:0' }],
              // vpc gets the lambda; the second (group) container never receives a member.
              containers: { add: [{ type: 'vpc', label: 'VPC' }, { type: 'group', label: 'Empty box' }], update: [], remove: [], assignMembers: [] },
            }),
        },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(emptyInput, ctx);
      expect(result.containers).toHaveLength(1);
      expect(result.containers[0].type).toBe('vpc');
    });

    it('keeps a pre-existing empty user container (preserve-user-work)', async () => {
      const inputWithUserBox = {
        ...emptyInput,
        containers: [
          { containerId: 'user1', type: 'group', label: 'My notes area', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, parentContainerId: null },
        ],
      };
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(inputWithUserBox, ctx);
      expect(result.containers.some((c) => c.containerId === 'user1')).toBe(true);
    });
  });

  // 006 T011/T019 — brief-fed loop (FR-006/FR-008): the guided clarify round's
  // brief replaces the understand phase and its selections are planner MUSTs
  // plus a reviewer hard gate.
  describe('guided brief (feature 006)', () => {
    const brief = {
      capabilities: ['a queue', 'a datastore'],
      selectedServiceIds: ['aws-dynamodb'],
      assumptions: ['Expected monthly users?: 100 (defaulted)'],
      changeScope: [],
    };

    it('feeds the brief into the planner prompt as MUSTs and skips the understand call', async () => {
      const inputWithExisting = {
        ...emptyInput,
        nodes: [
          { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws' as const, category: 'Compute', position: { x: 0, y: 0 }, config: { memory: '512' }, cost: 5, costBasis: 'indicative' as const },
        ] as ArchNode[],
        brief,
      };
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan({ add: [{ serviceId: 'aws-dynamodb' }] }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(inputWithExisting, ctx);
      expect(result.converged).toBe(true);
      // The brief REPLACES understand — no analyze-style call even with existing nodes.
      const understandCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('You analyze a user request'));
      expect(understandCalls).toHaveLength(0);
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      expect(planCalls[0][0].user).toContain('CLARIFIED REQUIREMENTS');
      expect(planCalls[0][0].user).toContain('aws-dynamodb');
      expect(planCalls[0][0].user).toContain('a queue');
    });

    it('a user-selected service missing from the draft is a hard reviewer gate — the loop refines until it is present (FR-008)', async () => {
      let draftCall = 0;
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () => {
            draftCall++;
            // Draft 1 ignores the selection; draft 2 honors it.
            return draftCall === 1
              ? basePlan({ add: [{ serviceId: 'aws-lambda' }] })
              : basePlan({ add: [{ serviceId: 'aws-dynamodb' }] });
          },
        },
        // The model reviewer says pass — the code-side gate must overrule it while
        // the selected service is missing.
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop({ ...emptyInput, brief }, ctx);
      expect(result.iterations).toBe(2);
      expect(result.converged).toBe(true);
      expect(result.nodes.some((n) => n.serviceId === 'aws-dynamodb')).toBe(true);
    });
  });

  // 005 T018/T019 — non-regression: chunking must not change WHEN these
  // once-per-iteration phases run relative to the whole draft phase.
  describe('non-regression: once-per-iteration guarantees hold across chunk rounds', () => {
    it('protectedViolations runs against the fully-assembled iteration result, not per chunk round (FR-011)', async () => {
      const inputWithExisting = {
        ...emptyInput,
        nodes: [
          { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws' as const, category: 'Compute', position: { x: 0, y: 0 }, config: { memory: '512' }, cost: 5, costBasis: 'indicative' as const },
          { nodeId: 'n2', serviceId: 'aws-s3', provider: 'aws' as const, category: 'Storage', position: { x: 100, y: 0 }, config: { storage: '10' }, cost: 2, costBasis: 'indicative' as const },
        ] as ArchNode[],
      };
      let call = 0;
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['add a queue'], changeScope: ['n1'] }) },
        {
          match: 'cloud architecture assistant',
          respond: () => {
            call++;
            // Two chunk rounds within iteration 1, BOTH staying in-scope — no
            // violation should be raised mid-round; only iteration 2 (a refine
            // pass) illegally touches the out-of-scope n2.
            if (call === 1) return basePlan({ moreNeeded: true, add: [{ serviceId: 'aws-sqs' }] });
            if (call === 2) return basePlan({ moreNeeded: false, add: [] });
            return basePlan({ add: [{ serviceId: 'aws-dynamodb' }], update: [{ nodeId: 'n2', config: { storage: '999' } }] });
          },
        },
        { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(inputWithExisting, ctx);

      // Both of iteration 1's chunk rounds applied cleanly (no false-positive
      // violation from evaluating chunk-by-chunk); only iteration 2's illegal
      // change is rejected.
      expect(result.nodes.some((n) => n.serviceId === 'aws-sqs')).toBe(true);
      expect(result.nodes.some((n) => n.serviceId === 'aws-dynamodb')).toBe(false);
      const n2 = result.nodes.find((n) => n.nodeId === 'n2');
      expect(n2?.config.storage).toBe('10');
    });

    it('priceArchitecture/validateArchitecture run once per iteration, after all chunk rounds, not once per round', async () => {
      let call = 0;
      const priceSpy = { calls: 0 };
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () => {
            call++;
            priceSpy.calls = call; // plan calls happen strictly before any given iteration's price/validate step
            return call === 1
              ? basePlan({ moreNeeded: true, add: [{ serviceId: 'aws-lambda' }] })
              : basePlan({ moreNeeded: false, add: [{ serviceId: 'aws-dynamodb' }] });
          },
        },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const emitter = createTraceEmitter(() => {});
      const ctx = { emitter, isStopRequested: async () => false, signal: new AbortController().signal };
      const result = await runAgentLoop(emptyInput, ctx);

      expect(result.iterations).toBe(1);
      // Exactly one validate step for iteration 1 — not one per chunk round.
      const validateSteps = emitter.steps.filter((s) => s.kind === 'validate' && s.iteration === 1);
      expect(validateSteps).toHaveLength(1);
      // Exactly one review step for iteration 1 too (review runs once per
      // iteration, after the whole — possibly multi-round — draft phase).
      const reviewSteps = emitter.steps.filter((s) => s.kind === 'review' && s.iteration === 1);
      expect(reviewSteps).toHaveLength(1);
      // Both chunk rounds' nodes made it into the priced/validated result.
      expect(result.nodes.some((n) => n.serviceId === 'aws-lambda')).toBe(true);
      expect(result.nodes.some((n) => n.serviceId === 'aws-dynamodb')).toBe(true);
    });
  });

  describe('render-order: containers reveal last (generation-quality improvement)', () => {
    it('interim chunk diagram events hide newly-introduced containers/membership; the post-layout reveal restores them', async () => {
      mockBySystemPrompt([
        {
          match: 'cloud architecture assistant',
          respond: () =>
            basePlan({
              add: [{ serviceId: 'aws-lambda', containerRef: 'newContainer:0' }],
              containers: { add: [{ type: 'vpc', label: 'VPC' }], update: [], remove: [], assignMembers: [] },
            }),
        },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const events: Record<string, unknown>[] = [];
      const emitter = createTraceEmitter((e) => events.push(e));
      const ctx = { emitter, isStopRequested: async () => false, signal: new AbortController().signal };
      const result = await runAgentLoop(emptyInput, ctx);

      const diagramEvents = events.filter((e) => e.type === 'diagram') as {
        nodes: ArchNode[];
        containers: { containerId: string }[];
        chunk: number;
      }[];
      expect(diagramEvents.length).toBeGreaterThanOrEqual(2);

      // Every interim event (chunk >= 1) must hide the new container entirely
      // and strip containerId from the node assigned to it — never a dangling
      // parentId pointing at an absent container.
      const interim = diagramEvents.filter((e) => e.chunk >= 1);
      expect(interim.length).toBeGreaterThan(0);
      for (const e of interim) {
        expect(e.containers).toHaveLength(0);
        for (const n of e.nodes) expect(n.containerId).toBeFalsy();
      }

      // The reveal event (chunk === 0, emitted after layout) carries the real,
      // laid-out container and the lambda actually nested inside it.
      const reveal = diagramEvents.find((e) => e.chunk === 0);
      expect(reveal).toBeDefined();
      expect(reveal!.containers.length).toBeGreaterThan(0);
      const lambda = reveal!.nodes.find((n) => n.serviceId === 'aws-lambda');
      expect(lambda?.containerId).toBeTruthy();

      expect(result.containers.length).toBeGreaterThan(0);
      expect(result.nodes.find((n) => n.serviceId === 'aws-lambda')?.containerId).toBeTruthy();
    });

    it('does not emit a reveal event on a non-structural (pure config/cost) turn', async () => {
      const inputWithExisting = {
        ...emptyInput,
        nodes: [
          { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws' as const, category: 'Compute', position: { x: 0, y: 0 }, config: { memory: '512' }, cost: 5, costBasis: 'indicative' as const },
        ] as ArchNode[],
      };
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['bump memory'], changeScope: ['n1'] }) },
        { match: 'cloud architecture assistant', respond: () => basePlan({ add: [], update: [{ nodeId: 'n1', config: { memory: '1024' } }] }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const events: Record<string, unknown>[] = [];
      const emitter = createTraceEmitter((e) => events.push(e));
      const ctx = { emitter, isStopRequested: async () => false, signal: new AbortController().signal };
      await runAgentLoop(inputWithExisting, ctx);

      const revealEvents = events.filter((e) => e.type === 'diagram' && e.chunk === 0);
      expect(revealEvents).toHaveLength(0);
    });
  });

  describe('topology orphan gate + FR-011 protected scope (generation-quality improvement)', () => {
    it('a pre-existing, protected orphan node does not burn the iteration budget (regression: unfixable-gap risk)', async () => {
      const inputWithExisting = {
        ...emptyInput,
        // n1 sits outside every container and is NOT in this turn's change scope —
        // without the exemption, checkTopologyStructure would flag it as an orphan
        // every iteration, the hard gate would force pass:false, and a refine pass
        // could never legally fix it (FR-011), burning the full iteration budget.
        nodes: [
          { nodeId: 'n1', serviceId: 'aws-s3', provider: 'aws' as const, category: 'Storage', position: { x: 0, y: 0 }, config: {}, cost: 0, costBasis: 'indicative' as const, containerId: null },
          { nodeId: 'n2', serviceId: 'aws-lambda', provider: 'aws' as const, category: 'Compute', position: { x: 100, y: 0 }, config: {}, cost: 0, costBasis: 'indicative' as const, containerId: 'vpc1' },
        ] as ArchNode[],
        containers: [
          { containerId: 'vpc1', type: 'vpc', label: 'VPC', position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, parentContainerId: null },
        ],
      };
      mockBySystemPrompt([
        { match: 'You analyze a user request', respond: () => ({ capabilities: ['bump memory'], changeScope: ['n2'] }) },
        // Config-only change to the in-scope n2 — keeps total AWS node count at
        // 2 (below the 3+ threshold for the unrelated missingRegion/cloudBoundary
        // rules), isolating this test to the count-independent orphan rule.
        { match: 'cloud architecture assistant', respond: () => basePlan({ add: [], update: [{ nodeId: 'n2', config: { memory: '1024' } }] }) },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop(inputWithExisting, ctx);

      expect(result.iterations).toBe(1);
      expect(result.converged).toBe(true);
      expect(result.terminalStatus).toBe('converged');
    });
  });

  describe('lightweight mode (routing — small_edit turns skip MCP lookup + multi-round refine)', () => {
    it('skips the MCP lookup step entirely under lightweight:true, unlike default mode (which attempts and fails it)', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctxDefault = makeCtx();
      await runAgentLoop(emptyInput, ctxDefault);
      expect(ctxDefault.emitter.steps.some((s) => s.kind === 'lookup')).toBe(true);
      expect(ctxDefault.emitter.steps.find((s) => s.kind === 'lookup')?.status).toBe('failed');

      const ctxLight = makeCtx();
      await runAgentLoop({ ...emptyInput, lightweight: true }, ctxLight);
      expect(ctxLight.emitter.steps.some((s) => s.kind === 'lookup')).toBe(false);
    });

    it('caps refinement at 1 iteration under lightweight:true, even when review keeps failing', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        { match: 'quality reviewer', respond: () => failVerdict(['WAF'], 'Add a WAF.') },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop({ ...emptyInput, lightweight: true }, ctx);
      expect(result.iterations).toBe(1);
      expect(result.converged).toBe(false);
      expect(result.terminalStatus).toBe('best_effort');
      const planCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('cloud architecture assistant'));
      const reviewCalls = llmJsonMock.mock.calls.filter(([opts]) => opts.system.includes('quality reviewer'));
      expect(planCalls).toHaveLength(1);
      expect(reviewCalls).toHaveLength(1);
    });

    it('converges normally under lightweight:true when the first draft passes review, and is not falsely marked indicative', async () => {
      mockBySystemPrompt([
        { match: 'cloud architecture assistant', respond: () => basePlan() },
        { match: 'quality reviewer', respond: () => passVerdict },
      ]);
      const ctx = makeCtx();
      const result = await runAgentLoop({ ...emptyInput, lightweight: true }, ctx);
      expect(result.iterations).toBe(1);
      expect(result.converged).toBe(true);
      expect(result.terminalStatus).toBe('converged');
      expect(result.indicative).toBe(false);
    });
  });
});
