'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Download, Sparkles, PanelRight, X, MessageSquare, Save, Loader2, TriangleAlert, RotateCcw,
  Blocks, Route, History, Upload, MessagesSquare, FileText, LayoutTemplate,
} from 'lucide-react';
import { Canvas, type CanvasApi, type CanvasStats } from '@/components/studio/Canvas';
import { Inspector, type CanvasNode } from '@/components/studio/Inspector';
import { CostPanel } from '@/components/studio/CostPanel';
import { ChatPanel, type ChatArchitecture } from '@/components/studio/ChatPanel';
import { Palette } from '@/components/studio/Palette';
import { ExplainFlow } from '@/components/studio/ExplainFlow';
import { HistoryPanel, type VersionEntry, type VersionSnapshotDoc } from '@/components/studio/HistoryPanel';
import { ImportDialog } from '@/components/studio/ImportDialog';
import { CommentsPanel } from '@/components/studio/CommentsPanel';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatUSD, resolveServiceDef } from '@/lib/catalog';
import { toMermaid, toJsonDocument, type ExportNode, type ExportEdge } from '@/lib/export/serialize';
import { toTerraform } from '@/lib/export/terraform';
import { DIAGRAM_TEMPLATES } from '@/lib/canvas/templates';
import type { ArchDocument } from '@/lib/canvas/model';
import { focusBounds } from '@/lib/canvas/capture';
import { cn } from '@/lib/cn';

/**
 * Studio page (001 US2/US3, extended by feature 002): hosts the Canvas (which
 * owns all node/edge/container/annotation state), the persistence lifecycle
 * (load/save/version-conflict), live pricing display, the AI chat panel, export,
 * and the service Inspector. Canvas is a black box accessed via `CanvasApi`.
 */

interface ApiDocument {
  nodes: ArchDocument['nodes'];
  edges: ArchDocument['edges'];
  containers?: ArchDocument['containers'];
  annotations?: ArchDocument['annotations'];
  /** Lucid-parity conditional-formatting rules; absent on chat payloads (carried forward client-side) */
  formatRules?: ArchDocument['formatRules'];
  guidance?: Record<string, string>;
  version: number;
}

function toArchDocument(data: ApiDocument): ArchDocument {
  return {
    nodes: data.nodes,
    edges: data.edges,
    containers: data.containers ?? [],
    annotations: data.annotations ?? [],
    ...(data.formatRules ? { formatRules: data.formatRules } : {}),
  };
}

