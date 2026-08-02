'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, TriangleAlert, Sparkles } from 'lucide-react';
import { ServiceNode } from '@/components/studio/ServiceNode';
import { ContainerNode } from '@/components/studio/ContainerNode';
import { AnnotationNode } from '@/components/studio/AnnotationNode';
import { OrthogonalEdge } from '@/components/studio/OrthogonalEdge';
import { documentToFlow, type ArchDocument } from '@/lib/canvas/model';
import { formatUSD } from '@/lib/catalog';

/**
 * Public read-only share view (007 roadmap 1.3): /share/<token>, no account
 * needed — the unguessable token is the credential. `?embed=1` hides the
 * header chrome for iframe embedding. Strictly a viewer: no editing, no
 * saving, no chat, no cost internals beyond the headline estimate.
 */

const nodeTypes = { service: ServiceNode, container: ContainerNode, annotation: AnnotationNode };
const edgeTypes = { orthogonal: OrthogonalEdge };

interface SharePayload {
  name: string;
  description: string;
  estimateMonthly: number;
  architecture: ArchDocument & { guidance: Record<string, string> };
}

function ShareInner({ token }: { token: string }) {
  const params = useSearchParams();
  const embed = params.get('embed') === '1';
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/share/${token}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'This share link is invalid or was revoked.');
        setData(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this shared diagram.');
      }
    }, 0);
    return () => clearTimeout(t);
  }, [token]);

  const flow = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    if (!data) return { nodes: [], edges: [] };
    return documentToFlow(data.architecture);
  }, [data]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <TriangleAlert size={28} className="text-[var(--color-error)]" />
        <p className="max-w-md text-sm text-[var(--color-text-primary)]">{error}</p>
        <Link href="/login" className="text-xs font-medium text-[var(--color-primary)] underline">
          Go to Cloud Architecture Studio
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <Loader2 size={16} className="animate-spin" /> Loading shared diagram…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {!embed && (
        <header className="flex items-center gap-3 border-b border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-fixed)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-on-primary-fixed)]">
            <Sparkles size={11} /> Shared diagram
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{data.name}</h1>
            {data.description && <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{data.description}</p>}
          </div>
          {data.estimateMonthly > 0 && (
            <span className="shrink-0 font-mono text-xs font-semibold text-[var(--color-text-primary)]">
              ~{formatUSD(data.estimateMonthly)}<span className="text-[10px] font-normal text-[var(--color-text-secondary)]">/mo</span>
            </span>
          )}
          <span className="shrink-0 rounded-full border border-[var(--color-outline-variant)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
            Read-only
          </span>
        </header>
      )}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ReactFlowProvider>
        <ShareInner token={String(token)} />
      </ReactFlowProvider>
    </Suspense>
  );
}
