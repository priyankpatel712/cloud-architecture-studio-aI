'use client';
import { useMemo, useRef, useState } from 'react';
import { Upload, FileJson, GitBranch, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { parseImport, type ImportResult } from '@/lib/import/parse';
import type { ArchDocument } from '@/lib/canvas/model';

/**
 * Import dialog (007 roadmap 1.2): paste or upload a studio JSON export
 * (full-fidelity round-trip) or a Mermaid flowchart (the common AI interchange
 * format). Parsing is live — the dialog shows what will be imported (and any
 * warnings) before anything touches the canvas. Import REPLACES the canvas;
 * nothing is persisted until the user saves.
 */
export function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  /** load the parsed document onto the canvas; arrange=true when the source had no geometry */
  onImport: (doc: ArchDocument, arrange: boolean) => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo((): { result?: ImportResult; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { result: parseImport(text) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not parse this content.' };
    }
  }, [text]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const doImport = () => {
    if (!parsed.result) return;
    onImport(parsed.result.doc, parsed.result.format === 'mermaid');
    setText('');
    onClose();
  };

  const counts = parsed.result
    ? {
        nodes: parsed.result.doc.nodes.length,
        edges: parsed.result.doc.edges.length,
        containers: parsed.result.doc.containers.length,
      }
    : null;

  return (
    <Modal open={open} onClose={onClose} title="Import a diagram" size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span>Paste a studio JSON export or a Mermaid flowchart — or</span>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Choose a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mmd,.mermaid,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'{ "format": "cloud-architecture-studio/v1", ... }\n\nor\n\nflowchart LR\n  web[Web Client] --> api[API Gateway]\n  api --> svc[Order Service]\n  svc --> db[(PostgreSQL)]'}
          rows={10}
          spellCheck={false}
          className="w-full rounded-2xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] p-3 font-mono text-xs leading-relaxed focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25"
        />

        {parsed.error && (
          <p className="flex items-start gap-2 rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-3 py-2 text-xs text-[#8c1d18]">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {parsed.error}
          </p>
        )}
        {parsed.result && counts && (
          <div className="rounded-2xl border border-[var(--color-surface-variant)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="primary" className="gap-1">
                {parsed.result.format === 'json' ? <FileJson size={12} /> : <GitBranch size={12} />}
                {parsed.result.format === 'json' ? 'Studio JSON' : 'Mermaid'}
              </Badge>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {counts.nodes} service{counts.nodes === 1 ? '' : 's'} · {counts.edges} connection{counts.edges === 1 ? '' : 's'}
                {counts.containers > 0 ? ` · ${counts.containers} container${counts.containers === 1 ? '' : 's'}` : ''}
                {parsed.result.format === 'mermaid' ? ' · will be auto-arranged' : ''}
              </span>
            </div>
            {parsed.result.warnings.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-[11px] text-[var(--color-text-secondary)]">
                {parsed.result.warnings.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            Importing replaces the current canvas. Nothing is saved until you press Save.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={doImport} disabled={!parsed.result}>
              <Upload size={14} /> Import
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
