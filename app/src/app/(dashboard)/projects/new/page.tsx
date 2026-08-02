'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Cloud, Leaf, TriangleAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { WorkingTrace, type TraceStep, type TraceModelCall } from '@/components/studio/WorkingTrace';
import { EXAMPLE_PROMPTS } from '@/lib/example-prompts';

/**
 * Live background steps (feature 004 FR-005; Clarification 2026-07-09): CREATE_STEP
 * and OPEN_STEP are client-side bookends around the streamed generation steps —
 * they share the v2 TraceStep shape so the same WorkingTrace renderer used by
 * ChatPanel also drives the first generation's live trace here.
 */
const CREATE_STEP: TraceStep = { id: 'create', kind: 'understand', iteration: 1, label: 'Creating your project and conversation thread', status: 'running' };
const OPEN_STEP: TraceStep = { id: 'open', kind: 'persist', iteration: 1, label: 'Opening the studio', status: 'running' };

/**
 * Creation page (US2/AC1): the prompt here is the FIRST message of the project's
 * persistent chat thread — the studio chat continues the same conversation.
 *
 * The generation route streams NDJSON; this page consumes the stream (same
 * protocol as ChatPanel), renders the live background steps, and opens the
 * studio only on the terminal event — when the architecture is actually
 * persisted. Navigating earlier showed an empty studio and left the stream
 * unread ("nothing happened" bug).
 */
