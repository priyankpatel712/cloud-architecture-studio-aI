'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, Plus, Boxes, Wallet, Activity, ArrowUpRight, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { ProjectCard, type ProjectSummary } from '@/components/ProjectCard';
import { formatUSD } from '@/lib/catalog';

/** Dashboard (US5/T040): live projects, live connection state, signed-in user. */

interface ApiProject {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  providers: ('aws' | 'mongodb' | 'system')[];
  services: number;
  monthly: number;
  owned: boolean;
  updatedAt: string;
}
interface ConnectionView {
  status: 'pending' | 'connected' | 'expired' | 'disconnected';
  alias: string | null;
  region: string | null;
  sessionExpiresAt: string | null;
  orgName: string | null;
  projectsCount: number;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function expiresIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [connections, setConnections] = useState<Partial<Record<'aws' | 'mongodb', ConnectionView>>>({});
  const [firstName, setFirstName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [projRes, connRes, meRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/connections'),
          fetch('/api/auth/me'),
        ]);
        if (projRes.ok) setProjects((await projRes.json()).projects);
        if (connRes.ok) setConnections((await connRes.json()).connections);
        if (meRes.ok) {
          const me = await meRes.json();
          setFirstName((me.user?.name ?? '').split(' ')[0] || null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalMonthly = projects.reduce((s, p) => s + p.monthly, 0);
  const totalServices = projects.reduce((s, p) => s + p.services, 0);
  const activeCount = projects.filter((p) => p.status === 'active').length;
  const aws = connections.aws;
  const atlas = connections.mongodb;

  const stats = [
    { label: 'Projected spend', value: formatUSD(totalMonthly), sub: '/ month', icon: Wallet },
    { label: 'Active projects', value: String(activeCount), sub: `of ${projects.length}`, icon: Activity },
    { label: 'Services designed', value: String(totalServices), sub: 'across clouds', icon: Boxes },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-rise">
      <PageHeader
        eyebrow="Studio overview"
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        subtitle="Design cloud architectures with official AWS and MongoDB integrations — from a sentence to a costed diagram."
        actions={
          <Button asChild size="lg">
            <Link href="/projects/new">
              <Sparkles size={18} /> Generate architecture
            </Link>
          </Button>
        }
      />

      {/* Stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">{s.label}</span>
              <s.icon size={18} className="text-[var(--color-primary)]" />
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                {loading ? '—' : s.value}
              </span>
              <span className="text-sm text-[var(--color-text-secondary)]">{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Recent projects */}
        <section className="col-span-12 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-headline-sm)] text-xl font-semibold text-[var(--color-text-primary)]">
              Recent projects
            </h2>
            <Link href="/projects" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link
              href="/projects/new"
              className="group flex min-h-[196px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[var(--color-outline-variant)] p-5 text-center transition-all hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-bright)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform group-hover:scale-110">
                <Plus size={24} />
              </div>
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">New architecture</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Describe it in plain English</p>
              </div>
            </Link>
            {loading ? (
              <div className="flex min-h-[196px] items-center justify-center rounded-3xl border border-[var(--color-surface-variant)]">
                <Loader2 size={18} className="animate-spin text-[var(--color-text-secondary)]" />
              </div>
            ) : (
              projects.slice(0, 3).map((p) => {
                const summary: ProjectSummary = {
                  id: p.id,
                  name: p.name,
                  description: p.description || 'No description yet.',
                  providers: p.providers,
                  services: p.services,
                  monthly: p.monthly,
                  updated: relativeTime(p.updatedAt),
                  status: p.status,
                };
                return <ProjectCard key={p.id} project={summary} />;
              })
            )}
          </div>
        </section>

        {/* Connections */}
        <aside className="col-span-12 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-headline-sm)] text-xl font-semibold text-[var(--color-text-primary)]">
              Connections
            </h2>
            <Link href="/connections" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
              Manage
            </Link>
          </div>
          <div className="space-y-3">
            <div className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF9900]/12 text-[#FF9900]">
                    <span className="text-lg font-bold">aws</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">AWS Account</p>
                    <p className="font-mono text-xs text-[var(--color-text-secondary)]">
                      {aws?.status === 'connected' || aws?.status === 'expired' ? (aws.alias ?? '—') : 'Not connected'}
                    </p>
                  </div>
                </div>
                {aws?.status === 'connected' ? (
                  <Badge variant="success" size="sm"><StatusDot tone="success" /> Live</Badge>
                ) : aws?.status === 'expired' ? (
                  <Badge variant="warning" size="sm"><StatusDot tone="warning" /> Expired</Badge>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/connections">Connect</Link>
                  </Button>
                )}
              </div>
              {(aws?.status === 'connected' || aws?.status === 'expired') && (
                <div className="mt-3 flex items-center justify-between border-t border-[var(--color-surface-variant)] pt-3 text-xs text-[var(--color-text-secondary)]">
                  <span className="font-mono">{aws.region ?? '—'}</span>
                  <span>
                    {aws.status === 'expired'
                      ? 'Session expired — reconnect'
                      : aws.sessionExpiresAt
                        ? `Session expires ${expiresIn(aws.sessionExpiresAt)}`
                        : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00ED64]/15 text-[#00b34a]">
                    <span className="text-lg font-bold">◍</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">MongoDB Atlas</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {atlas?.status === 'connected'
                        ? `${atlas.orgName ?? 'Organization'} · ${atlas.projectsCount} projects`
                        : 'Not configured'}
                    </p>
                  </div>
                </div>
                {atlas?.status === 'connected' ? (
                  <Badge variant="success" size="sm"><StatusDot tone="success" /> Live</Badge>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/connections">Connect</Link>
                  </Button>
                )}
              </div>
            </div>

            <Link
              href="/projects/new"
              className="group flex items-center justify-between rounded-3xl border border-[var(--color-primary-fixed-dim)] bg-[var(--color-primary-fixed)] p-4 text-[var(--color-on-primary-fixed)] transition-colors hover:brightness-95"
            >
              <div className="flex items-center gap-3">
                <Sparkles size={20} />
                <div>
                  <p className="text-sm font-semibold">Ask the AI architect</p>
                  <p className="text-xs opacity-80">Well-Architected recommendations</p>
                </div>
              </div>
              <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
