import { cloneElement, isValidElement, type ReactElement } from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal Slot: merges its own props/className onto a single child element.
 * Lets primitives support `asChild` (e.g. render a Button as a Next <Link>)
 * without pulling in Radix.
 */
export function Slot({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  if (!isValidElement(children)) return null;
  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props;
  return cloneElement(child, {
    ...props,
    ...childProps,
    className: cn(className, childProps.className as string | undefined),
  });
}
