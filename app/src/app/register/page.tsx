'use client';
import { useState } from 'react';
import Link from 'next/link';
import { UserPlus, Loader2, TriangleAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Registration failed.');
        setLoading(false);
        return;
      }
      // Verification gate (FR-004): the session is unverified until the emailed
      // link is confirmed; /verify shows the prompt (and, in dev, the link).
      window.location.href = '/verify';
    } catch {
      setError('Network error. Is the server running?');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start designing cloud architectures in minutes"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--color-primary)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={submit}
        className="space-y-4 rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-6 shadow-sm"
      >
        {error && (
          <div className="flex items-start gap-2 rounded-2xl bg-[var(--color-error-container)] px-3 py-2.5 text-sm text-[var(--color-on-error-container)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Full name</span>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Cooper" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Email</span>
          <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Password</span>
          <Input type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
        </label>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? <Loader2 size={17} className="animate-spin" /> : <UserPlus size={17} />}
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
