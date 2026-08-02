'use client';
import { ViewportPortal } from '@xyflow/react';
import type { GuideLine } from '@/lib/canvas/guides';

/**
 * Live alignment guide overlay (002 FR-003): thin lines in flow coordinates,
 * rendered while a drag has an edge/center match (see lib/canvas/guides.ts).
 */
export function AlignmentGuides({ guides }: { guides: GuideLine[] }) {
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      {guides.map((g, i) =>
        g.orientation === 'vertical' ? (
          <div
            key={i}
            className="pointer-events-none absolute w-px bg-[#d93025]"
            style={{ left: g.position, top: g.from, height: g.to - g.from }}
          />
        ) : (
          <div
            key={i}
            className="pointer-events-none absolute h-px bg-[#d93025]"
            style={{ top: g.position, left: g.from, width: g.to - g.from }}
          />
        )
      )}
    </ViewportPortal>
  );
}
