'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { ServiceIcon } from '@/components/ui/Icon';
import { SERVICES, PROVIDERS, type Provider } from '@/lib/catalog';
import { cn } from '@/lib/cn';

/** Left rail: searchable, provider-grouped, draggable service catalog. */
export function Palette({
  onAdd,
  className,
}: {
  onAdd: (serviceId: string) => void;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<Provider | 'all'>('all');

  const filtered = SERVICES.filter((s) => {
    const matchP = provider === 'all' || s.provider === provider;
    const matchQ =
      !q ||
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      s.category.toLowerCase().includes(q.toLowerCase());
    return matchP && matchQ;
  });

  return (
    <aside
      className={cn(
        'w-64 shrink-0 flex-col border-r border-[var(--color-surface-variant)] bg-[var(--color-surface)]',
        className ?? 'flex'
      )}
    >
      <div className="border-b border-[var(--color-surface-variant)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-[var(--color-text-secondary)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search services…"
            className="h-9 w-full rounded-xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] pl-9 pr-3 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25"
          />
        </div>
        <div className="mt-2 flex gap-1.5">
          {(['all', 'aws', 'mongodb', 'system'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={cn(
                'flex-1 rounded-lg px-2 py-1 text-xs font-medium capitalize transition-colors',
                provider === p
                  ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]'
              )}
            >
              {p === 'all' ? 'All' : PROVIDERS[p].label.replace(' Atlas', '').replace(' Design', '')}
            </button>
          ))}
        </div>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
        {filtered.map((s) => (
          <div
            key={s.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/service-id', s.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => onAdd(s.id)}
            title={s.blurb}
            className="group mb-1 flex cursor-grab items-center gap-2.5 rounded-xl border border-transparent p-2 transition-all hover:border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-container-low)] active:cursor-grabbing"
          >
            <ServiceIcon def={s} size={32} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{s.name}</p>
              <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{s.blurb}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-[var(--color-text-secondary)]">No services match.</p>
        )}
      </div>
      <p className="border-t border-[var(--color-surface-variant)] p-3 text-[11px] text-[var(--color-text-secondary)]">
        Drag onto the canvas, or click to add.
      </p>
    </aside>
  );
}
