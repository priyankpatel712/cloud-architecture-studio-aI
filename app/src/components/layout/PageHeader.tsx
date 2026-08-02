export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1.5 font-mono text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-primary)]">
            {eyebrow}
          </p>
        )}
        <h1 className="font-[family-name:var(--font-headline-lg)] text-[2rem] font-bold leading-none tracking-tight text-[var(--color-text-primary)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-[15px] text-[var(--color-text-secondary)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
