'use client';
import { useMemo, useState } from 'react';
import { MiniMap, useReactFlow, useStore, type Node } from '@xyflow/react';
import { Search, Map as MapIcon, X } from 'lucide-react';
import { resolveServiceDef } from '@/lib/catalog';
import type { ServiceNodeData } from '@/lib/canvas/model';

/**
 * Navigation: official MiniMap (toggleable) + a find box over service display /
 * catalog names (002 FR-015, research R5). Enter centers and highlights via the
 * official `setCenter`.
 */
export function MiniMapPanel() {
  const [showMap, setShowMap] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { setCenter, setNodes } = useReactFlow();
  const nodes = useStore((s) => s.nodes) as Node[];

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => n.type === 'service')
      .map((n) => {
        const d = n.data as ServiceNodeData;
        const catalogName = resolveServiceDef(d.serviceId, d).name;
        const name = d.displayName || catalogName;
        return { id: n.id, name, catalogName, node: n };
      })
      .filter((r) => r.name.toLowerCase().includes(q) || r.catalogName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [nodes, query]);

  const goTo = (n: Node) => {
    const w = n.measured?.width ?? n.width ?? 188;
    const h = n.measured?.height ?? n.height ?? 88;
    setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1, duration: 300 });
    setNodes((nds) => nds.map((x) => ({ ...x, selected: x.id === n.id })));
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      <div className="relative">
        {open && (
          <div className="absolute bottom-10 right-0 w-56 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
            <div className="flex items-center gap-1.5 px-1.5 py-1">
              <Search size={13} className="shrink-0 text-[var(--color-text-secondary)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results[0]) goTo(results[0].node);
                  if (e.key === 'Escape') setOpen(false);
                }}
                placeholder="Find a service…"
                aria-label="Find a service by name"
                className="w-full bg-transparent text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            {results.length > 0 && (
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => goTo(r.node)}
                      className="flex w-full flex-col rounded-xl px-2.5 py-1.5 text-left hover:bg-[var(--color-surface-container-low)]"
                    >
                      <span className="truncate text-xs font-medium text-[var(--color-text-primary)]">{r.name}</span>
                      {r.name !== r.catalogName && (
                        <span className="truncate text-[10px] text-[var(--color-text-secondary)]">{r.catalogName}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          aria-label={open ? 'Close find' : 'Find a service'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] shadow-sm hover:text-[var(--color-text-primary)]"
        >
          {open ? <X size={15} /> : <Search size={15} />}
        </button>
      </div>

      <button
        aria-label={showMap ? 'Hide minimap' : 'Show minimap'}
        aria-pressed={showMap}
        onClick={() => setShowMap((s) => !s)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] shadow-sm hover:text-[var(--color-text-primary)]"
      >
        <MapIcon size={15} />
      </button>

      {showMap && (
        <MiniMap
          pannable
          zoomable
          className="!static !m-0 !rounded-xl !border !border-[var(--color-surface-variant)]"
          nodeColor={(n) => {
            if (n.type === 'service') {
              const d = n.data as ServiceNodeData;
              return resolveServiceDef(d.serviceId, d).accent;
            }
            return '#5f6368';
          }}
          maskColor="rgba(0,0,0,0.05)"
        />
      )}
    </div>
  );
}
