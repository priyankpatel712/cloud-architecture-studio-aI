'use client';
import { memo, useState } from 'react';
import Image from 'next/image';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { containerTypeById } from '@/lib/catalog';
import type { ContainerNodeData } from '@/lib/canvas/model';

interface ContainerNodeExtra {
  onRename?: (id: string, label: string) => void;
  onResizeEnd?: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * Typed cloud-boundary container (002 FR-005, research R2): a labeled, resizable
 * React Flow parent node. The type badge and accent come from the provider
 * registry via the client catalog (Constitution II) — nothing is hard-coded here.
 * `onRename`/`onResizeEnd` are injected by Canvas's nodeTypes wrapper.
 */
function ContainerNodeImpl({ id, data, selected, onRename, onResizeEnd }: NodeProps & ContainerNodeExtra) {
  const d = data as ContainerNodeData;
  const typeDef = containerTypeById(d.ctype);
  const accent = typeDef?.accent ?? '#5f6368';
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="h-full w-full rounded-2xl border-2 border-dashed transition-colors"
      style={{
        borderColor: selected ? accent : `${accent}88`,
        background: `${accent}0a`,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineClassName="!border-transparent"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border-2 !border-white"
        handleStyle={{ background: accent }}
        onResizeEnd={(_e, params) => onResizeEnd?.(id, params)}
      />
      <div className="pointer-events-none absolute left-0 top-0 flex max-w-full items-center gap-1.5 pr-2">
        {/* Official AWS group icon in the top-left corner — the standard boundary
            treatment in AWS architecture diagrams (region/VPC/subnet). */}
        {typeDef?.iconUrl ? (
          <Image src={typeDef.iconUrl} alt="" width={22} height={22} unoptimized draggable={false} className="shrink-0 rounded-tl-[14px]" />
        ) : (
          <span
            className="ml-2 mt-2 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
            style={{ background: accent }}
          >
            {typeDef?.label ?? d.ctype}
          </span>
        )}
        {editing ? (
          <input
            autoFocus
            defaultValue={d.label}
            onBlur={(e) => {
              setEditing(false);
              onRename?.(id, e.target.value.trim());
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="nodrag pointer-events-auto min-w-0 flex-1 truncate bg-transparent text-[11px] font-semibold outline-none"
            style={{ color: accent }}
          />
        ) : (
          <span
            className="pointer-events-auto truncate text-[11px] font-semibold"
            style={{ color: accent }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (onRename) setEditing(true);
            }}
            title={onRename ? 'Double-click to rename' : undefined}
          >
            {d.label || 'Untitled'}
          </span>
        )}
      </div>
    </div>
  );
}

export const ContainerNode = memo(ContainerNodeImpl);
