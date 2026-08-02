#!/usr/bin/env node
/**
 * Design-quality baseline harness (feature 008, FR-041 / SC-009).
 *
 * WHY THIS EXISTS AND WHY IT RUNS FIRST
 * SC-004 requires that model tiering not degrade design quality "at or better
 * than the recorded pre-tiering baseline". Once per-role model chains are
 * enabled (plan Phase 2), the pre-tiering numbers can no longer be produced —
 * the old behavior is gone. So this must be run BEFORE any tiering work lands,
 * or SC-004 becomes permanently unverifiable.
 *
 * WHAT IT MEASURES
 * Over a fixed request set, against the CURRENT pipeline:
 *   - convergenceRate      fraction of turns whose self-review passed
 *   - meanIterationsToPass  mean review iterations consumed
 * Both are read from the persisted GenerationRun for each turn, so this measures
 * the real loop rather than a reimplementation of it.
 *
 * REQUIREMENTS — this makes real LLM calls and needs a real environment:
 *   - MongoDB reachable at MONGODB_URI
 *   - a configured AI connection (Settings → AI Provider, or LLM_* env vars)
 *   - the dev server running at BASE_URL (default http://localhost:3000)
 *   - model tiering OFF in Settings (checked below — a "pre-tiering" baseline
 *     recorded while tiering is on measures the wrong pipeline)
 *
 * USAGE
 *   npm run baseline                   pre-tiering leg (requires tiering OFF)
 *   npm run baseline -- --post        post-tiering leg + SC-004 comparison (tiering ON)
 *   npm run baseline -- --limit 5     smoke run on the first 5 requests only
 *                                      (labeled as a subset; never comparable
 *                                      against a full run)
 *
 * The full set is 20 requests; expect roughly 40–90 minutes per leg depending
 * on provider health. Run the two legs back-to-back so they face similar
 * conditions.
 *
 * AUTH: signs itself in with SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
 * from .env.local — the same account `npm run seed` maintains — so no cookie
 * has to be copied from a browser. Set BASELINE_COOKIE to override with an
 * explicit session instead.
 *
 * The numbers this prints are the only acceptable source for baseline.json.
 * Do not hand-write that file: a fabricated baseline makes SC-004 meaningless.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

/**
 * Fixed request set, v2 — 20 workloads grounded in OFFICIAL AWS reference
 * architectures (Architecture Center, Solutions Library, Prescriptive
 * Guidance; the GenAI entries were cross-checked against the AWS Knowledge
 * MCP on 2026-08-01). Six generative-AI patterns plus the top classic
 * categories, each phrased as a real user request — capabilities, not service
 * names, because choosing services is the pipeline's job, not the prompt's.
 *
 * CHANGING THIS SET INVALIDATES THE BASELINE: pre and post files must be
 * measured on identical prompts, and the --post comparison refuses files whose
 * `requestSet` labels differ. Add a v3 rather than editing v2 in place.
 */
