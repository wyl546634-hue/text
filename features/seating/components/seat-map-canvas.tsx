"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";

import { SeatCell } from "@/features/seating/components/ui-kit";
import type { AssignedSeat, LineGroup, Meeting } from "@/features/seating/types";

export function SeatMapCanvas({
  meeting,
  assignments,
  adjustMode,
  onDragEnd,
  selectedSeatId,
  onSeatClick,
}: {
  meeting: Meeting;
  assignments: AssignedSeat[];
  adjustMode: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  selectedSeatId?: string | null;
  onSeatClick?: (seatId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panStateRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );
  const maxCol = assignments.reduce((max, seat) => Math.max(max, seat.displayCol), 1);
  const maxRow = assignments.reduce((max, seat) => Math.max(max, seat.displayRow), 1);

  function lineById(lineId?: string): LineGroup | undefined {
    return meeting.lines.find((line) => line.id === lineId);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (adjustMode || event.button !== 0 || !viewportRef.current) return;
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewportRef.current.scrollLeft,
      scrollTop: viewportRef.current.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (adjustMode || !viewportRef.current || !panStateRef.current || panStateRef.current.pointerId !== event.pointerId) return;
    viewportRef.current.scrollLeft = panStateRef.current.scrollLeft - (event.clientX - panStateRef.current.startX);
    viewportRef.current.scrollTop = panStateRef.current.scrollTop - (event.clientY - panStateRef.current.startY);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panStateRef.current || panStateRef.current.pointerId !== event.pointerId) return;
    panStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={assignments.map((seat) => seat.seatId)} strategy={rectSortingStrategy}>
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className={adjustMode ? "overflow-auto" : "overflow-auto cursor-grab active:cursor-grabbing"}
        >
          <div
            className="relative min-w-[720px] p-6"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(maxCol, 8)}, minmax(72px, 1fr))`,
              gridTemplateRows: `repeat(${Math.max(maxRow, 6)}, minmax(76px, auto))`,
              gap: "14px",
            }}
          >
            {meeting.venueConfig.venueType !== "large" ? (
              <div
                className="pointer-events-none rounded-[24px] border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500"
                style={{
                  gridColumn: meeting.venueConfig.venueType === "u_shape" ? "2 / span 3" : "2 / span 5",
                  gridRow: meeting.venueConfig.venueType === "u_shape" ? "3 / span 3" : `3 / span ${Math.max(meeting.venueConfig.innerHeight, 2)}`,
                }}
              >
                {meeting.venueConfig.venueType === "u_shape"
                  ? "中间过道"
                  : `内圈空心区 ${meeting.venueConfig.innerWidth} x ${meeting.venueConfig.innerHeight}`}
              </div>
            ) : null}

            {assignments.map((seat) => (
              <SeatCell
                key={seat.seatId}
                seat={seat}
                adjustMode={adjustMode}
                line={lineById(seat.person?.lineId)}
                selected={selectedSeatId === seat.seatId}
                onClick={() => onSeatClick?.(seat.seatId)}
              />
            ))}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  );
}