export default function NewProjectPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [providers, setProviders] = useState({ aws: true, mongodb: true });
  // Dynamic tool routing: untouched default toggles mean "let the studio
  // choose from the request" — only a user's own toggle counts as an explicit
  // pin (sent to the server, which never overrides an explicit choice).
  const [providersTouched, setProvidersTouched] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [modelCalls, setModelCalls] = useState<TraceModelCall[]>([]);
  // 005 FR-001/002 — no canvas exists on this pre-navigation page, so the
  // progressive build-up shows here as a growing count instead.
  const [chunkNodeCount, setChunkNodeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const attachedTools = providersTouched ? (['aws', 'mongodb'] as const).filter((p) => providers[p]) : [];

  const upsertStep = (s: TraceStep) =>
    setSteps((prev) => {
      const i = prev.findIndex((x) => x.id === s.id);
      if (i === -1) return [...prev, s];
      const next = [...prev];
      next[i] = { ...next[i], ...s };
      return next;
    });

  async function generate() {
    if (!prompt.trim() || generating) return;
    if (providersTouched && attachedTools.length === 0) {
      setError('Attach at least one provider tool — or leave the toggles untouched to let the studio choose from your request.');
      return;
    }
    setError(null);
    setGenerating(true);
    setSteps([CREATE_STEP]);
    setModelCalls([]);
    setChunkNodeCount(0);
    let projectId: string | null = null;
    try {
      const startRes = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: prompt.slice(0, 80) }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? 'Could not create the project.');
      projectId = startData.projectId as string;
      upsertStep({ ...CREATE_STEP, status: 'done' });

      const msgRes = await fetch(`/api/projects/${projectId}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt, attachedTools }),
      });
      // Pre-stream failures (validation, 409 already-generating) are plain JSON.
      if (!(msgRes.headers.get('content-type') ?? '').includes('ndjson')) {
        const msgData = await msgRes.json().catch(() => ({}));
        throw new Error(msgData.error ?? 'Generation failed.');
      }

      // Consume the live NDJSON stream until the terminal event. Failed turns
      // (error/unsatisfiable) still persist the thread — continue into the
      // studio where the chat shows the details.
      const reader = msgRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal = false;
      const handle = (event: Record<string, unknown>) => {
        if (event.type === 'step') {
          upsertStep(event as unknown as TraceStep);
        } else if (event.type === 'model') {
          // Interpretability — same upsert-by-id as ChatPanel: 'calling' first,
          // then the id resolves to its outcome.
          const c = event as unknown as TraceModelCall;
          setModelCalls((prev) => {
            const i = prev.findIndex((x) => x.id === c.id);
            if (i === -1) return [...prev, c];
            const next = [...prev];
            next[i] = { ...next[i], ...c };
            return next;
          });
        } else if (event.type === 'diagram') {
          // 005 FR-001/002 — no canvas here yet; surface progress as a count
          // instead. Must NOT fall into the terminal branch below.
          setChunkNodeCount((event.nodes as unknown[]).length);
        } else if (event.type === 'error' || event.type === 'unsatisfiable') {
          throw new Error((event.error as string) || 'Generation failed.');
        } else {
          terminal = true;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line));
        }
      }
      if (!terminal) throw new Error('The generation stream ended unexpectedly.');

      upsertStep({ ...OPEN_STEP, status: 'done' });
      router.push(`/studio?project=${projectId}`);
    } catch (e) {
      // If the very first generation fails, do not navigate to the studio.
      // An empty studio canvas with no architecture is confusing.
      // Let the user edit their prompt and retry here (which will create a fresh project).
      setGenerating(false);
      setSteps([]);
      setModelCalls([]);
      setError(e instanceof Error ? e.message : 'Generation failed.');
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-3xl flex-col justify-center py-8 animate-rise">
      <div className="mb-8 text-center">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-primary-fixed-dim)] bg-[var(--color-primary-fixed)] px-3 py-1 font-mono text-xs font-medium uppercase tracking-[0.15em] text-[var(--color-on-primary-fixed)]">
          <Sparkles size={13} /> AI Architecture Generator
        </span>
        <h1 className="font-[family-name:var(--font-headline-lg)] text-[2.5rem] font-bold leading-[1.05] tracking-tight text-[var(--color-text-primary)]">
          Describe your system.
          <br />
          <span className="text-[var(--color-primary)]">We&apos;ll architect it.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-[var(--color-text-secondary)]">
          A sentence in — a costed, Well-Architected diagram out, grounded in official AWS and MongoDB
          MCP servers.
        </p>
      </div>

      {!generating ? (
        <>
          <div className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-2 shadow-sm focus-within:border-[var(--color-primary)] focus-within:ring-2 focus-within:ring-[var(--color-primary)]/20">
            <Textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A serverless photo-sharing app with user auth, image thumbnails, and a feed for 50k users…"
              className="border-0 bg-transparent text-[15px] focus:ring-0"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <div className="flex items-center gap-2">
                <ProviderToggle
                  active={providers.aws}
                  onClick={() => { setProvidersTouched(true); setProviders((p) => ({ ...p, aws: !p.aws })); }}
                  icon={<Cloud size={15} />}
                  accent="#FF9900"
                  label="AWS"
                />
                <ProviderToggle
                  active={providers.mongodb}
                  onClick={() => { setProvidersTouched(true); setProviders((p) => ({ ...p, mongodb: !p.mongodb })); }}
                  icon={<Leaf size={15} />}
                  accent="#00b34a"
                  label="Atlas"
                />
              </div>
              <Button onClick={generate} disabled={!prompt.trim()} size="md">
                Generate <ArrowRight size={16} />
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-4 py-3 text-sm text-[#8c1d18]">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              Try a detailed example — click to load it, edit, then Generate
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setPrompt(ex.prompt)}
                  className="flex w-full flex-col gap-1 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] px-4 py-3 text-left transition-all hover:border-[var(--color-primary-fixed-dim)]"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                    <Sparkles size={15} className="shrink-0 text-[var(--color-primary)]" />
                    {ex.title}
                  </div>
                  <div className="pl-[1.625rem] text-[13px] text-[var(--color-text-secondary)] line-clamp-2">
                    {ex.tagline}
                  </div>
                  <div className="flex flex-wrap gap-1 pl-[1.625rem] pt-0.5">
                    {ex.services.map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 shadow-sm">
          <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
            Generating architecture for:{' '}
            <span className="text-[var(--color-text-primary)]">&ldquo;{prompt.slice(0, 90)}{prompt.length > 90 ? '…' : ''}&rdquo;</span>
          </p>
          {/* Live working trace (feature 004 FR-005; Clarification 2026-07-09):
              the first generation reuses the same live-trace UI as the studio
              chat, so every turn on every surface shows its trace (SC-002). */}
          <WorkingTrace steps={steps} modelCalls={modelCalls} />
          {chunkNodeCount > 0 && (
            <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
              {chunkNodeCount} service{chunkNodeCount === 1 ? '' : 's'} placed so far…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderToggle({
  active,
  onClick,
  icon,
  accent,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  accent: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all',
        active
          ? 'border-transparent text-white'
          : 'border-[var(--color-outline-variant)] text-[var(--color-text-secondary)]'
      )}
      style={active ? { background: accent } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}
