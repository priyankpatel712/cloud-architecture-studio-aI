'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, GitBranch, Lightbulb, Loader2, RefreshCw, Route, Settings2, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import { ServiceIcon } from '@/components/ui/Icon';
import { containerTypeById, formatUSD, resolveServiceDef } from '@/lib/catalog';
import type { ArchDocument, DocNode } from '@/lib/canvas/model';

/** Mirror of lib/generate/report.ts ArchitectureReport (client-side view). */
export interface ArchitectureReportView {
  overview: string;
  howItWorks: string;
  services: { name: string; role: string }[];
  improvements: { title: string; detail: string; priority: 'high' | 'medium' | 'low' }[];
  alternatives: { title: string; detail: string }[];
  degraded: boolean;
  generatedAt: string;
}

/** Mirror of lib/generate/report.ts ClientProposalReport (client-side view). */
export interface ClientProposalReportView {
  executiveSummary: string;
  businessValue: { title: string; detail: string }[];
  investmentSummary: { monthly: number; annual: number; basis: 'exact' | 'indicative'; highlights: string[] };
  reliabilityAndSecurity: string;
  scalabilityStory: string;
  recommendations: { title: string; detail: string }[];
  degraded: boolean;
  generatedAt: string;
}

type ReportType = 'developer' | 'client';

function isClientReport(r: ArchitectureReportView | ClientProposalReportView): r is ClientProposalReportView {
  return 'executiveSummary' in r;
}

const PRIORITY_STYLE: Record<string, string> = {
  high: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  medium: 'bg-[#fef7e0] text-[#7a5900]',
  low: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
};

/**
 * Deterministic architecture explanation: how a request transits the diagram
 * (BFS order over the edge graph from its entry points), every connection, and
 * each service's configuration. The AI's design guidance (network/security/
 * ha/dr/scaling) — persisted with the architecture but previously never
 * rendered — closes the story.
 */

const GUIDANCE_SECTIONS: { key: string; label: string }[] = [
  { key: 'network', label: 'Network topology' },
  { key: 'security', label: 'Security' },
  { key: 'ha', label: 'High availability' },
  { key: 'dr', label: 'Disaster recovery' },
  { key: 'scaling', label: 'Scaling' },
];

function nodeName(n: DocNode): string {
  return n.displayName || resolveServiceDef(n.serviceId, n).name;
}

/** BFS depth per node from the graph's entry points (in-degree 0). */
function flowDepths(doc: ArchDocument): Map<string, number> {
  const inDeg = new Map<string, number>(doc.nodes.map((n) => [n.nodeId, 0]));
  for (const e of doc.edges) {
    if (inDeg.has(e.target)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const connected = new Set(doc.edges.flatMap((e) => [e.source, e.target]));
  let queue = doc.nodes
    .filter((n) => connected.has(n.nodeId) && (inDeg.get(n.nodeId) ?? 0) === 0)
    .map((n) => n.nodeId);
  // Pure cycle (no entry point): start from the first edge's source.
  if (queue.length === 0 && doc.edges.length > 0) queue = [doc.edges[0].source];

  const depth = new Map<string, number>();
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const e of doc.edges) {
      if (e.source !== id || depth.has(e.target)) continue;
      depth.set(e.target, d + 1);
      queue.push(e.target);
    }
  }
  return depth;
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
      {icon}
      {children}
    </h3>
  );
}