const REQUEST_SET_LABEL = 'aws-reference-architectures-v2';
const REQUEST_SET = [
  // --- Generative AI (AWS Prescriptive Guidance: "Repeatable application
  // patterns for common generative AI use cases"; Bedrock agents + knowledge
  // bases pattern; RAG-based intelligent document assistants blog) ---
  // 1. RAG knowledge-base assistant (Bedrock agents & knowledge bases pattern)
  'An internal knowledge assistant: employees ask questions in a chat UI and get answers grounded in our company document library, with citations. Needs user authentication, document ingestion and embedding, vector search, and usage monitoring.',
  // 2. Intelligent document processing with GenAI (IDP on AWS solution)
  'Automated document processing: scanned invoices and contracts are uploaded, classified, key fields extracted and summarized by an AI model, with a human review queue for low-confidence results and an audit trail of every decision.',
  // 3. Text-to-SQL analytics assistant (RAG + SQL querying + agents pattern)
  'A natural-language analytics assistant: business users ask questions in plain English, the system generates and runs SQL against our data warehouse, and returns tables and summaries. Guard against runaway queries and log every generated query.',
  // 4. Agent-based task automation (Bedrock Agents action groups)
  'An AI support agent that can look up a customer order, check refund eligibility against business rules, call our internal refund API, and escalate to a human when unsure — with every action logged and rate-limited.',
  // 5. Batch content generation with approval (GenAI content pipeline pattern)
  'A content generation pipeline: product data is batched to an AI model to draft descriptions and marketing copy in multiple languages, drafts go through a human approval workflow, and approved copy is published to the storefront.',
  // 6. Semantic search (vector search for e-commerce pattern)
  'Semantic product search for our catalog: shoppers type natural phrases, results are ranked by meaning using embeddings with keyword fallback and category filters, updated within minutes of catalog changes.',

  // --- Classic reference architectures ---
  // 7. Serverless web application (AWS serverless web app reference)
  'A serverless web application: static frontend behind a CDN, REST API, user sign-up and sign-in, a NoSQL data store, and per-user file uploads.',
  // 8. E-commerce storefront (AWS e-commerce reference architectures)
  'An e-commerce storefront: product catalog with search, shopping cart, checkout with order processing, session management, transactional email, and protection against common web attacks.',
  // 9. Video on demand (Video on Demand on AWS Foundation solution)
  'A video-on-demand platform: creators upload videos, the system transcodes them into multiple qualities, serves them globally with low latency, and tracks viewing history per user.',
  // 10. Event-driven order processing (EventBridge/SQS event-driven reference)
  'Event-driven order processing: orders arrive via an API, are validated and published as events, downstream services handle payment, inventory, and shipping independently, with failed messages retried and dead-lettered.',
  // 11. Containerized microservices (microservices on ECS/EKS reference)
  'A containerized microservices backend for a food-delivery app: separate services for restaurants, orders, and couriers behind one API entry point, service-to-service messaging, central logs and traces.',
  // 12. Modern data architecture / lakehouse (AWS lake house reference)
  'A data lakehouse: operational databases and event streams land raw in object storage, are cataloged and transformed on a schedule, queryable ad hoc by analysts, with curated marts for BI dashboards.',
  // 13. Real-time streaming analytics (Kinesis clickstream analytics reference)
  'Real-time clickstream analytics: capture website click events at high volume, aggregate them in near real time for a live dashboard, and archive raw events cheaply for later reprocessing.',
  // 14. IoT telemetry (IoT reference architecture)
  'An IoT fleet platform: 50,000 devices send telemetry over MQTT, messages are ingested and buffered, hot readings power live dashboards and threshold alerts, and history is archived for analysis.',
  // 15. Real-time fraud detection (fraud detection with ML reference)
  'Real-time payment fraud detection: score every transaction against an ML model within 100 milliseconds, hold suspicious ones for manual review, and retrain the model regularly from labeled outcomes.',
  // 16. Personalization (real-time personalization reference)
  'A recommendation system for our streaming app: personalized home-page rows per user, updated from watch events in near real time, with A/B testing of recommendation strategies.',
  // 17. Multi-tenant SaaS (AWS SaaS Lens / SaaS Factory reference)
  'A multi-tenant B2B SaaS platform: tenant-isolated data, per-tenant onboarding and configuration, usage metering for billing, background jobs per tenant, and admin analytics across tenants.',
  // 18. Payments ledger (financial services grade patterns)
  'A payments ledger service: append-only transaction records with idempotent writes, strict audit logging, encryption with customer-managed keys, and monitored, alarmed reconciliation jobs.',
  // 19. Multi-region disaster recovery (AWS DR whitepaper: warm standby)
  'Disaster recovery for our critical customer API: a warm standby in a second region with replicated data, health-check-driven failover, and a recovery time objective under 15 minutes.',
  // 20. Game backend (AWS games industry reference)
  'A mobile game backend: player authentication, session state with low-latency reads, global leaderboards, matchmaking queues, and analytics on player events.',
];

const BASE_URL = env.BASELINE_BASE_URL ?? 'http://localhost:3000';

/**
 * `--post` (T064 / SC-004): measure the SAME request set with tiering ON and
 * compare against the recorded pre-tiering baseline. Everything else about the
 * run is identical — same prompts, same skip-all path, same design-pass guard —
 * which is the whole point: the only variable between the two files is tiering.
 */
const POST = argv.includes('--post');

/**
 * `--limit N`: measure only the first N requests — a smoke run. The recorded
 * label carries the subset size, so the comparison guard below can never treat
 * a 5-request smoke file and the full 20-request set as comparable.
 */
const limitFlag = argv.indexOf('--limit');
const LIMIT =
  limitFlag !== -1 && Number.parseInt(argv[limitFlag + 1], 10) > 0
    ? Math.min(Number.parseInt(argv[limitFlag + 1], 10), REQUEST_SET.length)
    : REQUEST_SET.length;
