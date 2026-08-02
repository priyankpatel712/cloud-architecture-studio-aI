'use client';
import { useEffect, useState } from 'react';
import {
  User,
  ShieldCheck,
  Bell,
  Palette,
  CreditCard,
  TriangleAlert,
  Check,
  GitBranch,
  Mail,
  KeyRound,
  Smartphone,
  Loader2,
  Sparkles,
  Trash2,
  Zap,
  BookOpen,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/cn';
import { initialsOf } from '@/lib/initials';
import { ROLE_LABELS, type Role } from '@/lib/rbac';
import { LLM_PROVIDERS, LLM_PROVIDER_LIST, type LlmProviderId } from '@/lib/llm-catalog';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'ai', label: 'AI Provider', icon: Sparkles },
  { id: 'knowledge', label: 'AI Knowledge', icon: BookOpen },
  { id: 'security', label: 'Account & Security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'billing', label: 'Plan & Billing', icon: CreditCard },
  { id: 'danger', label: 'Danger Zone', icon: TriangleAlert },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>('profile');

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-rise">
      <PageHeader eyebrow="Account" title="Settings" subtitle="Manage your profile, security, and workspace preferences." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* Section nav — vertical on desktop, horizontal scroller on mobile */}
        <nav className="custom-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {SECTIONS.map((s) => {
            const on = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
                  on
                    ? 'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]',
                  s.id === 'danger' && !on && 'text-[var(--color-error)]'
                )}
              >
                <s.icon size={17} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {active === 'profile' && <ProfileSection />}
          {active === 'ai' && <AiProviderSection />}
          {active === 'knowledge' && <KnowledgeSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'notifications' && <NotificationsSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'billing' && <BillingSection />}
          {active === 'danger' && <DangerSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------- shared card scaffold ---------- */

function Panel({
  title,
  desc,
  children,
  footer,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-sm">
      <div className="border-b border-[var(--color-surface-variant)] p-5">
        <h2 className="font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{desc}</p>}
      </div>
      <div className="p-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-surface-variant)] bg-[var(--color-surface-container-low)] px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{hint}</span>}
    </label>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ---------- sections ---------- */

function ProfileSection() {
  // FR-005: view + edit own profile. Name and organization are editable; the
  // email is the sign-in identity (changes are deferred — they interact with the
  // verification gate); the role label comes from RBAC and is read-only here.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; email: string; organization: string; role: Role } | null>(null);
  const [form, setForm] = useState({ name: '', organization: '' });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.user) {
          setMe(data.user);
          setForm({ name: data.user.name, organization: data.user.organization ?? '' });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save your profile.');
        return;
      }
      setMe(data.user);
      setSaved(true);
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Panel title="Profile">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading profile…
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Profile"
      desc="This information is visible to collaborators on shared architectures."
      footer={
        <>
          {error && <span className="mr-auto text-sm text-[var(--color-error)]">{error}</span>}
          {saved && !error && (
            <span className="mr-auto flex items-center gap-1 text-sm text-[var(--color-text-secondary)]" role="status">
              <Check size={14} /> Saved
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => me && setForm({ name: me.name, organization: me.organization ?? '' })}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary)] text-xl font-semibold text-[var(--color-on-primary)]">
          {initialsOf(form.name || me?.name || '')}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Your avatar shows your initials and updates with your name.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Email" hint="Sign-in identity — contact an admin to change it.">
          <Input type="email" value={me?.email ?? ''} readOnly disabled />
        </Field>
        <Field label="Organization">
          <Input
            value={form.organization}
            onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))}
          />
        </Field>
        <Field label="Role" hint="Assigned by an administrator.">
          <Select value={me ? ROLE_LABELS[me.role] : 'User'} disabled>
            <option>{me ? ROLE_LABELS[me.role] : 'User'}</option>
          </Select>
        </Field>
      </div>
    </Panel>
  );
}

/* ---------- AI provider ---------- */

interface LlmSettingsView {
  active: { provider: LlmProviderId; model: string; source: 'app' | 'env'; available: boolean };
  saved: { provider: LlmProviderId | null; model: string | null };
  env: { provider: string | null; model: string | null };
  keys: Record<LlmProviderId, { stored: boolean; env: boolean }>;
  canManage: boolean;
  /** 008 — null means never configured, which resolves to off. */
  roleTieringEnabled: boolean | null;
  /** 008 — work class → "provider/model". */
  roleModels: Record<string, string>;
  /**
   * 008 — what each work class would actually use right now, computed by the
   * same selector the generator uses. Lets tiering be verified here instead of
   * by running a generation and reading the trace.
   */
  roleDefaults: {
    role: string;
    tier: 'small' | 'mid' | 'large';
    resolved: { provider: string; model: string } | null;
    overridden: boolean;
  }[];
}

