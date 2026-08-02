import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from './Slot';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-[family-name:var(--font-label-md)] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 shadow-sm',
        secondary:
          'bg-[var(--color-secondary-container)] text-[var(--color-on-secondary-container)] hover:brightness-95',
        outline:
          'border border-[var(--color-outline-variant)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-container-low)]',
        ghost:
          'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]',
        tonal:
          'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] hover:brightness-95',
        danger:
          'bg-[var(--color-error)] text-[var(--color-on-error)] hover:brightness-110',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
