"use client";

import type { CSSProperties, ReactNode } from "react";
import { Grip, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { AssignedSeat, LineGroup, LineZonePreset, Region } from "@/features/seating/types";
import { cn, parsePositiveInt } from "@/lib/utils";

function getZoneLabel(zone: AssignedSeat["zone"]) {
  switch (zone) {
    case "rostrum":
      return "主席台";
    case "audience":
      return "台下";
    case "left":
      return "左侧";
    case "right":
      return "右侧";
    case "bottom":
      return "底部";
    case "block":
      return "分区";
    default:
      return "座位";
  }
}

export function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

export function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-xl shadow-slate-300/20 backdrop-blur sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function SeatCell({
  seat,
  adjustMode,
  line,
  selected,
  onClick,
}: {
  seat: AssignedSeat;
  adjustMode: boolean;
  line?: LineGroup;
  selected?: boolean;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seat.seatId,
    disabled: !adjustMode,
  });

  const style: CSSProperties = {
    gridRow: seat.displayRow,
    gridColumn: seat.displayCol,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 20 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={adjustMode ? onClick : undefined}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex min-h-[76px] select-none touch-none flex-col justify-between rounded-[22px] border p-3 shadow-sm transition",
        seat.person ? "border-slate-300 bg-white" : "border-dashed border-slate-300 bg-white/60",
        adjustMode ? "cursor-grab active:cursor-grabbing" : "",
        adjustMode && selected ? "ring-2 ring-sky-500 ring-offset-2" : "",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500">{getZoneLabel(seat.zone)}</span>
        {adjustMode ? <Grip className="size-4 text-slate-400 opacity-0 transition group-hover:opacity-100" /> : null}
      </div>

      {seat.person ? (
        <div
          className="rounded-2xl px-3 py-2 text-sm"
          style={{ backgroundColor: `${line?.color ?? "#cbd5e1"}1A`, color: line?.color ?? "#0f172a" }}
        >
          <div className="font-semibold">{seat.person.name}</div>
          <div className="mt-1 text-xs opacity-85">{seat.person.title || "未填写职务"}</div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">空座</div>
      )}
    </div>
  );
}

export function EditableTags<T extends Region | LineGroup>({
  items,
  onChange,
  onDelete,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_96px_72px]">
          <input
            value={item.name}
            onChange={(event) =>
              onChange(items.map((current) => (current.id === item.id ? { ...current, name: event.target.value } : current)))
            }
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <input
            type="color"
            value={item.color}
            onChange={(event) =>
              onChange(items.map((current) => (current.id === item.id ? { ...current, color: event.target.value } : current)))
            }
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-2"
          />
          <button type="button" onClick={() => onDelete(item.id)} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

export function LineZoneEditor({
  zone,
  lines,
  onChange,
  onDelete,
}: {
  zone: LineZonePreset;
  lines: LineGroup[];
  onChange: (zone: LineZonePreset) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-6">
      <select value={zone.lineId} onChange={(event) => onChange({ ...zone, lineId: event.target.value })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
        {lines.map((line) => (
          <option key={line.id} value={line.id}>
            {line.name}
          </option>
        ))}
      </select>
      <NumericInput value={zone.startRow} onChange={(value) => onChange({ ...zone, startRow: value })} label="起始排" />
      <NumericInput value={zone.endRow} onChange={(value) => onChange({ ...zone, endRow: value })} label="结束排" />
      <NumericInput value={zone.startCol} onChange={(value) => onChange({ ...zone, startCol: value })} label="起始列" />
      <NumericInput value={zone.endCol} onChange={(value) => onChange({ ...zone, endCol: value })} label="结束列" />
      <button type="button" onClick={onDelete} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
        <span className="inline-flex items-center gap-1">
          <Trash2 className="size-4" />
          删除
        </span>
      </button>
    </div>
  );
}

function NumericInput({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(parsePositiveInt(event.target.value, value))}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </label>
  );
}