const ACTIVE_SET = REQUEST_SET.slice(0, LIMIT);
const ACTIVE_LABEL = LIMIT === REQUEST_SET.length ? REQUEST_SET_LABEL : `${REQUEST_SET_LABEL}-first${LIMIT}`;

const outFlag = argv.indexOf('--out');
const specDir = (name) =>
  // fileURLToPath, not .pathname: on Windows the latter yields "/C:/laragon/…",
  // which fs then resolves against the drive root as "C:\C:\laragon\…".
  fileURLToPath(new URL(`../../specs/008-multi-agent-knowledge-pipeline/${name}`, import.meta.url));
const OUT_PATH =
  outFlag !== -1 && argv[outFlag + 1] ? argv[outFlag + 1] : specDir(POST ? 'post-tiering.json' : 'baseline.json');

/** Session cookie for the chat API; resolved in main() before any request. */
let COOKIE = env.BASELINE_COOKIE ?? '';

/**
 * Obtain a session without a human copying cookies out of devtools: sign in
 * with the seed superadmin from .env.local — the account `npm run seed`
 * creates and keeps reset. BASELINE_COOKIE remains an explicit override.
 */
async function resolveCookie() {
  if (COOKIE) return;
  const email = env.SEED_SUPERADMIN_EMAIL ?? '';
  const password = env.SEED_SUPERADMIN_PASSWORD ?? '';
  if (!email || !password) {
    console.error(
      'ERROR: no session available. Either set SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD\n' +
        'in .env.local (then `npm run seed` once), or pass an explicit cookie:\n' +
        '  BASELINE_COOKIE="cas_session=..." npm run baseline'
    );
    exit(1);
  }
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    console.error(`ERROR: cannot reach ${BASE_URL} — is the dev server running? Start it with:  npm run dev`);
    exit(1);
  }
  if (!res.ok) {
    console.error(
      `ERROR: sign-in as ${email} failed (${res.status}). If the password changed, update\n` +
        'SEED_SUPERADMIN_PASSWORD in .env.local or pass BASELINE_COOKIE explicitly.'
    );
    exit(1);
  }
  const session = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('cas_session='));
  if (!session) {
    console.error('ERROR: sign-in succeeded but no cas_session cookie was set — cannot continue.');
    exit(1);
  }
  COOKIE = session;
  console.log(`Signed in as ${email}.`);
}

/**
 * Steps that only a real design pass produces.
 *
 * THIS GUARD IS THE POINT. The guided flow (feature 006) answers a fresh request
 * with an ANALYZE turn that asks clarifying questions and draws nothing — and
 * that turn is persisted with `converged: true, iterations: 1`, because it did
 * what it set out to do. Reading those fields without checking what the run
 * actually contained yields a perfect 1.0/1.0 baseline measured entirely on
 * turns that never designed anything. It did exactly that on the first run of
 * this harness.
 */
const DESIGN_STEPS = ['draft', 'review', 'refine'];

/** POST to the turn endpoint and drain the NDJSON stream. */
async function postTurn(projectId, body) {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chat/messages failed (${res.status})`);

  let runId = null;
  let terminal = null;
  let interactionId = null;
  let awaiting = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'result') {
        terminal = 'result';
        runId = event.payload?.message?.runId ?? runId;
        interactionId = event.payload?.message?.interaction?.id ?? null;
        awaiting = event.payload?.conversation?.awaiting ?? null;
      } else if (event.type === 'error' || event.type === 'unsatisfiable' || event.type === 'stopped') {
        terminal = event.type;
      }
    }
  }
  return { runId, terminal, interactionId, awaiting };
}

/**
 * Drive one request all the way to a designed architecture.
 *
 * A fresh request enters the guided flow, so this answers each round with
 * skip-all (the disclosed-defaults path, 006 Scenario 2) until the build turn
 * runs. Skip-all rather than authored answers is deliberate: the baseline must
 * be reproducible after tiering, and hand-written answers would be one more
 * thing that has to match exactly.
 */
async function runOne(prompt, index) {
  const started = Date.now();
  const startRes = await fetch(`${BASE_URL}/api/chat/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ text: prompt }),
  });
  if (!startRes.ok) throw new Error(`chat/start failed (${startRes.status}) for request ${index + 1}`);
  const { projectId } = await startRes.json();

  let turn = await postTurn(projectId, { text: prompt, attachedTools: ['aws'] });
  const runIds = turn.runId ? [turn.runId] : [];

  // Walk the rounds the flow opens. Bounded so a flow that never settles fails
  // the request instead of looping forever.
  for (let round = 0; round < 4 && turn.interactionId; round++) {
    turn = await postTurn(projectId, {
      text: '',
      attachedTools: ['aws'],
      interactionResponse: { interactionId: turn.interactionId, answers: [], skipAll: true },
    });
    if (turn.runId) runIds.push(turn.runId);
  }

  return { projectId, runIds, terminal: turn.terminal, wallMs: Date.now() - started };
}

