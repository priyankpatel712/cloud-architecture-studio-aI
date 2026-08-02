'use client';
import { memo, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { ANNOTATION_COLORS, type AnnotationNodeData } from '@/lib/canvas/model';

interface AnnotationNodeExtra {
  onContentChange?: (id: string, content: string) => void;
  onResizeEnd?: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * Annotation node (002 FR-014): text note or sticky. Double-click to edit inline;
 * style is a constrained color-token set; carries no cost and never reaches
 * providers. Movable and resizable like any node. Mutations flow up to Canvas
 * via `onContentChange`/`onResizeEnd` (injected by Canvas's nodeTypes wrapper)
 * so history/dirty tracking stays centralized.
 */
function AnnotationNodeImpl({ id, data, selected, onContentChange, onResizeEnd }: NodeProps & AnnotationNodeExtra) {
  const d = data as AnnotationNodeData;
  const [editing, setEditing] = useState(false);
  const colors = ANNOTATION_COLORS[d.color] ?? ANNOTATION_COLORS.default;
  const sticky = d.kind === 'sticky';

  return (
    <div
      className={
        sticky
          ? 'h-full w-full rounded-lg p-2 shadow-md'
          : 'h-full w-full rounded-lg border p-2'
      }
      style={{
        background: sticky ? colors.bg : 'transparent',
        borderColor: sticky ? 'transparent' : colors.border,
        transform: sticky ? 'rotate(-0.6deg)' : undefined,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={48}
        lineClassName="!border-transparent"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-[var(--color-primary)]"
        onResizeEnd={(_e, params) => onResizeEnd?.(id, params)}
      />
      {editing ? (
        <textarea
          autoFocus
          defaultValue={d.content}
          onBlur={(e) => {
            setEditing(false);
            onContentChange?.(id, e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
          aria-label="Edit annotation"
          className="nodrag h-full w-full resize-none bg-transparent text-xs leading-snug text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <p className="h-full w-full overflow-hidden whitespace-pre-wrap text-xs leading-snug text-[var(--color-text-primary)]">
          {d.content || <span className="text-[var(--color-text-secondary)]">Double-click to edit…</span>}
        </p>
      )}
    </div>
  );
}

export const AnnotationNode = memo(AnnotationNodeImpl);