/**
 * 008 — the classes of work a generation turn is made of, grouped by how hard
 * each one is. Shown to the operator in plain language rather than by internal
 * role id, because the decision being made is "which model should do this kind
 * of thinking", not "what is this variable called".
 */
const WORK_CLASSES: { role: string; label: string; hint: string; tier: 'Small' | 'Mid' | 'Large' }[] = [
  { role: 'route', label: 'Routing', hint: 'Picks the diagram mode and which provider toolsets to attach.', tier: 'Small' },
  { role: 'intent', label: 'Understanding follow-ups', hint: 'Works out what a follow-up refers to on the canvas.', tier: 'Small' },
  { role: 'interpret', label: 'Interpreting replies', hint: 'Reads free-text answers to clarifying questions.', tier: 'Small' },
  { role: 'distill', label: 'Learning lessons', hint: 'Turns a self-correction into a reusable rule, after the turn.', tier: 'Small' },
  { role: 'research', label: 'Research', hint: 'Summarises documentation found on the web.', tier: 'Small' },
  { role: 'analyze', label: 'Requirements analysis', hint: 'Extracts what the request actually asks for.', tier: 'Mid' },
  { role: 'review', label: 'Self-review', hint: 'Grades the draft against the requirements.', tier: 'Mid' },
  { role: 'cost', label: 'Cost dialogue', hint: 'Builds the pricing questions and priced options.', tier: 'Mid' },
  { role: 'report', label: 'Reports', hint: 'Writes the architecture explanation document.', tier: 'Mid' },
  { role: 'plan', label: 'Architecture design', hint: 'Designs the diagram itself — keep this on your strongest model.', tier: 'Large' },
];

