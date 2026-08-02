import Link from 'next/link';
import { ArrowUpRight, Boxes } from 'lucide-react';
import { StatusDot } from '@/components/ui/Badge';
import { PROVIDERS, formatUSD } from '@/lib/catalog';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  providers: ('aws' | 'mongodb' | 'system')[];
  services: number;
  monthly: number;
  updated: string;
  status: 'draft' | 'active' | 'archived';
}

function ProviderChips({ providers }: { providers: ProjectSummary['providers'] }) {
  return (
    <div className="flex items-center gap-1.5">
      {providers.map((p) => (
        <span
          key={p}
          title={PROVIDERS[p].label}
          className="flex h-6 items-center gap-1 rounded-full border border-[var(--color-outline-variant)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)]"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: PROVIDERS[p].accent }} />
          {PROVIDERS[p].label.replace(' Atlas', '')}
        </span>
      ))}
    </div>
  );
}

const statusTone = {
  active: 'success',
  draft: 'idle',
  archived: 'warning',
} as const;

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/studio?project=${project.id}`}
      className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary-fixed-dim)] hover:shadow-md"
    >
      <div>
        <div className="mb-4 flex items-start justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]">
            <Boxes size={22} />
          </div>
          <div className="flex items-center gap-2">
            <StatusDot tone={statusTone[project.status]} />
            <span className="text-xs capitalize text-[var(--color-text-secondary)]">{project.status}</span>
          </div>
        </div>

        <h3 className="flex items-center gap-1 font-[family-name:var(--font-headline-sm)] text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
          {project.name}
          <ArrowUpRight
            size={17}
            className="translate-y-0.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
          />
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-text-secondary)]">{project.description}</p>
      </div>

      <div className="mt-5 flex items-end justify-between border-t border-[var(--color-surface-variant)] pt-4">
        <div className="flex flex-col gap-2">
          <ProviderChips providers={project.providers} />
          <span className="text-xs text-[var(--color-text-secondary)]">
            {project.services} services · {project.updated}
          </span>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold leading-none text-[var(--color-text-primary)]">
            {formatUSD(project.monthly)}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">/ month</p>
        </div>
      </div>
    </Link>
  );
}

export { ProviderChips };