export function ExplainFlow({
  doc,
  guidance,
  projectId,
}: {
  doc: ArchDocument;
  guidance: Record<string, string>;
  /** when set, the AI report (overview, roles, improvements, alternatives) loads from the server */
  projectId?: string;
}) {
  const [reportType, setReportType] = useState<ReportType>('developer');
  const [report, setReport] = useState<ArchitectureReportView | ClientProposalReportView | null>(null);
  const [reportLoading, setReportLoading] = useState(Boolean(projectId));
  const [reportError, setReportError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      // avoid rendering a stale shape (developer vs. client) mid-switch
      setReport(null);
      setReportLoading(true);
      try {
        const params = new URLSearchParams({ reportType });
        if (refreshTick > 0) params.set('refresh', '1');
        const res = await fetch(`/api/projects/${projectId}/report?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setReportError(data.error ?? 'Could not generate the AI analysis.');
        else setReport(data.report);
      } catch {
        if (!cancelled) setReportError('Could not reach the server for the AI analysis.');
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick, reportType]);

  const developerReport = report && !isClientReport(report) ? report : null;
  const clientReport = report && isClientReport(report) ? report : null;

  const roleFor = (name: string) =>
    developerReport?.services.find((s) => s.name.toLowerCase() === name.toLowerCase())?.role;

  const byId = new Map(doc.nodes.map((n) => [n.nodeId, n]));
  const containers = new Map(doc.containers.map((c) => [c.containerId, c]));
  const depth = flowDepths(doc);

  // Edges in request-transit order: by BFS depth of the source, stable otherwise.
  const orderedEdges = [...doc.edges]
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) => (depth.get(a.source) ?? 99) - (depth.get(b.source) ?? 99));

  const connectedIds = new Set(orderedEdges.flatMap((e) => [e.source, e.target]));
  const isolated = doc.nodes.filter((n) => !connectedIds.has(n.nodeId));

  const orderedNodes = [...doc.nodes].sort(
    (a, b) => (depth.get(a.nodeId) ?? 99) - (depth.get(b.nodeId) ?? 99) || nodeName(a).localeCompare(nodeName(b))
  );

  const guidanceEntries = GUIDANCE_SECTIONS.map((s) => ({ ...s, text: (guidance[s.key] ?? '').trim() })).filter(
    (s) => s.text.length > 0
  );

  if (doc.nodes.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Nothing on the canvas yet — generate or add services first.</p>;
  }

  return (
    <div className="space-y-6">
      {/* 0 — AI analysis: overview + how it works (cached per architecture version) */}
      {projectId && (
        <section>
          <div className="flex items-center justify-between">
            <SectionHeading icon={<Sparkles size={13} />}>AI analysis</SectionHeading>
            <div className="flex items-center gap-3">
              <div className="flex rounded-lg border border-[var(--color-surface-variant)] p-0.5 text-[11px] font-medium">
                {(['developer', 'client'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setReportType(t)}
                    className={`rounded-md px-2 py-0.5 ${
                      reportType === t
                        ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {t === 'developer' ? 'Developer' : 'Client proposal'}
                  </button>
                ))}
              </div>
              {report && !reportLoading && (
                <button
                  type="button"
                  onClick={() => {
                    setReportError(null);
                    setRefreshTick((t) => t + 1);
                  }}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  title="Regenerate the AI analysis"
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              )}
            </div>
          </div>
          {reportLoading && (
            <p className="flex items-center gap-2 rounded-2xl bg-[var(--color-surface-container-low)] p-3 text-sm text-[var(--color-text-secondary)]">
              <Loader2 size={14} className="animate-spin" /> Analyzing this architecture with the AI…
            </p>
          )}
          {reportError && !reportLoading && (
            <p className="rounded-2xl bg-[var(--color-error-container)] p-3 text-sm text-[var(--color-on-error-container)]">{reportError}</p>
          )}
          {developerReport && !reportLoading && (
            <div className="space-y-2.5">
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">How this architecture serves your request</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{developerReport.overview}</p>
              </div>
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-primary)]"><Route size={12} /> How it works</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{developerReport.howItWorks}</p>
              </div>
              {developerReport.degraded && (
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  AI analysis unavailable — showing diagram-derived facts only. Configure a working provider in Settings → AI Provider and refresh.
                </p>
              )}
            </div>
          )}
          {clientReport && !reportLoading && (
            <div className="space-y-2.5">
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Executive summary</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{clientReport.executiveSummary}</p>
              </div>
              {clientReport.businessValue.length > 0 && (
                <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                  <p className="text-xs font-semibold text-[var(--color-text-primary)]">Business value</p>
                  <ul className="mt-1 space-y-1.5">
                    {clientReport.businessValue.map((v) => (
                      <li key={v.title}>
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{v.title}</span>
                        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{v.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Investment summary</p>
                <p className="mt-0.5 text-sm text-[var(--color-text-primary)]">
                  {formatUSD(clientReport.investmentSummary.monthly)}/mo · {formatUSD(clientReport.investmentSummary.annual)}/yr
                  <span className="ml-1 text-[11px] text-[var(--color-text-secondary)]">({clientReport.investmentSummary.basis})</span>
                </p>
                {clientReport.investmentSummary.highlights.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    {clientReport.investmentSummary.highlights.map((h) => (
                      <li key={h} className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{h}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Reliability & security</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{clientReport.reliabilityAndSecurity}</p>
              </div>
              <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Scalability</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{clientReport.scalabilityStory}</p>
              </div>
              {clientReport.recommendations.length > 0 && (
                <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                  <p className="text-xs font-semibold text-[var(--color-text-primary)]">Recommendations</p>
                  <ul className="mt-1 space-y-1.5">
                    {clientReport.recommendations.map((r) => (
                      <li key={r.title}>
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{r.title}</span>
                        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{r.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {clientReport.degraded && (
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  AI analysis unavailable — showing diagram-derived facts only. Configure a working provider in Settings → AI Provider and refresh.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* 1 — request transit */}
      <section>
        <SectionHeading icon={<GitBranch size={13} />}>How a request flows</SectionHeading>
        {orderedEdges.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No connections yet — draw edges between services (or let the AI generate them) to see the request path.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {orderedEdges.map((e, i) => {
              const source = byId.get(e.source)!;
              const target = byId.get(e.target)!;
              return (
                <li key={e.edgeId || `${e.source}-${e.target}-${i}`} className="flex items-center gap-2 rounded-xl bg-[var(--color-surface-container-low)] px-3 py-2 text-sm">
                  <span className="w-5 shrink-0 text-right font-mono text-xs text-[var(--color-text-secondary)]">{i + 1}.</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-medium text-[var(--color-text-primary)]">{nodeName(source)}</span>
                    <ArrowRight size={13} className="shrink-0 text-[var(--color-text-secondary)]" />
                    <span className="font-medium text-[var(--color-text-primary)]">{nodeName(target)}</span>
                    {e.label && <span className="text-xs text-[var(--color-text-secondary)]">— {e.label}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {isolated.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
            <Unplug size={13} className="mt-0.5 shrink-0" />
            Not on the request path: {isolated.map((n) => nodeName(n)).join(', ')} (supporting services with no drawn connection).
          </p>
        )}
      </section>

      {/* 2 — services & configuration */}
      <section>
        <SectionHeading icon={<Settings2 size={13} />}>Services & configuration</SectionHeading>
        <ul className="space-y-2">
          {orderedNodes.map((n) => {
            const def = resolveServiceDef(n.serviceId, n);
            const container = n.containerId ? containers.get(n.containerId) : undefined;
            const containerLabel = container
              ? container.label || containerTypeById(container.type)?.label || container.type
              : null;
            const configEntries = def.fields
              .filter((f) => n.config[f.key] !== undefined && n.config[f.key] !== '')
              .map((f) => `${f.label}: ${n.config[f.key]}${f.unit ? ` ${f.unit}` : ''}`);
            return (
              <li key={n.nodeId} className="flex items-start gap-3 rounded-2xl border border-[var(--color-surface-variant)] p-3">
                <ServiceIcon def={def} size={34} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">{nodeName(n)}</span>
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {def.category} · {formatUSD(n.cost)}/mo
                      {containerLabel ? ` · inside ${containerLabel}` : ''}
                    </span>
                  </div>
                  {roleFor(nodeName(n)) && (
                    <p className="mt-1 text-xs leading-snug text-[var(--color-text-secondary)]">{roleFor(nodeName(n))}</p>
                  )}
                  {configEntries.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {configEntries.map((c) => (
                        <span key={c} className="rounded-lg bg-[var(--color-surface-container-low)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3 — AI improvements: prioritized, actionable recommendations */}
      {developerReport && developerReport.improvements.length > 0 && (
        <section>
          <SectionHeading icon={<Lightbulb size={13} />}>What can be improved</SectionHeading>
          <ul className="space-y-2">
            {developerReport.improvements.map((imp) => (
              <li key={imp.title} className="rounded-2xl border border-[var(--color-surface-variant)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[imp.priority] ?? PRIORITY_STYLE.low}`}>
                    {imp.priority}
                  </span>
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">{imp.title}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{imp.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4 — AI alternatives: other options worth considering */}
      {developerReport && developerReport.alternatives.length > 0 && (
        <section>
          <SectionHeading icon={<GitBranch size={13} />}>Other options to consider</SectionHeading>
          <ul className="space-y-2">
            {developerReport.alternatives.map((alt) => (
              <li key={alt.title} className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{alt.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{alt.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5 — AI design guidance (persisted with the architecture) */}
      {guidanceEntries.length > 0 && (
        <section>
          <SectionHeading icon={<ShieldCheck size={13} />}>Design guidance</SectionHeading>
          <dl className="space-y-2.5">
            {guidanceEntries.map((g) => (
              <div key={g.key} className="rounded-2xl bg-[var(--color-surface-container-low)] p-3">
                <dt className="text-xs font-semibold text-[var(--color-text-primary)]">{g.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{g.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