function StudioInner() {
  const params = useSearchParams();
  const projectId = params.get('project');
  const canvasRef = useRef<CanvasApi>(null);

  const [showChat, setShowChat] = useState(Boolean(projectId));
  const [showInspector, setShowInspector] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  // Estimation lives in a popup now (toolbar cost button); the diagram + chat
  // are the only persistent sections.
  const [estimateOpen, setEstimateOpen] = useState(false);
  // Set when a service node is clicked on the canvas — the popup opens with
  // that service's pricing editor expanded.
  const [estimateFocus, setEstimateFocus] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainDoc, setExplainDoc] = useState<ArchDocument | null>(null);
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  // 007 1.1 — version history: panel visibility + active preview (non-null =
  // the canvas is showing an old snapshot; saving is disabled until exit).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<number | null>(null);
  // 007 1.2 — import dialog (JSON round-trip / Mermaid paste).
  const [importOpen, setImportOpen] = useState(false);
  // Lucid-parity templates gallery — start from a curated diagram.
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // 007 2.2 — comment threads panel.
  const [showComments, setShowComments] = useState(false);

  const [version, setVersion] = useState(0);
  const [loadingProject, setLoadingProject] = useState(Boolean(projectId));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [chatRefresh, setChatRefresh] = useState(0);

  const [stats, setStats] = useState<CanvasStats>({ services: 0, connections: 0, totalCost: 0, basis: 'indicative' });
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [allNodes, setAllNodes] = useState<CanvasNode[]>([]);

  const loadArchitecture = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/architecture`);
    if (!res.ok) return;
    const data = await res.json();
    canvasRef.current?.loadDocument(toArchDocument(data.architecture));
    setVersion(data.architecture.version);
    setGuidance(data.architecture.guidance ?? {});
    setDirty(false);
    setConflict(false);
    setTimeout(() => canvasRef.current?.fitView(), 60);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      loadArchitecture().finally(() => setLoadingProject(false));
    }, 0);
    return () => clearTimeout(t);
  }, [projectId, loadArchitecture]);

  const markDirty = useCallback(() => setDirty(true), []);

  // 007 1.1 — preview an old version on the canvas (read-back only: Save is
  // disabled while previewing; Exit reloads the latest persisted version).
  const onHistoryPreview = useCallback((entry: VersionEntry, snapshot: VersionSnapshotDoc) => {
    canvasRef.current?.loadDocument(
      toArchDocument({
        nodes: snapshot.nodes as ArchDocument['nodes'],
        edges: snapshot.edges as ArchDocument['edges'],
        containers: snapshot.containers as ArchDocument['containers'],
        annotations: snapshot.annotations as ArchDocument['annotations'],
        version: entry.version,
      })
    );
    setPreviewingVersion(entry.version);
    setDirty(false);
    setTimeout(() => canvasRef.current?.fitView(), 60);
  }, []);

  const exitHistoryPreview = useCallback(() => {
    setPreviewingVersion(null);
    void loadArchitecture();
  }, [loadArchitecture]);

  const onHistoryRestored = useCallback(() => {
    setPreviewingVersion(null);
    void loadArchitecture();
    // The restore appended a system message to the thread — refetch it.
    setChatRefresh((k) => k + 1);
  }, [loadArchitecture]);

  // 007 1.2 — import replaces the canvas; the user persists it with Save.
  // Mermaid sources carry no geometry, so those get an ELK arrange pass.
  const onImportDocument = useCallback((doc: ArchDocument, arrange: boolean) => {
    setPreviewingVersion(null);
    canvasRef.current?.loadDocument(doc);
    setDirty(true);
    if (arrange) setTimeout(() => canvasRef.current?.autoArrange(), 80);
    setTimeout(() => canvasRef.current?.fitView(), arrange ? 500 : 60);
  }, []);

  // T032: save with optimistic concurrency; 409 → conflict banner (reload wins).
  const save = useCallback(async () => {
    if (!projectId || saving || !canvasRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const doc = canvasRef.current.getDocument();
      const res = await fetch(`/api/projects/${projectId}/architecture`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // No Architecture doc yet → version state is 0, but the schema wants a
        // positive int; the server ignores it for the first upsert.
        body: JSON.stringify({ ...doc, version: version === 0 ? 1 : version }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (!res.ok) {
        setSaveError(data.error ?? (data.details ? JSON.stringify(data.details) : 'Save failed.'));
        return;
      }
      setVersion(data.version);
      setDirty(false);
      // FR-016a: the save appended a system message to the thread — refetch it.
      setChatRefresh((k) => k + 1);
    } catch {
      setSaveError('Could not reach the server. Your changes are still on the canvas.');
    } finally {
      setSaving(false);
    }
  }, [projectId, saving, version]);

  // Chat turns persist server-side; mirror the result onto the canvas (US2/AC5).
  // formatRules are canvas-owned (the AI never edits them, and the chat persist
  // path never writes them server-side) — carry the current rules forward so a
  // turn doesn't visually clear them.
  const onChatArchitecture = useCallback((arch: ChatArchitecture) => {
    const existing = canvasRef.current?.getDocument();
    canvasRef.current?.loadDocument(
      toArchDocument({
        nodes: arch.nodes as ArchDocument['nodes'],
        edges: arch.edges as ArchDocument['edges'],
        containers: arch.containers as ArchDocument['containers'] | undefined,
        annotations: arch.annotations as ArchDocument['annotations'] | undefined,
        formatRules: existing?.formatRules,
        version: arch.version,
      })
    );
    setVersion(arch.version);
    setGuidance((arch.guidance as Record<string, string>) ?? {});
    setDirty(false);
    setTimeout(() => canvasRef.current?.fitView(), 60);
  }, []);

  // 005 FR-001/002 — mid-turn progressive build-up: paint each chunk onto the
  // canvas as it's applied, without touching version/dirty (nothing is
  // persisted yet — that happens once, at turn end, via onChatArchitecture
  // above). Annotations are never part of a diagram snapshot (the AI never
  // touches them) — carry over whatever is already on the canvas.
  const onChatDiagram = useCallback((nodes: unknown[], edges: unknown[], containers: unknown[]) => {
    const existing = canvasRef.current?.getDocument();
    canvasRef.current?.loadDocument(
      toArchDocument({
        nodes: nodes as ArchDocument['nodes'],
        edges: edges as ArchDocument['edges'],
        containers: containers as ArchDocument['containers'],
        annotations: existing?.annotations,
        formatRules: existing?.formatRules,
        version: 0,
      })
    );
  }, []);

  const displayBasis = stats.services === 0 ? 'indicative' : stats.basis;

  // --- Export (US7, FR-024; extended 002 FR-007/SC-005): PNG/PDF client-rendered,
  // Mermaid/JSON serialized; every project export is audited via the export API.
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const download = (content: string | Blob, filename: string, mimeType: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Render the current canvas to a PNG data URL (react-flow viewport capture).
   * With `focusIds`, the capture crops to the region around those nodes and
   * dims everything else (containers stay visible for orientation) — this is
   * what puts the matching diagram section next to each client-report step.
   */
  const canvasToPng = useCallback(async (focusIds?: string[]): Promise<{ dataUrl: string; width: number; height: number }> => {
    const { toPng } = await import('html-to-image');
    const { getNodesBounds, getViewportForBounds } = await import('@xyflow/react');
    const wrapper = document.querySelector('.react-flow');
    const viewport = wrapper?.querySelector<HTMLElement>('.react-flow__viewport');
    const doc = canvasRef.current?.getDocument();
    if (!viewport || !doc || (doc.nodes.length === 0 && doc.containers.length === 0)) {
      throw new Error('Nothing to export yet.');
    }
    const focus = focusIds && focusIds.length > 0 ? focusBounds(doc, focusIds) : null;
    const bounds =
      focus ??
      getNodesBounds([
        ...doc.nodes.map((n) => ({ id: n.nodeId, position: n.position, width: 188, height: 88, data: {} })),
        ...doc.containers.map((c) => ({ id: c.containerId, position: c.position, width: c.size.width, height: c.size.height, data: {} })),
      ]);
    const width = focus
      ? Math.min(1600, Math.max(480, Math.ceil(bounds.width)))
      : Math.min(2048, Math.max(800, Math.ceil(bounds.width) + 160));
    const height = focus
      ? Math.min(1200, Math.max(340, Math.ceil(bounds.height)))
      : Math.min(2048, Math.max(600, Math.ceil(bounds.height) + 160));
    const vp = getViewportForBounds(bounds, width, height, 0.4, focus ? 1.6 : 2, 0.1);

    // Dim out-of-step elements via inline style (restored in `finally`) — the
    // DOM clone html-to-image captures picks the dimming up without touching
    // React state or re-rendering the canvas.
    const dimmed: { el: HTMLElement; prev: string }[] = [];
    if (focus) {
      const focusSet = new Set(focusIds);
      const containerIds = new Set(doc.containers.map((c) => c.containerId));
      const dimEdgeIds = new Set(
        doc.edges.filter((e) => !(focusSet.has(e.source) && focusSet.has(e.target))).map((e) => e.edgeId)
      );
      for (const el of wrapper!.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = el.getAttribute('data-id') ?? '';
        if (!focusSet.has(id) && !containerIds.has(id)) dimmed.push({ el, prev: el.style.opacity });
      }
      for (const el of wrapper!.querySelectorAll<HTMLElement>('.react-flow__edge')) {
        const id = el.getAttribute('data-id') ?? '';
        if (dimEdgeIds.has(id)) dimmed.push({ el, prev: el.style.opacity });
      }
      for (const d of dimmed) d.el.style.opacity = '0.18';
    }
    try {
      const dataUrl = await toPng(viewport, {
        width,
        height,
        backgroundColor: '#ffffff',
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      });
      return { dataUrl, width, height };
    } finally {
      for (const d of dimmed) d.el.style.opacity = d.prev;
    }
  }, []);

  const runExport = useCallback(
    async (format: 'png' | 'pdf' | 'mermaid' | 'json' | 'terraform' | 'estimate' | 'report' | 'report-client') => {
      if (!canvasRef.current) return;
      setExporting(true);
      setExportOpen(false);
      setSaveError(null);
      try {
        // 'report-client' is a front-end-only dispatch token — the audited
        // artifact is still 'report' (Export.ts's format enum), with the
        // variant recorded via the reportType query param.
        const api = projectId
          ? await fetch(
              `/api/projects/${projectId}/export?format=${format === 'report-client' ? 'report' : format}${format === 'report-client' ? '&reportType=client' : ''}`
            ).then((r) => (r.ok ? r.json() : null))
          : null;
        const name = api?.name ?? 'architecture';

        if (format === 'estimate') {
          // 003 US4/FR-016: standalone cost proposal — server-serialized from the
          // estimate + overrides only, rendered as a PDF; no diagram content.
          if (!api?.content) throw new Error('Open a saved project to export its cost estimate.');
          const est = api.content as {
            projectName: string; generatedAt: string; monthly: number; annual: number;
            basis: string;
            lineItems: { displayName: string; cost: number; basis: string; overridden: boolean; overrideSource?: string; stale: boolean }[];
          };
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
          pdf.setFontSize(16);
          pdf.text(`Cost proposal — ${est.projectName}`, 40, 48);
          pdf.setFontSize(9);
          pdf.text(`Generated ${new Date(est.generatedAt).toLocaleString()} · figures in USD`, 40, 64);
          let y = 96;
          pdf.setFontSize(11);
          for (const line of est.lineItems) {
            const marks = [
              line.overridden ? `manual${line.overrideSource === 'chat' ? ' (chat)' : ''}` : null,
              line.stale ? 'needs confirmation' : null,
              line.basis === 'indicative' && !line.overridden ? 'indicative' : null,
            ].filter(Boolean).join(', ');
            pdf.text(`${line.displayName}${marks ? `  [${marks}]` : ''}`, 40, y);
            pdf.text(`${formatUSD(line.cost)}/mo`, 555, y, { align: 'right' });
            y += 18;
            if (y > 760) { pdf.addPage(); y = 48; }
          }
          y += 10;
          pdf.setLineWidth(0.5);
          pdf.line(40, y - 14, 555, y - 14);
          pdf.setFontSize(12);
          pdf.text('Total', 40, y);
          pdf.text(`${formatUSD(est.monthly)}/mo · ${formatUSD(est.annual)}/yr`, 555, y, { align: 'right' });
          pdf.setFontSize(8);
          pdf.text('Lines marked "manual" carry user-set values; "needs confirmation" flags a manual value whose service configuration changed since it was set.', 40, y + 20, { maxWidth: 515 });
          pdf.save(api.filename?.replace(/\.json$/, '.pdf') ?? 'estimate.pdf');
          return;
        }

        if (format === 'report') {
          // Diagram + full AI report: cached per architecture version server-side
          // (the Explain popup shares the same analysis), composed into a
          // multi-page PDF client-side like the estimate export.
          const repRes = await fetch(`/api/projects/${projectId}/report`);
          const repData = await repRes.json();
          if (!repRes.ok) throw new Error(repData.error ?? 'Could not generate the report.');
          const report = repData.report as {
            overview: string;
            howItWorks: string;
            services: { name: string; role: string }[];
            improvements: { title: string; detail: string; priority: string }[];
            alternatives: { title: string; detail: string }[];
            degraded: boolean;
          };
          const docNow = canvasRef.current.getDocument();
          const { dataUrl, width, height } = await canvasToPng();
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
          let y = 48;
          const ensure = (needed = 16) => {
            if (y + needed > 800) {
              pdf.addPage();
              y = 48;
            }
          };
          const heading = (t: string) => {
            ensure(40);
            y += 10;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            pdf.text(t, 40, y);
            y += 18;
            pdf.setFont('helvetica', 'normal');
          };
          const para = (t: string, size = 10) => {
            pdf.setFontSize(size);
            for (const line of pdf.splitTextToSize(t, 515) as string[]) {
              ensure(size * 1.4);
              pdf.text(line, 40, y);
              y += size * 1.4;
            }
          };

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(18);
          pdf.text(`Architecture report — ${name}`, 40, y);
          y += 20;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.text(
            `Generated ${new Date().toLocaleString()} · ${stats.services} services · estimated ${formatUSD(stats.totalCost)}/month (${stats.basis})`,
            40,
            y
          );
          y += 16;

          const scale = Math.min(515 / width, 300 / height);
          ensure(height * scale + 10);
          pdf.addImage(dataUrl, 'PNG', 40, y, width * scale, height * scale);
          y += height * scale + 6;

          heading('How this architecture serves the request');
          para(report.overview);
          heading('How it works');
          para(report.howItWorks);

          if (report.services.length > 0) {
            heading('Services & their roles');
            for (const s of report.services) para(`• ${s.name} — ${s.role}`);
          }

          if (docNow.edges.length > 0) {
            heading('Connections');
            const names = new Map(
              docNow.nodes.map((n) => [n.nodeId, n.displayName || resolveServiceDef(n.serviceId, n).name] as const)
            );
            for (const e of docNow.edges) {
              para(`• ${names.get(e.source) ?? e.source} -> ${names.get(e.target) ?? e.target}${e.label ? ` (${e.label})` : ''}`);
            }
          }

          heading('Configuration snapshot');
          for (const n of docNow.nodes) {
            const def = resolveServiceDef(n.serviceId, n);
            const cfg = Object.entries(n.config ?? {})
              .map(([k, v]) => `${k}=${v}`)
              .join(', ');
            para(`• ${n.displayName || def.name} (${def.category}) — ${formatUSD(n.cost)}/mo${cfg ? ` · ${cfg}` : ''}`);
          }

          if (report.improvements.length > 0) {
            heading('What can be improved');
            for (const imp of report.improvements) para(`• [${imp.priority.toUpperCase()}] ${imp.title} — ${imp.detail}`);
          }
          if (report.alternatives.length > 0) {
            heading('Other options to consider');
            for (const alt of report.alternatives) para(`• ${alt.title} — ${alt.detail}`);
          }
          const guidanceEntries = Object.entries(guidance).filter(([, v]) => v?.trim());
          if (guidanceEntries.length > 0) {
            heading('Design guidance');
            for (const [k, v] of guidanceEntries) para(`• ${k}: ${v}`);
          }
          y += 8;
          ensure(24);
          pdf.setFontSize(8);
          pdf.text(
            report.degraded
              ? 'AI analysis was unavailable when this report was generated; sections above are diagram-derived facts.'
              : 'Costs are indicative estimates. AI-generated analysis — review recommendations before acting.',
            40,
            y,
            { maxWidth: 515 }
          );
          pdf.save(`${name}-report.pdf`);
          return;
        }

        if (format === 'report-client') {
          // Diagram + client-proposal report: same cached-per-version analysis
          // endpoint as 'report', business-framed variant (reportType=client).
          const repRes = await fetch(`/api/projects/${projectId}/report?reportType=client`);
          const repData = await repRes.json();
          if (!repRes.ok) throw new Error(repData.error ?? 'Could not generate the proposal.');
          const report = repData.report as {
            executiveSummary: string;
            businessValue: { title: string; detail: string }[];
            investmentSummary: { monthly: number; annual: number; basis: string; highlights: string[] };
            reliabilityAndSecurity: string;
            scalabilityStory: string;
            recommendations: { title: string; detail: string }[];
            degraded: boolean;
          };
          const { dataUrl, width, height } = await canvasToPng();
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
          let y = 48;
          const ensure = (needed = 16) => {
            if (y + needed > 800) {
              pdf.addPage();
              y = 48;
            }
          };
          const heading = (t: string) => {
            ensure(40);
            y += 10;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            pdf.text(t, 40, y);
            y += 18;
            pdf.setFont('helvetica', 'normal');
          };
          const para = (t: string, size = 10) => {
            pdf.setFontSize(size);
            for (const line of pdf.splitTextToSize(t, 515) as string[]) {
              ensure(size * 1.4);
              pdf.text(line, 40, y);
              y += size * 1.4;
            }
          };

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(18);
          pdf.text(`Solution proposal — ${name}`, 40, y);
          y += 20;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.text(`Prepared ${new Date().toLocaleString()}`, 40, y);
          y += 16;

          const scale = Math.min(515 / width, 300 / height);
          ensure(height * scale + 10);
          pdf.addImage(dataUrl, 'PNG', 40, y, width * scale, height * scale);
          y += height * scale + 6;

          heading('Executive summary');
          para(report.executiveSummary);

          if (report.businessValue.length > 0) {
            heading('Business value');
            for (const v of report.businessValue) para(`• ${v.title} — ${v.detail}`);
          }

          heading('Investment summary');
          para(`${formatUSD(report.investmentSummary.monthly)}/mo · ${formatUSD(report.investmentSummary.annual)}/yr (${report.investmentSummary.basis})`, 11);
          for (const h of report.investmentSummary.highlights) para(`• ${h}`);

          heading('Reliability & security');
          para(report.reliabilityAndSecurity);
          heading('Scalability');
          para(report.scalabilityStory);

          if (report.recommendations.length > 0) {
            heading('Recommendations');
            for (const r of report.recommendations) para(`• ${r.title} — ${r.detail}`);
          }
          y += 8;
          ensure(24);
          pdf.setFontSize(8);
          pdf.text(
            report.degraded
              ? 'AI analysis was unavailable when this proposal was generated; sections above are limited.'
              : 'Figures reflect the current cost estimate. Prepared for discussion purposes.',
            40,
            y,
            { maxWidth: 515 }
          );
          pdf.save(`${name}-proposal.pdf`);
          return;
        }
        const doc = canvasRef.current.getDocument();
        const exportNodes: ExportNode[] = doc.nodes.map((n) => ({
          nodeId: n.nodeId, serviceId: n.serviceId, provider: n.provider, category: n.category,
          config: n.config, cost: n.cost, position: n.position,
        }));
        const exportEdges: ExportEdge[] = doc.edges.map((e) => ({ source: e.source, target: e.target, label: e.label }));

        if (format === 'terraform') {
          const content =
            api?.content ??
            toTerraform({ name, nodes: exportNodes, edges: exportEdges, containers: doc.containers });
          download(content, api?.filename ?? `${name}.tf`, 'text/plain');
        } else if (format === 'mermaid') {
          const content = api?.content ?? toMermaid(name, exportNodes, exportEdges, doc.containers);
          download(content, api?.filename ?? `${name}.mmd`, 'text/vnd.mermaid');
        } else if (format === 'json') {
          const content =
            api?.content ??
            toJsonDocument({
              name,
              nodes: exportNodes,
              edges: exportEdges,
              containers: doc.containers,
              annotations: doc.annotations,
              estimateMonthly: stats.totalCost,
            });
          download(content, api?.filename ?? `${name}.json`, 'application/json');
        } else if (format === 'png') {
          const { dataUrl } = await canvasToPng();
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${name}.png`;
          a.click();
        } else {
          const { dataUrl, width, height } = await canvasToPng();
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          pdf.setFontSize(14);
          pdf.text(name, 40, 40);
          pdf.setFontSize(10);
          pdf.text(`${stats.services} services · estimated ${formatUSD(stats.totalCost)}/month (${stats.basis})`, 40, 58);
          const scale = Math.min((pageW - 80) / width, (pageH - 110) / height);
          pdf.addImage(dataUrl, 'PNG', 40, 72, width * scale, height * scale);
          pdf.save(`${name}.pdf`);
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Export failed.');
      } finally {
        setExporting(false);
      }
    },
    [projectId, stats, canvasToPng, guidance]
  );

  // --- Client report (separate button, not an Export-menu entry): a step-by-
  // step walkthrough PDF where every step embeds the diagram section it
  // explains (cropped + out-of-step services dimmed). Narrative comes from the
  // walkthrough report (cached per version server-side); images are captured
  // client-side from the live canvas, one crop per step.
  const [reportBusy, setReportBusy] = useState(false);
  const runClientReport = useCallback(async () => {
    if (!canvasRef.current || !projectId) return;
    setReportBusy(true);
    setSaveError(null);
    try {
      // Audited like every project export ('report' artifact, walkthrough variant).
      const api = await fetch(`/api/projects/${projectId}/export?format=report&reportType=walkthrough`).then((r) =>
        r.ok ? r.json() : null
      );
      const name = api?.name ?? 'architecture';

      const repRes = await fetch(`/api/projects/${projectId}/report?reportType=walkthrough`);
      const repData = await repRes.json();
      if (!repRes.ok) throw new Error(repData.error ?? 'Could not generate the client report.');
      const report = repData.report as {
        introduction: string;
        steps: { title: string; explanation: string; nodeIds: string[] }[];
        conclusion: string;
        degraded: boolean;
      };

      const full = await canvasToPng();
      // Sequential on purpose: each capture dims/restores the live DOM.
      const stepShots: { dataUrl: string; width: number; height: number }[] = [];
      for (const step of report.steps) stepShots.push(await canvasToPng(step.nodeIds));

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      let y = 48;
      const ensure = (needed = 16) => {
        if (y + needed > 800) {
          pdf.addPage();
          y = 48;
        }
      };
      const heading = (t: string, size = 13) => {
        ensure(40);
        y += 10;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(size);
        pdf.text(t, 40, y);
        y += size + 5;
        pdf.setFont('helvetica', 'normal');
      };
      const para = (t: string, size = 10) => {
        pdf.setFontSize(size);
        for (const line of pdf.splitTextToSize(t, 515) as string[]) {
          ensure(size * 1.4);
          pdf.text(line, 40, y);
          y += size * 1.4;
        }
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text(`Solution walkthrough — ${name}`, 40, y);
      y += 20;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(
        `Prepared ${new Date().toLocaleString()} · ${stats.services} services · estimated ${formatUSD(stats.totalCost)}/month (${displayBasis})`,
        40,
        y
      );
      y += 16;

      if (report.introduction) {
        heading('Overview');
        para(report.introduction);
      }

      heading('The complete architecture');
      const fullScale = Math.min(515 / full.width, 320 / full.height);
      ensure(full.height * fullScale + 10);
      pdf.addImage(full.dataUrl, 'PNG', 40, y, full.width * fullScale, full.height * fullScale);
      y += full.height * fullScale + 6;

      report.steps.forEach((step, i) => {
        const shot = stepShots[i];
        const scale = Math.min(515 / shot.width, 240 / shot.height);
        const imgH = shot.height * scale;
        // Keep a step's title, first lines, and image on the same page.
        ensure(30 + 3 * 14 + imgH);
        heading(`Step ${i + 1} — ${step.title}`, 12);
        para(step.explanation);
        y += 4;
        ensure(imgH + 8);
        pdf.addImage(shot.dataUrl, 'PNG', 40, y, shot.width * scale, imgH);
        y += imgH + 10;
      });

      if (report.conclusion) {
        heading('Summary & next steps');
        para(report.conclusion);
      }
      y += 8;
      ensure(24);
      pdf.setFontSize(8);
      pdf.text(
        report.degraded
          ? 'AI narration was unavailable when this report was generated; the steps above are derived directly from the diagram.'
          : 'Costs are indicative estimates. AI-generated narrative — review before sharing externally.',
        40,
        y,
        { maxWidth: 515 }
      );
      pdf.save(`${name}-client-report.pdf`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Client report failed.');
    } finally {
      setReportBusy(false);
    }
  }, [projectId, stats, canvasToPng, displayBasis]);

  return (
    <div className="relative flex h-[calc(100dvh-10rem)] overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface)] shadow-sm sm:h-[calc(100dvh-11rem)] md:h-[calc(100vh-7.5rem)] lg:h-[calc(100vh-8.5rem)]">
      {/* Service palette — drag or click to add services to the canvas */}
      {showPalette && (
        <Palette
          className="hidden lg:flex"
          onAdd={(serviceId) => {
            canvasRef.current?.addService(serviceId);
            markDirty();
          }}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex h-14 items-center justify-between gap-2 border-b border-[var(--color-surface-variant)] px-2 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)] sm:flex">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <input
                defaultValue="Untitled architecture"
                className="w-full max-w-[9rem] truncate rounded-md bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none focus:bg-[var(--color-surface-container-low)] focus:px-2 sm:max-w-[14rem]"
              />
              <p className="truncate text-[11px] text-[var(--color-text-secondary)]">
                {stats.services} services · {stats.connections} connections
                {dirty && <span className="text-[var(--color-primary)]"> · unsaved</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                if (!projectId) return;
                setEstimateFocus(null);
                setEstimateOpen(true);
              }}
              disabled={!projectId}
              className={cn(
                'mr-1 hidden items-center gap-1.5 rounded-xl px-2 py-1 font-mono text-xs font-semibold text-[var(--color-text-primary)] transition-colors sm:flex',
                projectId ? 'cursor-pointer hover:bg-[var(--color-surface-container-low)]' : 'cursor-default'
              )}
              title={projectId ? 'Open the detailed cost estimate' : 'Estimation summary'}
              aria-label={`Estimation summary: ${formatUSD(stats.totalCost)} per month, ${formatUSD(stats.totalCost * 12)} per year${projectId ? ' — open details' : ''}`}
            >
              {formatUSD(stats.totalCost)}/mo
              <span className="font-normal text-[var(--color-text-secondary)]">· {formatUSD(stats.totalCost * 12)}/yr</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wide',
                  displayBasis === 'exact' ? 'bg-[#e6f4ea] text-[#1e8e3e]' : 'bg-[#fef7e0] text-[#7a5900]'
                )}
                title={displayBasis === 'exact' ? 'Priced via official sources' : 'Indicative estimate'}
              >
                {displayBasis}
              </span>
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExplainDoc(canvasRef.current?.getDocument() ?? null);
                setExplainOpen(true);
              }}
              disabled={stats.services === 0}
              title="Explain how a request flows through this architecture"
            >
              <Route size={15} /> <span className="hidden sm:inline">Explain</span>
            </Button>
            <Button
              variant={showPalette ? 'tonal' : 'ghost'}
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => setShowPalette((s) => !s)}
              aria-pressed={showPalette}
              title="Toggle the service palette"
            >
              <Blocks size={15} /> <span className="hidden xl:inline">Services</span>
            </Button>
            {projectId && (
              <>
                <Button variant={showChat ? 'tonal' : 'ghost'} size="sm" onClick={() => setShowChat((s) => !s)} aria-pressed={showChat}>
                  <MessageSquare size={15} /> <span className="hidden sm:inline">Chat</span>
                </Button>
                <Button variant="outline" size="sm" onClick={save} disabled={!dirty || saving || previewingVersion !== null}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} <span className="hidden sm:inline">Save</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} title="Version history">
                  <History size={15} /> <span className="hidden xl:inline">History</span>
                </Button>
                <Button
                  variant={showComments ? 'tonal' : 'outline'}
                  size="sm"
                  onClick={() => setShowComments((s) => !s)}
                  aria-pressed={showComments}
                  title="Comment threads"
                >
                  <MessagesSquare size={15} /> <span className="hidden xl:inline">Comments</span>
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Import a diagram (studio JSON or Mermaid)">
              <Upload size={15} /> <span className="hidden xl:inline">Import</span>
            </Button>
            {/* Lucid-parity templates gallery: replaces the canvas like an import — persisted on Save. */}
            <div className="relative">
              <Button
                variant={templatesOpen ? 'tonal' : 'outline'}
                size="sm"
                onClick={() => setTemplatesOpen((o) => !o)}
                aria-expanded={templatesOpen}
                title="Start from a template diagram"
              >
                <LayoutTemplate size={15} /> <span className="hidden xl:inline">Templates</span>
              </Button>
              {templatesOpen && (
                <>
                  <button type="button" aria-label="Close templates" className="fixed inset-0 z-20 cursor-default" onClick={() => setTemplatesOpen(false)} />
                  <div className="absolute right-0 top-10 z-30 w-80 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
                    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                      Start from a template
                    </p>
                    {DIAGRAM_TEMPLATES.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => {
                          setTemplatesOpen(false);
                          onImportDocument(JSON.parse(JSON.stringify(t.doc)) as ArchDocument, false);
                        }}
                        title="Loads the template onto the canvas — press Save to keep it"
                        className="w-full rounded-xl px-2.5 py-2 text-left hover:bg-[var(--color-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      >
                        <span className="block text-xs font-semibold text-[var(--color-text-primary)]">{t.title}</span>
                        <span className="block truncate text-[11px] text-[var(--color-text-secondary)]">{t.tagline}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-secondary)]">{t.services.join(' · ')}</span>
                      </button>
                    ))}
                    <p className="px-2.5 pb-1.5 pt-1 text-[10px] leading-snug text-[var(--color-text-secondary)]">
                      Replaces the current canvas — your previous state stays in version history after your next save.
                    </p>
                  </div>
                </>
              )}
            </div>
            {projectId && (
              <Button
                variant="outline"
                size="sm"
                onClick={runClientReport}
                disabled={reportBusy || exporting || stats.services === 0}
                title="Client report (PDF): step-by-step explanation, each step with the diagram section it covers"
              >
                {reportBusy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}{' '}
                <span className="hidden sm:inline">Client report</span>
              </Button>
            )}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen((o) => !o)}
                disabled={exporting || stats.services === 0}
                aria-expanded={exportOpen}
                aria-haspopup="menu"
              >
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} <span className="hidden sm:inline">Export</span>
              </Button>
              {exportOpen && (
                <div role="menu" className="absolute right-0 top-10 z-50 w-56 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
                  {(
                    [
                      ['png', 'PNG image'],
                      ['pdf', 'PDF — diagram only'],
                      ...(projectId
                        ? ([
                            ['report', 'PDF — diagram + full report'],
                            ['report-client', 'PDF — client proposal'],
                          ] as const)
                        : []),
                      ['mermaid', 'Mermaid diagram'],
                      ['json', 'JSON document'],
                      ['terraform', 'Terraform (.tf)'],
                      ...(projectId ? ([['estimate', 'Cost estimate (PDF)']] as const) : []),
                    ] as const
                  ).map(([fmt, label]) => (
                    <button
                      key={fmt}
                      role="menuitem"
                      onClick={() => runExport(fmt)}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-container-low)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => setShowInspector(true)}
              aria-label="Open configuration panel"
            >
              <PanelRight size={17} />
            </Button>
          </div>
        </div>

        {/* 007 1.1 — version-preview banner: the canvas shows an old snapshot. */}
        {previewingVersion !== null && (
          <div className="flex items-center gap-2 border-b border-[var(--color-outline-variant)] bg-[var(--color-secondary-container)]/50 px-4 py-2 text-xs text-[var(--color-on-secondary-container)]">
            <History size={14} className="shrink-0" />
            <span className="min-w-0 flex-1">
              Previewing version {previewingVersion} — this is a read-back of an earlier state; saving is disabled.
            </span>
            <button onClick={() => setHistoryOpen(true)} className="shrink-0 font-medium underline">
              Open history
            </button>
            <button onClick={exitHistoryPreview} className="shrink-0 font-medium underline">
              Exit preview
            </button>
          </div>
        )}

        {/* Conflict / error banners (T032 409 UX) */}
        {conflict && (
          <div className="flex items-center gap-2 border-b border-[#f2b8b5] bg-[#fcece9] px-4 py-2 text-xs text-[#8c1d18]">
            <TriangleAlert size={14} className="shrink-0" />
            <span className="min-w-0 flex-1">
              This project was updated elsewhere while you were editing. Reload the latest version to continue — your unsaved canvas
              changes will be replaced.
            </span>
            <button onClick={loadArchitecture} className="flex shrink-0 items-center gap-1 font-medium underline">
              <RotateCcw size={12} /> Reload latest
            </button>
            <button onClick={() => setConflict(false)} className="shrink-0 font-medium underline">
              Keep editing
            </button>
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2 border-b border-[#f2b8b5] bg-[#fcece9] px-4 py-2 text-xs text-[#8c1d18]">
            <TriangleAlert size={14} className="shrink-0" />
            <span className="min-w-0 flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="shrink-0 font-medium underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Canvas */}
        <div className="relative flex-1">
          <Canvas
            ref={canvasRef}
            onDirty={markDirty}
            onSelectionChange={(sel, all) => { setSelectedNode(sel); setAllNodes(all); }}
            onStats={setStats}
            onServiceOpen={(nodeId) => {
              if (!projectId) return;
              setEstimateFocus(nodeId);
              setEstimateOpen(true);
            }}
          />

          {loadingProject && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-[var(--color-surface-container-lowest)] px-4 py-2 text-xs text-[var(--color-text-secondary)] shadow-sm">
                <Loader2 size={13} className="animate-spin" /> Loading project…
              </span>
            </div>
          )}

          {stats.services === 0 && !loadingProject && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
                <Sparkles size={26} />
              </div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Start designing</p>
              <p className="max-w-xs text-xs text-[var(--color-text-secondary)]">
                Add a container or describe your system in the chat panel.
              </p>
            </div>
          )}

          {/* 007 2.2 — comment threads (anchored to the selected element or the project). */}
          {projectId && showComments && (
            <CommentsPanel
              projectId={projectId}
              onClose={() => setShowComments(false)}
              selection={
                selectedNode
                  ? {
                      id: selectedNode.id,
                      label: selectedNode.displayName || resolveServiceDef(selectedNode.serviceId, selectedNode).name,
                      kind: 'node',
                    }
                  : null
              }
              onJumpTo={(targetId) => canvasRef.current?.centerOnNode(targetId)}
            />
          )}
        </div>
      </div>

      {/* Chat: inline panel on lg+, overlay drawer below */}
      {projectId && showChat && (
        <>
          <button aria-label="Close chat panel" className="absolute inset-0 z-30 bg-black/25 lg:hidden" onClick={() => setShowChat(false)} />
          <div className="absolute inset-y-0 right-0 z-40 flex w-[420px] max-w-[85vw] flex-col border-l border-[var(--color-surface-variant)] bg-[var(--color-surface)] shadow-2xl lg:static lg:z-auto lg:shadow-none xl:w-[480px]">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-surface-variant)] px-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
                <MessageSquare size={13} /> AI Assistant
              </span>
              <button
                aria-label="Close chat panel"
                onClick={() => setShowChat(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
              >
                <X size={14} />
              </button>
            </div>
            <ChatPanel projectId={projectId} onArchitecture={onChatArchitecture} onDiagram={onChatDiagram} refreshKey={chatRefresh} className="min-h-0 flex-1" />
          </div>
        </>
      )}

      {/* Inspector: overlay drawer at every breakpoint — the diagram and chat
          are the only persistent sections; open it via the toolbar button. */}
      {showInspector && (
        <>
          <button aria-label="Close configuration panel" className="absolute inset-0 z-30 bg-black/25" onClick={() => setShowInspector(false)} />
          <div className="absolute inset-y-0 right-0 z-40 flex max-w-[85vw] shadow-2xl">
            <button
              aria-label="Close configuration panel"
              onClick={() => setShowInspector(false)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]"
            >
              <X size={16} />
            </button>
            <Inspector
              selected={selectedNode}
              nodes={allNodes}
              onConfigChange={(id, key, value) => {
                canvasRef.current?.updateNodeConfig(id, key, value);
                markDirty();
              }}
              onDelete={(id) => {
                canvasRef.current?.deleteNodeById(id);
                markDirty();
              }}
              onRename={(id, name) => {
                canvasRef.current?.renameNode(id, name);
                markDirty();
              }}
            />
          </div>
        </>
      )}

      {/* Detailed estimation popup (003 US3) — refetches after each save/chat turn. */}
      {projectId && (
        <Modal open={estimateOpen} onClose={() => setEstimateOpen(false)} title="Cost estimate" size="lg">
          <CostPanel
            projectId={projectId}
            refreshKey={version + chatRefresh}
            focusNodeId={estimateFocus}
            className="max-h-[60vh]"
          />
        </Modal>
      )}

      {/* Architecture explanation popup: request flow, connections, configuration. */}
      <Modal open={explainOpen} onClose={() => setExplainOpen(false)} title="Architecture explanation" size="xl">
        {explainDoc && <ExplainFlow doc={explainDoc} guidance={guidance} projectId={projectId ?? undefined} />}
      </Modal>

      {/* 007 1.2 — import (JSON round-trip / Mermaid). */}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={onImportDocument} />

      {/* 007 1.1 — version history (restore is owner-only; the server rejects others). */}
      {projectId && (
        <HistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={projectId}
          currentVersion={version}
          canRestore
          onPreview={onHistoryPreview}
          onRestored={onHistoryRestored}
        />
      )}
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="h-[calc(100dvh-10rem)] rounded-3xl bg-[var(--color-surface-container-low)] lg:h-[calc(100vh-8.5rem)]" />}>
      <ReactFlowProvider>
        <StudioInner />
      </ReactFlowProvider>
    </Suspense>
  );
}