function AiProviderSection() {
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<{ provider: LlmProviderId; model: string; apiKey: string }>({
    provider: 'nvidia',
    model: '',
    apiKey: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Live model ids fetched from each provider's /models API (keyed by provider)
  // so the dropdown offers what the account can actually use — a mistyped model
  // id 404s every generation call.
  const [liveModels, setLiveModels] = useState<Partial<Record<LlmProviderId, string[]>>>({});
  // 008 — per-role tiering, edited locally and saved with the same PUT as the
  // provider config so one Save applies the whole AI configuration.
  const [tiering, setTiering] = useState(false);
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [showRoles, setShowRoles] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/llm');
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error ?? 'Could not load AI provider settings.');
          return;
        }
        setView(data.settings);
        setTiering(Boolean(data.settings.roleTieringEnabled));
        setRoleModels(data.settings.roleModels ?? {});
        setForm({
          provider: data.settings.active.provider,
          model: data.settings.active.model,
          apiKey: '',
        });
      } catch {
        setLoadError('Network error. Is the server running?');
      }
    })();
  }, []);

  const canManageView = view?.canManage ?? false;
  const formProvider = form.provider;
  useEffect(() => {
    if (!canManageView || liveModels[formProvider] !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/llm/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: formProvider, apiKey: '' }),
        });
        const data = await res.json();
        if (cancelled) return;
        // On failure store [] so we don't refetch in a loop; the datalist
        // silently falls back to the catalog suggestions.
        setLiveModels((prev) => ({ ...prev, [formProvider]: res.ok && data.ok ? data.models : [] }));
      } catch {
        if (!cancelled) setLiveModels((prev) => ({ ...prev, [formProvider]: [] }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formProvider, canManageView, liveModels]);

  if (loadError) {
    return (
      <Panel title="AI Provider">
        <p className="text-sm text-[var(--color-error)]">{loadError}</p>
      </Panel>
    );
  }
  if (!view) {
    return (
      <Panel title="AI Provider">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading provider settings…
        </div>
      </Panel>
    );
  }

  const canManage = view.canManage;
  const info = LLM_PROVIDERS[form.provider];
  const keyStatus = view.keys[form.provider];

  function pickProvider(id: LlmProviderId) {
    if (!view) return;
    setForm({
      provider: id,
      model:
        (view.saved.provider === id && view.saved.model) ||
        (view.active.provider === id ? view.active.model : LLM_PROVIDERS[id].defaultModel),
      apiKey: '',
    });
    setTestResult(null);
    setSaved(false);
    setError(null);
  }

  async function submit(body: Record<string, unknown>) {
    setSaving(true);
    setSaved(false);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save AI provider settings.');
        return;
      }
      setView(data.settings);
      if (typeof data.settings.roleTieringEnabled === 'boolean') setTiering(data.settings.roleTieringEnabled);
      if (data.settings.roleModels) setRoleModels(data.settings.roleModels);
      setForm((f) => ({ ...f, apiKey: '' }));
      setSaved(true);
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setSaving(false);
    }
  }

  const save = () =>
    submit({
      provider: form.provider,
      model: form.model.trim(),
      apiKey: form.apiKey.trim(),
      roleTieringEnabled: tiering,
      // Only send assignments that name a connection, so clearing a row back to
      // "Automatic" actually removes the override rather than storing an empty.
      roleModels: Object.fromEntries(Object.entries(roleModels).filter(([, v]) => v && v.includes('/'))),
    });
  const removeKey = () =>
    submit({ provider: form.provider, model: form.model.trim(), clearKey: true });

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch('/api/settings/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          model: form.model.trim(),
          apiKey: form.apiKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) setTestResult({ ok: false, message: data.error ?? 'Test failed.' });
      else if (data.ok)
        setTestResult({ ok: true, message: `Connected — ${data.model} · ${data.latencyMs} ms` });
      else setTestResult({ ok: false, message: data.error ?? 'Test failed.' });
    } catch {
      setTestResult({ ok: false, message: 'Network error. Is the server running?' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel
      title="AI Provider"
      desc="Which LLM powers architecture generation. Applies to the whole workspace immediately — no restart needed."
      footer={
        <>
          {error && <span className="mr-auto text-sm text-[var(--color-error)]">{error}</span>}
          {testResult && !error && (
            <span
              className={cn(
                'mr-auto flex items-center gap-1 text-sm',
                testResult.ok ? 'text-[#1e8e3e]' : 'text-[var(--color-error)]'
              )}
              role="status"
            >
              {testResult.ok && <Check size={14} />}
              {testResult.message}
            </span>
          )}
          {saved && !error && !testResult && (
            <span className="mr-auto flex items-center gap-1 text-sm text-[var(--color-text-secondary)]" role="status">
              <Check size={14} /> Saved
            </span>
          )}
          <Button variant="outline" size="sm" onClick={test} disabled={testing || saving || !canManage}>
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || testing || !canManage}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      {/* Active configuration summary */}
      <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl bg-[var(--color-surface-container-low)] p-4">
        <div className="flex items-center gap-3">
          <StatusDot tone={view.active.available ? 'success' : 'danger'} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
              {LLM_PROVIDERS[view.active.provider].label} ·{' '}
              <span className="font-mono text-xs">{view.active.model}</span>
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {view.active.available
                ? 'Ready'
                : 'No API key — generation runs in indicative (degraded) mode'}
            </p>
          </div>
        </div>
        <Badge variant={view.active.source === 'app' ? 'primary' : 'neutral'} size="sm">
          {view.active.source === 'app' ? 'App settings' : 'From .env'}
        </Badge>
      </div>

      {!canManage && (
        <p className="mb-4 rounded-xl bg-[var(--color-surface-container-low)] p-3 text-xs text-[var(--color-text-secondary)]">
          Only a super admin can change the AI provider. You can see the current configuration below.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LLM_PROVIDER_LIST.map((p) => {
          const on = form.provider === p.id;
          const key = view.keys[p.id];
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => pickProvider(p.id)}
              disabled={!canManage}
              className={cn(
                'rounded-2xl border-2 p-4 text-left transition-all disabled:cursor-not-allowed',
                on
                  ? 'border-[var(--color-primary)] bg-[var(--color-surface-bright)]'
                  : 'border-[var(--color-surface-variant)] hover:border-[var(--color-outline-variant)]'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{p.label}</span>
                {key.stored ? (
                  <Badge variant="success" size="sm">Key saved</Badge>
                ) : key.env ? (
                  <Badge variant="neutral" size="sm">Env key</Badge>
                ) : (
                  <Badge variant="outline" size="sm">No key</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{p.blurb}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Model"
          hint={
            (liveModels[form.provider]?.length ?? 0) > 0
              ? `${liveModels[form.provider]!.length} models live from ${info.label} — type to filter the dropdown.`
              : `Any model id ${info.label} serves — suggestions in the dropdown.`
          }
        >
          <Input
            list="llm-model-suggestions"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder={info.defaultModel}
            disabled={!canManage}
          />
          <datalist id="llm-model-suggestions">
            {((liveModels[form.provider]?.length ?? 0) > 0 ? liveModels[form.provider]! : info.models).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field
          label="API key"
          hint={
            keyStatus.stored
              ? 'Stored encrypted at rest. Enter a new key to replace it.'
              : keyStatus.env
                ? `Currently read from ${info.keyEnv} in .env — save one here to manage it in-app.`
                : `Create one at ${info.keyUrl}`
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            placeholder={keyStatus.stored ? '•••••••• (saved — leave blank to keep)' : `${info.keyEnv} value`}
            disabled={!canManage}
          />
        </Field>
      </div>

      {keyStatus.stored && canManage && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={removeKey} disabled={saving || testing}>
            <Trash2 size={15} /> Remove saved {info.label} key
          </Button>
        </div>
      )}

      {/* 008 US2 — match the model to the work. Placed inside the same panel so
          one Save applies the whole AI configuration. */}
      <div className="mt-6 border-t border-[var(--color-surface-variant)] pt-5">
        <Row
          title="Match the model to the task"
          desc="Send routine steps (routing, follow-ups, summarising) to a small fast model and keep your strongest model for designing the architecture. Uses fewer requests on your best model, which is the main cause of rate-limit failures."
        >
          <Switch
            checked={tiering}
            onChange={setTiering}
            disabled={!canManage}
            label="Match the model to the task"
          />
        </Row>

        {tiering && (
          <>
            <p className="mt-1 flex items-start gap-2 rounded-xl bg-[var(--color-surface-container-low)] p-3 text-xs text-[var(--color-text-secondary)]">
              <Zap size={14} className="mt-0.5 shrink-0" />
              <span>
                Each step uses the best available connection for its tier, falling back to your active
                one. Connections with a per-day free quota are never used for frequent steps.
                Leave a row on <strong>Automatic</strong> unless you want to pin it.
              </span>
            </p>

            <button
              type="button"
              onClick={() => setShowRoles((v) => !v)}
              aria-expanded={showRoles}
              // Explicit focus ring: this is a bare <button>, not the Button
              // component, so it does not inherit the shared focus treatment
              // the accessibility floor requires.
              className="mt-3 rounded-lg text-sm font-medium text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
            >
              {showRoles ? 'Hide' : 'Show'} per-step model assignment
            </button>

            {showRoles && (
              <div className="mt-3 space-y-2">
                {WORK_CLASSES.map((wc) => {
                  // What the server says this step resolves to today. Shown
                  // because "Automatic" alone tells the operator nothing about
                  // which model is actually going to run.
                  const resolved = view.roleDefaults?.find((r) => r.role === wc.role)?.resolved ?? null;
                  return (
                  <div
                    key={wc.role}
                    className="grid grid-cols-1 items-center gap-2 rounded-xl border border-[var(--color-surface-variant)] p-3 sm:grid-cols-[1fr_220px]"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                        {wc.label}
                        <Badge>{wc.tier}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{wc.hint}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">
                        {resolved ? `now: ${resolved.provider} · ${resolved.model}` : 'no connection available'}
                      </p>
                    </div>
                    <Select
                      value={roleModels[wc.role] ?? ''}
                      disabled={!canManage}
                      aria-label={`Model for ${wc.label}`}
                      onChange={(e) =>
                        setRoleModels((m) => {
                          const next = { ...m };
                          if (e.target.value) next[wc.role] = e.target.value;
                          else delete next[wc.role];
                          return next;
                        })
                      }
                    >
                      <option value="">Automatic</option>
                      {LLM_PROVIDER_LIST.filter((p) => view.keys[p.id]?.stored || view.keys[p.id]?.env).flatMap((p) => {
                        const models = liveModels[p.id]?.length ? liveModels[p.id]! : p.models;
                        return models.map((m) => (
                          <option key={`${p.id}/${m}`} value={`${p.id}/${m}`}>
                            {p.label} · {m}
                          </option>
                        ));
                      })}
                    </Select>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function SecuritySection() {
  return (
    <div className="space-y-6">
      <Panel
        title="Password"
        desc="Set a strong password to keep your account secure."
        footer={<Button size="sm">Update password</Button>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Current password">
            <Input type="password" placeholder="••••••••" />
          </Field>
          <div className="hidden sm:block" />
          <Field label="New password">
            <Input type="password" placeholder="At least 12 characters" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" placeholder="Repeat new password" />
          </Field>
        </div>
      </Panel>

      <Panel title="Email verification">
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-[var(--color-surface-container-low)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1e8e3e]/12 text-[#1e8e3e]">
              <Mail size={18} />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">priyank@devrepublic.nl</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Primary email address</p>
            </div>
          </div>
          <Badge variant="success" size="sm">
            <Check size={12} /> Verified
          </Badge>
        </div>
      </Panel>

      <Panel title="Two-factor authentication" desc="Add a second step at sign-in for extra protection.">
        <Row title="Authenticator app" desc="Use a TOTP app like 1Password or Authy.">
          <Button variant="outline" size="sm">
            <Smartphone size={15} /> Enable
          </Button>
        </Row>
      </Panel>

      <Panel title="Connected accounts" desc="Sign in faster with a linked provider (Auth.js).">
        <div className="divide-y divide-[var(--color-surface-variant)]">
          <Row title="Google" desc="Not connected">
            <Button variant="outline" size="sm">
              Connect
            </Button>
          </Row>
          <Row title="GitHub" desc="Connected as @priyank">
            <Button variant="ghost" size="sm">
              <GitBranch size={15} /> Disconnect
            </Button>
          </Row>
        </div>
      </Panel>
    </div>
  );
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState({
    generation: true,
    priceAlerts: true,
    weekly: false,
    security: true,
    product: false,
  });
  const set = (k: keyof typeof prefs) => (v: boolean) => setPrefs((p) => ({ ...p, [k]: v }));

  return (
    <Panel title="Notifications" desc="Choose what we email you about.">
      <div className="divide-y divide-[var(--color-surface-variant)]">
        <Row title="Architecture generation" desc="When an AI generation completes or fails.">
          <Switch checked={prefs.generation} onChange={set('generation')} label="Architecture generation" />
        </Row>
        <Row title="Cost alerts" desc="When a project's estimate changes by more than 10%.">
          <Switch checked={prefs.priceAlerts} onChange={set('priceAlerts')} label="Cost alerts" />
        </Row>
        <Row title="Weekly summary" desc="A digest of your projects and spend every Monday.">
          <Switch checked={prefs.weekly} onChange={set('weekly')} label="Weekly summary" />
        </Row>
        <Row title="Security alerts" desc="Sign-ins from new devices and credential changes.">
          <Switch checked={prefs.security} onChange={set('security')} label="Security alerts" />
        </Row>
        <Row title="Product updates" desc="New providers, exports, and features.">
          <Switch checked={prefs.product} onChange={set('product')} label="Product updates" />
        </Row>
      </div>
    </Panel>
  );
}

const ACCENTS = ['#005bbf', '#00b34a', '#9e4300', '#7c3aed', '#d93025'];

function AppearanceSection() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [accent, setAccent] = useState(ACCENTS[0]);

  return (
    <Panel title="Appearance" desc="Personalize how the Studio looks. Applied on your device.">
      <Field label="Theme">
        <div className="grid grid-cols-3 gap-3">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                'rounded-2xl border-2 p-3 text-left transition-all',
                theme === t
                  ? 'border-[var(--color-primary)] bg-[var(--color-surface-bright)]'
                  : 'border-[var(--color-surface-variant)] hover:border-[var(--color-outline-variant)]'
              )}
            >
              <div
                className={cn(
                  'mb-2 h-12 w-full rounded-lg border',
                  t === 'light' && 'border-[var(--color-surface-variant)] bg-white',
                  t === 'dark' && 'border-transparent bg-[#181c20]',
                  t === 'system' && 'border-[var(--color-surface-variant)] bg-gradient-to-r from-white to-[#181c20]'
                )}
              />
              <span className="text-sm font-medium capitalize text-[var(--color-text-primary)]">{t}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-5">
        <Field label="Accent color">
          <div className="flex items-center gap-2.5">
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => setAccent(c)}
                aria-label={`Accent ${c}`}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110',
                  accent === c && 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)]'
                )}
                style={{ background: c, boxShadow: accent === c ? `0 0 0 2px ${c}` : undefined }}
              >
                {accent === c && <Check size={16} className="text-white" />}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Panel>
  );
}

/* ---------- AI knowledge review (008 US5, FR-032/FR-033) ---------- */

interface KnowledgeEntryView {
  id: string;
  kind: string;
  provider: string;
  designMode: string;
  title: string;
  content: string;
  keywords: string[];
  source: string;
  sourceUrl: string | null;
  confidence: number;
  usageCount: number;
  lastUsedAt: string | null;
  enabled: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  seed: 'Built-in rule',
  mcp: 'From provider docs',
  web: 'From the web',
  learned: 'Learned from a correction',
};

/**
 * 008 FR-032/FR-033 — review what the generator has learned.
 *
 * The store decides which rules are injected into every design prompt, so an
 * operator needs to see it and be able to switch an entry off when it turns out
 * to be wrong — without a redeploy, and taking effect on the next generation.
 *
 * Disabling is presented as the primary action rather than deletion: a deleted
 * seed rule comes back on the next seeding run, so deletion would look like it
 * worked and then quietly undo itself. The API says which entries that applies
 * to (`willReseed`) and this panel repeats the warning.
 */
function KnowledgeSection() {
  const [entries, setEntries] = useState<KnowledgeEntryView[]>([]);
  const [total, setTotal] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState({ provider: '', source: '', enabled: '' });
  const [editing, setEditing] = useState<{ id: string; title: string; content: string; keywords: string } | null>(null);
  const [reseeding, setReseeding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][]
  ).toString();
  // A primitive that changes exactly when a refetch is warranted — filters, or
  // an explicit reload after reseeding.
  const cacheKey = `${query}#${reloadKey}`;
  // Derived rather than a setState in the effect body: the fetch's completion is
  // what "loaded" means, so there is no separate flag to get out of step with it.
  const loading = loadedKey !== cacheKey;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [k, s] = await Promise.all([
          fetch(`/api/settings/knowledge${query ? `?${query}` : ''}`),
          fetch('/api/settings/llm'),
        ]);
        const data = await k.json();
        if (cancelled) return;
        if (!k.ok) {
          setError(data.error ?? 'Could not load stored knowledge.');
        } else {
          setEntries(data.entries);
          setTotal(data.total);
          setError(null);
          if (s.ok) setCanManage(Boolean((await s.json()).settings?.canManage));
        }
      } catch {
        if (!cancelled) setError('Network error. Is the server running?');
      } finally {
        if (!cancelled) setLoadedKey(cacheKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, query]);

  async function mutate(id: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/settings/knowledge/${id}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not update this entry.');
        return null;
      }
      return data;
    } catch {
      setError('Network error. Is the server running?');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(entry: KnowledgeEntryView) {
    const data = await mutate(entry.id, { method: 'PATCH', body: JSON.stringify({ enabled: !entry.enabled }) });
    if (data) {
      setEntries((list) => list.map((e) => (e.id === entry.id ? (data.entry as KnowledgeEntryView) : e)));
      setNotice(entry.enabled ? 'Disabled — it will not be used in the next generation.' : 'Enabled.');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const keywords = editing.keywords.split(',').map((k) => k.trim()).filter(Boolean);
    const data = await mutate(editing.id, {
      method: 'PATCH',
      body: JSON.stringify({ title: editing.title, content: editing.content, keywords }),
    });
    if (data) {
      setEntries((list) => list.map((e) => (e.id === editing.id ? (data.entry as KnowledgeEntryView) : e)));
      setEditing(null);
      setNotice('Saved — this applies to the next generation.');
    }
  }

  async function remove(entry: KnowledgeEntryView) {
    const data = await mutate(entry.id, { method: 'DELETE' });
    if (data) {
      setEntries((list) => list.filter((e) => e.id !== entry.id));
      setTotal((t) => Math.max(0, t - 1));
      setNotice(
        data.willReseed
          ? 'Deleted — but this is a built-in rule and seeding will restore it. Disable it instead to make it stick.'
          : 'Deleted.'
      );
    }
  }

  async function reseed() {
    setReseeding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/knowledge/reseed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Could not reseed.');
      else {
        setNotice(`Reseeded — ${data.created} added, ${data.updated} already present.`);
        setReloadKey((k) => k + 1);
      }
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setReseeding(false);
    }
  }

  return (
    <Panel
      title="What the AI has learned"
      desc="Rules and lessons applied to every architecture it designs. Switch one off and the next generation stops using it — no restart, no deploy."
      footer={
        canManage ? (
          <Button variant="outline" size="sm" onClick={reseed} disabled={reseeding}>
            {reseeding ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {reseeding ? 'Reseeding…' : 'Restore built-in rules'}
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Provider">
          <Select
            value={filters.provider}
            aria-label="Filter by provider"
            onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value }))}
          >
            <option value="">All providers</option>
            <option value="any">Provider-agnostic</option>
            <option value="aws">AWS</option>
            <option value="mongodb">MongoDB</option>
            <option value="system">Generic system design</option>
          </Select>
        </Field>
        <Field label="Where it came from">
          <Select
            value={filters.source}
            aria-label="Filter by source"
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          >
            <option value="">Any source</option>
            {Object.entries(SOURCE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={filters.enabled}
            aria-label="Filter by status"
            onChange={(e) => setFilters((f) => ({ ...f, enabled: e.target.value }))}
          >
            <option value="">All</option>
            <option value="true">In use</option>
            <option value="false">Switched off</option>
          </Select>
        </Field>
      </div>

      {error && (
        <p className="mt-4 text-sm text-[var(--color-error)]" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading knowledge…
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Nothing stored yet for this filter.{' '}
          {canManage && 'Use “Restore built-in rules” to seed the starting set.'}
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
            Showing {entries.length} of {total}
          </p>
          <ul className="mt-2 space-y-3">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  'rounded-2xl border border-[var(--color-surface-variant)] p-4',
                  !e.enabled && 'opacity-60'
                )}
              >
                {editing?.id === e.id ? (
                  <div className="space-y-3">
                    <Field label="Title">
                      <Input value={editing.title} maxLength={120} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} />
                    </Field>
                    <Field label="Rule" hint={`${editing.content.length} / 600 characters`}>
                      <Textarea
                        rows={3}
                        maxLength={600}
                        value={editing.content}
                        onChange={(ev) => setEditing({ ...editing, content: ev.target.value })}
                      />
                    </Field>
                    <Field label="Keywords" hint="Comma separated. These decide when the rule is applied.">
                      <Input value={editing.keywords} onChange={(ev) => setEditing({ ...editing, keywords: ev.target.value })} />
                    </Field>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} disabled={busyId === e.id}>
                        {busyId === e.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{e.title}</p>
                      <Badge size="sm">{SOURCE_LABELS[e.source] ?? e.source}</Badge>
                      {e.provider !== 'any' && <Badge size="sm">{e.provider}</Badge>}
                      {!e.enabled && <Badge size="sm">Switched off</Badge>}
                    </div>
                    <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{e.content}</p>
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      {/* Confidence is what governs whether it is retrieved at all,
                          so it is stated plainly rather than shown as a bare number. */}
                      Trust {Math.round(e.confidence * 100)}% · used {e.usageCount.toLocaleString()}{' '}
                      {e.usageCount === 1 ? 'time' : 'times'}
                      {e.sourceUrl && (
                        <>
                          {' · '}
                          <a
                            href={e.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            source
                          </a>
                        </>
                      )}
                    </p>
                    {canManage && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggle(e)}
                          disabled={busyId === e.id}
                        >
                          {busyId === e.id ? <Loader2 size={15} className="animate-spin" /> : null}
                          {e.enabled ? 'Switch off' : 'Switch on'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditing({ id: e.id, title: e.title, content: e.content, keywords: e.keywords.join(', ') })
                          }
                        >
                          <Pencil size={15} /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(e)} disabled={busyId === e.id}>
                          <Trash2 size={15} /> Delete
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ---------- AI usage (008 US5, FR-031) ---------- */

interface UsageView {
  window: string;
  totals: { requests: number; promptTokens: number; completionTokens: number };
  byConnection: {
    provider: string;
    model: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    rateLimited: number;
    errors: number;
    meanLatencyMs: number;
  }[];
  byRole?: { role: string; requests: number; tier: string }[];
  smallMidShare: number;
}

const USAGE_WINDOW_OPTIONS = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/**
 * 008 FR-031 — real AI usage, replacing the hardcoded "37 of 500" figures this
 * panel used to show. Every number comes from `LlmUsage`; nothing here is
 * estimated, and a workspace that has made no calls sees zeros rather than an
 * error, because "no calls yet" is a real state worth showing.
 */
function AiUsagePanel() {
  const [window, setWindow] = useState('30d');
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedWindow, setLoadedWindow] = useState<string | null>(null);
  // Derived from what has actually arrived, so it cannot disagree with the data.
  const loading = loadedWindow !== window;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/settings/llm/usage?window=${window}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? 'Could not load usage.');
        else {
          setUsage(data);
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Network error. Is the server running?');
      } finally {
        if (!cancelled) setLoadedWindow(window);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [window]);

  const totals = usage?.totals;
  const tokens = (totals?.promptTokens ?? 0) + (totals?.completionTokens ?? 0);

  return (
    <Panel
      title="AI usage"
      desc="Model requests made by this workspace. Counts and timings only — no prompt or response text is ever stored."
    >
      <div className="mb-4 max-w-[220px]">
        <Field label="Period">
          <Select value={window} onChange={(e) => setWindow(e.target.value)} aria-label="Usage period">
            {USAGE_WINDOW_OPTIONS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading usage…
        </div>
      )}
      {error && !loading && <p className="text-sm text-[var(--color-error)]">{error}</p>}

      {usage && !loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-4">
              <p className="text-xs text-[var(--color-text-secondary)]">Model requests</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
                {totals!.requests.toLocaleString()}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">across all connections</p>
            </div>
            <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-4">
              <p className="text-xs text-[var(--color-text-secondary)]">Tokens</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">{compact.format(tokens)}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {compact.format(totals!.promptTokens)} in · {compact.format(totals!.completionTokens)} out
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--color-surface-container-low)] p-4">
              <p className="text-xs text-[var(--color-text-secondary)]">Kept off your largest model</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-text-primary)]">
                {Math.round(usage.smallMidShare * 100)}%
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {totals!.requests === 0 ? 'no requests yet' : 'served by a small or mid model'}
              </p>
            </div>
          </div>

          {usage.byConnection.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
              No model requests in this period yet. Generate an architecture and the figures will appear here.
            </p>
          ) : (
            <div className="custom-scrollbar mt-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Model requests by connection</caption>
                <thead>
                  <tr className="text-xs text-[var(--color-text-secondary)]">
                    <th scope="col" className="py-2 pr-3 font-medium">Connection</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Requests</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Tokens</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Mean latency</th>
                    <th scope="col" className="py-2 text-right font-medium">Rate limited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-surface-variant)]">
                  {usage.byConnection.map((c) => (
                    <tr key={`${c.provider}/${c.model}`}>
                      <td className="py-2.5 pr-3">
                        <span className="text-[var(--color-text-primary)]">{c.provider}</span>
                        <span className="ml-1.5 font-mono text-xs text-[var(--color-text-secondary)]">{c.model}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono">{c.requests.toLocaleString()}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{compact.format(c.promptTokens + c.completionTokens)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{c.meanLatencyMs.toLocaleString()} ms</td>
                      <td className="py-2.5 text-right font-mono">
                        {c.rateLimited > 0 ? (
                          <span className="text-[var(--color-error)]">{c.rateLimited}</span>
                        ) : (
                          <span className="text-[var(--color-text-secondary)]">0</span>
                        )}
                        {c.errors > 0 && (
                          <span className="ml-2 text-xs text-[var(--color-text-secondary)]">{c.errors} err</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Only administrators receive byRole from the API (FR-033). */}
          {usage.byRole && usage.byRole.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Requests by step</p>
              <ul className="flex flex-wrap gap-2">
                {usage.byRole.map((r) => (
                  <li
                    key={r.role}
                    className="rounded-xl bg-[var(--color-surface-container-low)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]"
                  >
                    {WORK_CLASSES.find((w) => w.role === r.role)?.label ?? r.role}
                    <span className="ml-1.5 font-mono text-[var(--color-text-primary)]">{r.requests.toLocaleString()}</span>
                    <span className="ml-1.5">· {r.tier}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function BillingSection() {
  return (
    <div className="space-y-6">
      <Panel title="Current plan">
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-primary-fixed-dim)] bg-[var(--color-primary-fixed)] p-5 text-[var(--color-on-primary-fixed)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-[family-name:var(--font-headline-sm)] text-xl font-bold">Team</span>
              <Badge variant="primary" size="sm">
                <StatusDot tone="success" /> Active
              </Badge>
            </div>
            <p className="mt-1 text-sm opacity-80">Unlimited projects · AWS + MongoDB MCP · live pricing.</p>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0 self-start sm:self-auto">
            Manage subscription
          </Button>
        </div>
      </Panel>

      <AiUsagePanel />

      <Panel title="Payment method" footer={<Button variant="outline" size="sm">Update card</Button>}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-[var(--color-surface-container-high)] font-mono text-xs font-bold text-[var(--color-text-secondary)]">
            VISA
          </div>
          <div>
            <p className="font-mono text-sm text-[var(--color-text-primary)]">•••• •••• •••• 4242</p>
            <p className="text-xs text-[var(--color-text-secondary)]">Expires 08 / 2027</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function DangerSection() {
  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-error)]/40 bg-[var(--color-surface-container-lowest)] shadow-sm">
      <div className="border-b border-[var(--color-error)]/20 bg-[var(--color-error-container)]/40 p-5">
        <h2 className="flex items-center gap-2 font-[family-name:var(--font-headline-sm)] text-lg font-semibold text-[var(--color-on-error-container)]">
          <TriangleAlert size={18} /> Danger Zone
        </h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">Irreversible actions. Proceed with care.</p>
      </div>
      <div className="divide-y divide-[var(--color-surface-variant)] p-5">
        <Row title="Archive all projects" desc="Move every project to the archive. You can restore them later.">
          <Button variant="outline" size="sm">
            Archive all
          </Button>
        </Row>
        <Row title="Delete account" desc="Permanently remove your account, projects, and connections.">
          <Button variant="danger" size="sm">
            <KeyRound size={15} /> Delete account
          </Button>
        </Row>
      </div>
    </section>
  );
}
