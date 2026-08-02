import Image from 'next/image';
import { icons, type LucideProps } from 'lucide-react';
import type { ServiceDef } from '@/lib/catalog';

/** Render a lucide icon by its string name (used by the data-driven catalog). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = icons[name as keyof typeof icons] ?? icons.Box;
  return <Cmp {...props} />;
}

/**
 * Service icon chip: the official provider architecture icon when the catalog
 * declares one (`iconUrl` — e.g. the official AWS Architecture Icons), else a
 * lucide glyph on an accent tile. `unoptimized` keeps the SVG served verbatim
 * so canvas PNG/PDF export captures it.
 */
export function ServiceIcon({ def, size = 36, className }: { def: ServiceDef; size?: number; className?: string }) {
  if (def.iconUrl) {
    return (
      <Image
        src={def.iconUrl}
        alt={`${def.name} icon`}
        width={size}
        height={size}
        unoptimized
        draggable={false}
        className={className}
        style={{ borderRadius: Math.round(size / 9) }}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size, background: `${def.accent}1f`, color: def.accent, borderRadius: Math.round(size / 4.5) }}
    >
      <Icon name={def.icon} size={Math.round(size * 0.52)} />
    </div>
  );
}
