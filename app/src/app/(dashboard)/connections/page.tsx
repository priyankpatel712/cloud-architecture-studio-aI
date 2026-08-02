'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, KeyRound, RefreshCw, Clock, Server, Leaf, ArrowRight, Lock,
  Loader2, TriangleAlert, ExternalLink, Unplug,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';

/**
 * Cloud connections (US4, FR-011–013). AWS uses the IAM Identity Center device
 * flow — the user approves in the AWS browser tab while this page polls. Atlas
 * takes a scoped read API key, verified server-side before storage. Secrets are
 * encrypted at rest and never returned to the browser (Constitution III).
 */

interface ConnectionView {
  provider: 'aws' | 'mongodb';
  status: 'pending' | 'connected' | 'expired' | 'disconnected';
  accountId: string | null;
  alias: string | null;
  region: string | null;
  permissionSet: string | null;
  sessionExpiresAt: string | null;
  orgId: string | null;
  orgName: string | null;
  projectsCount: number;
}
interface DeviceInfo {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
}

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Partial<Record<'aws' | 'mongodb', ConnectionView>>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.ok) setConnections((await res.json()).connections);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-rise">
      <PageHeader
        eyebrow="Providers"
        title="Cloud connections"
        subtitle="Connect provider accounts through official, short-lived sessions. We never store long-term credentials."
      />

      <div className="flex items-start gap-3 rounded-2xl border border-[var(--color-primary-fixed-dim)] bg-[var(--color-primary-fixed)] px-4 py-3 text-[var(--color-on-primary-fixed)]">
        <Lock size={18} className="mt-0.5 shrink-0" />
        <p className="text-sm">
          Access uses <strong>AWS IAM Identity Center (SSO)</strong> and Atlas API keys scoped to read
          configuration. Sessions are temporary and encrypted — no permanent keys touch our servers.
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={15} className="animate-spin" /> Loading connections…
        </p>
      ) : (
        <>
          <AwsSection connection={connections.aws ?? null} onChanged={load} />
          <AtlasSection connection={connections.mongodb ?? null} onChanged={load} />
        </>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">Coming soon</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {['Azure', 'Google Cloud', 'Cloudflare', 'Vercel'].map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded-2xl border border-dashed border-[var(--color-outline-variant)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
            >
              {p}
              <ArrowRight size={14} className="opacity-40" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AwsSection({ connection, onChanged }: { connection: ConnectionView | null; onChanged: () => void }) {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = connection?.status === 'connected';
  const expired = connection?.status === 'expired';

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  // Function declaration (hoisted) so the recursive re-schedule is legal.
  function poll(interval: number) {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/connections/aws/poll', { method: 'POST' });
        if (res.status === 202) {
          const data = await res.json();
          poll(data.slowDown ? interval + 5 : interval);
          return;
        }
        const data = await res.json();
        setDevice(null);
        if (!res.ok) setError(data.error ?? 'The sign-in attempt failed.');
        onChanged();
      } catch {
        poll(interval);
      }
    }, interval * 1000);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connections/aws/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not start the AWS sign-in.');
        return;
      }
      setDevice(data);
      window.open(data.verificationUriComplete, '_blank', 'noopener');
      poll(data.interval ?? 5);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await fetch('/api/connections/aws/disconnect', { method: 'POST' });
    setDevice(null);
    onChanged();
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--color-surface-variant)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FF9900]/12 text-[#FF9900]">
            <span className="text-base font-bold">aws</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-text-primary)]">
                Amazon Web Services
              </h2>
              {connected ? (
                <Badge variant="success" size="sm"><StatusDot tone="success" /> Connected</Badge>
              ) : expired ? (
                <Badge variant="warning" size="sm"><StatusDot tone="warning" /> Session expired</Badge>
              ) : device ? (
                <Badge variant="primary" size="sm"><StatusDot tone="warning" /> Awaiting approval</Badge>
              ) : (
                <Badge variant="neutral" size="sm"><StatusDot tone="idle" /> Not connected</Badge>
              )}
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">
              IAM Identity Center{connection?.permissionSet ? ` · ${connection.permissionSet}` : ' · device sign-in'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
          {connected || expired ? (
            <>
              <Button variant="ghost" size="sm" onClick={start} disabled={busy}>
                <RefreshCw size={15} /> {expired ? 'Reconnect' : 'Refresh session'}
              </Button>
              <Button variant="outline" size="sm" onClick={disconnect}>
                <Unplug size={15} /> Disconnect
              </Button>
            </>
          ) : !device ? (
            <Button size="sm" onClick={start} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Connect AWS
            </Button>
          ) : null}
        </div>
      </div>

      {/* T037: expired mid-task → prompt re-auth; nothing the user built is lost. */}
      {expired && (
        <div className="flex items-center gap-2 border-b border-[var(--color-surface-variant)] bg-[#fef7e0] px-5 py-2.5 text-xs text-[#7a5900]">
          <TriangleAlert size={14} className="shrink-0" />
          Your temporary AWS session expired. Reconnect to keep using live AWS data — your projects
          and designs are unaffected.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 border-b border-[var(--color-surface-variant)] bg-[#fcece9] px-5 py-2.5 text-xs text-[#8c1d18]">
          <TriangleAlert size={14} className="shrink-0" /> {error}
        </div>
      )}

      {device ? (
        <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <div className="rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-low)] px-5 py-3 font-mono text-xl font-bold tracking-[0.2em] text-[var(--color-text-primary)]">
            {device.userCode}
          </div>
          <div className="text-sm text-[var(--color-text-secondary)]">
            <p>
              Approve this code in the AWS tab we opened.{' '}
              <a
                href={device.verificationUriComplete}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] underline"
              >
                Open again <ExternalLink size={12} />
              </a>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs">
              <Loader2 size={12} className="animate-spin" /> Waiting for approval…
            </p>
          </div>
        </div>
      ) : connected || expired ? (
        <div className="grid grid-cols-2 gap-px bg-[var(--color-surface-variant)] sm:grid-cols-4">
          {[
            { label: 'Account ID', value: connection?.accountId ?? '—', icon: Server },
            { label: 'Alias', value: connection?.alias ?? '—', icon: ShieldCheck },
            { label: 'Region', value: connection?.region ?? '—', icon: Server },
            {
              label: 'Session expires',
              value: connection?.sessionExpiresAt ? timeUntil(connection.sessionExpiresAt) : '—',
              icon: Clock,
            },
          ].map((f) => (
            <div key={f.label} className="bg-[var(--color-surface-container-lowest)] p-4">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                <f.icon size={12} /> {f.label}
              </div>
              <p className="mt-1 font-mono text-sm font-medium text-[var(--color-text-primary)]">{f.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Sign in with your organization&apos;s IAM Identity Center. Only a temporary, encrypted
            session is kept — never access keys.
          </p>
        </div>
      )}
    </section>
  );
}

function AtlasSection({ connection, onChanged }: { connection: ConnectionView | null; onChanged: () => void }) {
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const connected = connection?.status === 'connected';

  async function connect() {
    if (!publicKey.trim() || !privateKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connections/mongodb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: publicKey.trim(), privateKey: privateKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not connect to Atlas.');
        return;
      }
      setPublicKey('');
      setPrivateKey('');
      setShowForm(false);
      onChanged();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await fetch('/api/connections/mongodb', { method: 'DELETE' });
    onChanged();
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--color-surface-variant)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#00ED64]/15 text-[#00b34a]">
            <Leaf size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-text-primary)]">
                MongoDB Atlas
              </h2>
              {connected ? (
                <Badge variant="success" size="sm"><StatusDot tone="success" /> Connected</Badge>
              ) : (
                <Badge variant="neutral" size="sm"><StatusDot tone="idle" /> Not connected</Badge>
              )}
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">Atlas Administration API · read-only</p>
          </div>
        </div>
        {connected ? (
          <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={disconnect}>
            <Unplug size={15} /> Disconnect
          </Button>
        ) : (
          <Button size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => setShowForm((s) => !s)}>
            <KeyRound size={15} /> Connect Atlas
          </Button>
        )}
      </div>

      {connected ? (
        <div className="grid grid-cols-2 gap-px bg-[var(--color-surface-variant)] sm:grid-cols-3">
          {[
            { label: 'Organization', value: connection?.orgName ?? '—' },
            { label: 'Org ID', value: connection?.orgId ?? '—' },
            { label: 'Projects', value: String(connection?.projectsCount ?? 0) },
          ].map((f) => (
            <div key={f.label} className="bg-[var(--color-surface-container-lowest)] p-4">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">{f.label}</div>
              <p className="mt-1 truncate font-mono text-sm font-medium text-[var(--color-text-primary)]">{f.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            Connect your Atlas organization to list projects and clusters, read configuration, and get
            AI recommendations for indexes, scaling, and Vector Search.
          </p>
          {showForm && (
            <div className="mb-4 space-y-3 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-low)] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Public key</span>
                  <Input
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder="e.g. abcdefgh"
                    autoComplete="off"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Private key</span>
                  <Input
                    type="password"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="••••••••-••••-••••"
                    autoComplete="off"
                  />
                </label>
              </div>
              {error && (
                <p className="flex items-center gap-1.5 text-xs text-[#8c1d18]">
                  <TriangleAlert size={13} /> {error}
                </p>
              )}
              <Button size="sm" onClick={connect} disabled={busy || !publicKey.trim() || !privateKey.trim()}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Verify &amp; connect
              </Button>
            </div>
          )}
          <ol className="grid gap-3 sm:grid-cols-4">
            {['Create API key', 'Paste public + private key', 'Select organization', 'Authorize read access'].map(
              (s, i) => (
                <li
                  key={s}
                  className="flex items-center gap-2 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-low)] p-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-secondary-container)] font-mono text-xs font-semibold text-[var(--color-on-secondary-container)]">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-primary)]">{s}</span>
                </li>
              )
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