async function main() {
  const { connectDB } = await import('../src/lib/db.ts');
  const { GenerationRun } = await import('../src/lib/models/GenerationRun.ts');
  const { resolveLlmConfig } = await import('../src/lib/llm.ts');
  const { loadLlmSettings } = await import('../src/lib/llm-settings.ts');
  const { resolveRoleTiering } = await import('../src/lib/llm-roles.ts');

  await connectDB();
  const cfg = await resolveLlmConfig();
  if (!cfg.apiKey) {
    console.error('ERROR: no AI connection configured — baseline would measure the degraded path.');
    exit(1);
  }

  // Each mode requires the OPPOSITE toggle state, for the same reason: the two
  // files must differ in exactly one variable. A "pre-tiering" baseline taken
  // while tiering is on would judge the tiered pipeline against itself; a
  // "post-tiering" run taken while it is off measures nothing new.
  const snapshot = await loadLlmSettings();
  const tieringOn = resolveRoleTiering(snapshot?.roleTieringEnabled);
  if (!POST && tieringOn) {
    console.error(
      'ERROR: model tiering is ON — this would not be a pre-tiering baseline.\n' +
        'Turn OFF "Match the model to the task" in Settings → AI Provider, run this again,\n' +
        'then switch tiering back on. The toggle applies immediately; no restart needed.'
    );
    exit(1);
  }
  if (POST && !tieringOn) {
    console.error(
      'ERROR: --post measures the TIERED pipeline, but tiering is OFF.\n' +
        'Turn ON "Match the model to the task" in Settings → AI Provider and re-run.'
    );
    exit(1);
  }

  await resolveCookie();
  const runStartedAt = new Date();
  console.log(
    `Measuring ${POST ? 'POST-tiering quality' : 'pre-tiering baseline'} against ${cfg.provider}/${cfg.model} over ${ACTIVE_SET.length} requests…\n`
  );

  const rows = [];
  for (const [i, prompt] of ACTIVE_SET.entries()) {
    process.stdout.write(`  [${i + 1}/${ACTIVE_SET.length}] ${prompt.slice(0, 58)}… `);
    try {
      const { runIds, terminal, wallMs } = await runOne(prompt, i);
      const runs = await GenerationRun.find({ _id: { $in: runIds } }).lean();

      // Measure the run that DESIGNED something. An analyze/clarify turn is a
      // legitimate turn but tells us nothing about design quality.
      const designRun = runs.find((r) => (r.steps ?? []).some((s) => DESIGN_STEPS.includes(s.kind)));
      const row = {
        prompt,
        terminal,
        designed: Boolean(designRun),
        converged: designRun?.converged ?? false,
        iterations: designRun?.iterations ?? null,
        terminalStatus: designRun?.terminalStatus ?? null,
        stepKinds: designRun ? (designRun.steps ?? []).map((s) => s.kind) : (runs[0]?.steps ?? []).map((s) => s.kind),
        wallMs,
      };
      rows.push(row);
      if (!designRun) {
        console.log(`NO DESIGN PASS — turns were [${row.stepKinds.join(', ') || 'none'}] (${(wallMs / 1000).toFixed(1)}s)`);
      } else {
        console.log(
          `${row.converged ? 'converged' : row.terminalStatus ?? terminal} (${row.iterations ?? '?'} iter, ${(wallMs / 1000).toFixed(1)}s)`
        );
      }
    } catch (e) {
      rows.push({ prompt, terminal: 'error', designed: false, converged: false, iterations: null, error: String(e) });
      console.log(`FAILED — ${e}`);
    }
  }

  // Refuse to write a baseline that measured no design work. A file that looks
  // authoritative but was computed from clarify turns would make SC-004 worse
  // than having no baseline at all — the comparison would silently pass.
  const designed = rows.filter((r) => r.designed);
  if (designed.length === 0) {
    console.error(
      '\nERROR: not one request reached a design pass — every turn stopped at analyze/clarify.\n' +
        'Nothing was measured, so no baseline was written. Check that the guided flow can be\n' +
        'skipped through (006 Scenario 2) and that the AI connection is not rate-limited.'
    );
    exit(1);
  }
  if (designed.length < rows.length) {
    console.warn(
      `\nWARNING: ${rows.length - designed.length}/${rows.length} requests never designed anything; ` +
        'they are recorded but excluded from the rates below.'
    );
  }

  const converged = designed.filter((r) => r.converged);
  const withIterations = converged.filter((r) => typeof r.iterations === 'number');
  const baseline = {
    recordedAt: new Date().toISOString(),
    mode: POST ? 'post-tiering' : 'pre-tiering',
    requestSet: ACTIVE_LABEL,
    requestCount: ACTIVE_SET.length,
    // Denominator is requests that actually designed something, not all requests.
    designedCount: designed.length,
    convergenceRate: Number((converged.length / designed.length).toFixed(4)),
    meanIterationsToPass:
      withIterations.length > 0
        ? Number((withIterations.reduce((s, r) => s + r.iterations, 0) / withIterations.length).toFixed(4))
        : null,
    provider: cfg.provider,
    model: cfg.model,
    rows,
  };

  if (POST) {
    // SC-004's second clause: at least half the requests served by small/mid
    // tiers. Measured from the usage records THIS run produced, not from the
    // tiering configuration — the panel must report what happened, not policy.
    const { LlmUsage } = await import('../src/lib/models/LlmUsage.ts');
    const usage = await LlmUsage.find({ at: { $gte: runStartedAt } }).lean();
    const smallMid = usage.filter((u) => u.tier !== 'large').length;
    baseline.smallMidShare = usage.length > 0 ? Number((smallMid / usage.length).toFixed(4)) : null;
    baseline.llmRequests = usage.length;
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `\n${POST ? 'Post-tiering results' : 'Baseline'} written to ${OUT_PATH}\n` +
      `  convergenceRate      ${baseline.convergenceRate}\n` +
      `  meanIterationsToPass ${baseline.meanIterationsToPass}`
  );

  if (!POST) {
    console.log('\nNext: enable tiering in Settings, then run  npm run baseline -- --post  to compare (SC-004).');
    exit(0);
  }

  // The comparison T064 exists for. Read the pre-tiering file and put the two
  // runs side by side; SC-004 passes when quality held AND the work moved.
  let pre = null;
  try {
    pre = JSON.parse(readFileSync(specDir('baseline.json'), 'utf8'));
  } catch {
    console.error('\nWARNING: no baseline.json to compare against — run without --post first.');
    exit(1);
  }
  // Same prompts or no comparison at all. Comparing a 20-request AWS-reference
  // run against the old 6-request set (or a --limit smoke file) would produce
  // a confident-looking verdict about two different exams.
  if (pre.requestSet !== baseline.requestSet) {
    console.error(
      `\nERROR: request sets differ — baseline.json is "${pre.requestSet}", this run is "${baseline.requestSet}".\n` +
        'Re-record the pre-tiering leg on the same set first (toggle tiering off, npm run baseline).'
    );
    exit(1);
  }
  const held = (post, before) => (post >= before ? 'held' : 'REGRESSED');
  console.log(
    `  smallMidShare        ${baseline.smallMidShare} (${baseline.llmRequests} model requests)\n\n` +
      `SC-004 comparison against baseline.json (recorded ${pre.recordedAt}):\n` +
      `  convergenceRate      ${pre.convergenceRate} → ${baseline.convergenceRate}  ${held(baseline.convergenceRate, pre.convergenceRate)}\n` +
      `  meanIterationsToPass ${pre.meanIterationsToPass} → ${baseline.meanIterationsToPass}  ${
        baseline.meanIterationsToPass !== null && pre.meanIterationsToPass !== null && baseline.meanIterationsToPass <= pre.meanIterationsToPass ? 'held' : 'check'
      }\n` +
      `  smallMidShare        ${baseline.smallMidShare} ${baseline.smallMidShare !== null && baseline.smallMidShare >= 0.5 ? '≥ 0.5 ✓' : '< 0.5 ✗'}\n\n` +
      'Record this block in quickstart.md (T064).'
  );
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
