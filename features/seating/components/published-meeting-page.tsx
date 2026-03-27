"use client";

import { useMemo } from "react";
import { CalendarDays, ExternalLink, MapPin, Sheet, Users } from "lucide-react";

import { assignMeetingSeats } from "@/features/seating/assignment";
import { SeatMapCanvas } from "@/features/seating/components/seat-map-canvas";
import { EmptyState } from "@/features/seating/components/product-ui";
import { Panel, SummaryCard } from "@/features/seating/components/ui-kit";
import type { Meeting } from "@/features/seating/types";

function formatSummaryTime(value: string) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getVenueLabel(venueType: Meeting["venueConfig"]["venueType"]) {
  if (venueType === "large") return "大型报告厅";
  if (venueType === "u_shape") return "U 型会议室";
  return "回形布局";
}

export function PublishedMeetingPage({
  meetings,
  activeMeetingId,
}: {
  meetings: Meeting[];
  activeMeetingId: string;
}) {
  const currentMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === activeMeetingId) ?? meetings[0] ?? null,
    [activeMeetingId, meetings],
  );
  const assignments = useMemo(() => (currentMeeting ? assignMeetingSeats(currentMeeting) : []), [currentMeeting]);
  const unseatedPeople = useMemo(() => {
    if (!currentMeeting) return [];
    const assignedPersonIds = new Set(assignments.filter((seat) => seat.person).map((seat) => seat.person!.id));
    return currentMeeting.people.filter((person) => person.status === "normal" && !assignedPersonIds.has(person.id));
  }, [assignments, currentMeeting]);

  if (!currentMeeting) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_46%,#f8fafc_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <EmptyState
            title="当前还没有公开会议"
            description="管理员发布会议后，公开首页才会显示可查看的座位图。"
          />
        </div>
      </main>
    );
  }

  const activePeopleCount = currentMeeting.people.filter((person) => person.status === "normal").length;
  const absentPeopleCount = currentMeeting.people.filter((person) => person.status === "absent").length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_46%,#f8fafc_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-xl shadow-slate-300/25 backdrop-blur">
          <div className="flex flex-col gap-5 border-b border-slate-200/80 px-5 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-900">
                  智能排座系统
                </span>
                <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-900">
                  公开查看页
                </span>
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  {currentMeeting.name}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  当前页面仅展示管理员已发布的会议座位图。你可以在下方切换不同会议查看。
                </p>
              </div>
            </div>
            <a
              href="/admin"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <ExternalLink className="size-4" />
              管理员入口
            </a>
          </div>
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-8">
            <SummaryCard icon={<CalendarDays className="size-4" />} label="会议时间" value={formatSummaryTime(currentMeeting.time)} />
            <SummaryCard icon={<MapPin className="size-4" />} label="会议地点" value={currentMeeting.location || "未设置"} />
            <SummaryCard
              icon={<Users className="size-4" />}
              label="参会情况"
              value={`${activePeopleCount} 人正常 / ${absentPeopleCount} 人缺席`}
            />
            <SummaryCard icon={<Sheet className="size-4" />} label="会场类型" value={getVenueLabel(currentMeeting.venueConfig.venueType)} />
          </div>
          {meetings.length > 1 ? (
            <div className="border-t border-slate-200/80 px-5 py-4 lg:px-8">
              <div className="mb-3 text-sm font-medium text-slate-700">可查看会议</div>
              <div className="flex flex-wrap gap-2">
                {meetings.map((meeting) => {
                  const isActive = meeting.id === currentMeeting.id;
                  return (
                    <a
                      key={meeting.id}
                      href={`/?meeting=${meeting.id}`}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-slate-950 text-white shadow-lg shadow-slate-300"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {meeting.name}
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Panel title="座位总览" description="公开页面只展示已发布结果，不提供拖拽或编辑能力。">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <span className="text-slate-500">主席台已安排</span>
                  <span className="font-semibold text-slate-900">
                    {assignments.filter((seat) => seat.areaType === "rostrum" && seat.person).length} /{" "}
                    {assignments.filter((seat) => seat.areaType === "rostrum").length}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <span className="text-slate-500">台下已安排</span>
                  <span className="font-semibold text-slate-900">
                    {assignments.filter((seat) => seat.areaType === "audience" && seat.person).length} /{" "}
                    {assignments.filter((seat) => seat.areaType === "audience").length}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <span className="text-slate-500">未安排人员</span>
                  <span className="font-semibold text-slate-900">{unseatedPeople.length} 人</span>
                </div>
              </div>
            </Panel>
            <Panel title="未安排人员" description="这些人员尚未出现在当前公开座位图中。">
              {unseatedPeople.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  当前没有未安排人员
                </div>
              ) : (
                <div className="space-y-3">
                  {unseatedPeople.map((person) => (
                    <div key={person.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <div className="font-medium text-slate-900">{person.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{person.title || "未填写职务"}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
          <Panel title="座位图" description="公开访问仅能查看管理员已发布的会议座位安排。">
            <SeatMapCanvas meeting={currentMeeting} assignments={assignments} adjustMode={false} onDragEnd={() => undefined} />
          </Panel>
        </section>
      </div>
    </main>
  );
}
