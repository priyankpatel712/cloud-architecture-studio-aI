import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-[family-name:var(--font-label-md)] font-medium leading-none',
  {
    variants: {
      variant: {
        neutral:
          'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]',
        primary:
          'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
        success: 'bg-[#1e8e3e]/12 text-[#1e8e3e]',
        warning: 'bg-[#9e4300]/12 text-[var(--color-tertiary)]',
        danger: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
        outline:
          'border border-[var(--color-outline-variant)] text-[var(--color-text-secondary)]',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** A small pulsing status dot for connection / health states. */
export function StatusDot({
  tone = 'success',
  className,
}: {
  tone?: 'success' | 'warning' | 'danger' | 'idle';
  className?: string;
}) {
  const map = {
    success: 'bg-[#1e8e3e]',
    warning: 'bg-[var(--color-tertiary)]',
    danger: 'bg-[var(--color-error)]',
    idle: 'bg-[var(--color-outline)]',
  } as const;
  return (
    <span className={cn('relative flex h-2 w-2', className)}>
      {tone !== 'idle' && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            map[tone]
          )}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', map[tone])} />
    </span>
  );
}
