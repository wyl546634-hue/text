import { createId } from "@/lib/utils";

import type { LineGroup, Meeting, MeetingSnapshot, Region } from "./types";

export const STORAGE_KEY = "meeting_seating_data";
export const STORAGE_VERSION = 1;

export const REGION_COLORS = ["#2563eb", "#16a34a", "#f97316", "#db2777", "#0891b2", "#7c3aed"];
export const LINE_COLORS = ["#dc2626", "#7c3aed", "#ca8a04", "#ea580c", "#16a34a", "#2563eb", "#ec4899", "#0891b2"];

export function createDefaultRegions(): Region[] {
  return [
    { id: createId("region"), name: "总部", color: REGION_COLORS[0] },
    { id: createId("region"), name: "企业", color: REGION_COLORS[1] },
  ];
}

export function createDefaultLines(): LineGroup[] {
  return ["生产条线", "行政条线", "供应链条线", "人力条线", "纪检条线", "风控条线", "投发条线", "财务条线"].map(
    (name, index) => ({
      id: createId("line"),
      name,
      color: LINE_COLORS[index % LINE_COLORS.length],
    }),
  );
}

export function createDefaultMeeting(name = "默认会议", isPublished = true): Meeting {
  const now = new Date().toISOString();

  return {
    id: createId("meeting"),
    name,
    time: now,
    location: "主会场",
    organizer: "会务组",
    isPublished,
    venueConfig: {
      venueType: "large",
      rostrumCapacity: 5,
      audienceRows: 15,
      audienceBlocks: [5, 7, 5],
      seatOrderMode: "left-honor",
      groupMode: "none",
      lineZones: [],
    },
    people: [],
    seatingRules: {
      adjacencyMode: "none",
      separationRules: [],
      linePriorityOverrides: [],
    },
    regions: createDefaultRegions(),
    lines: createDefaultLines(),
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialSnapshot(): MeetingSnapshot {
  const meeting = createDefaultMeeting();

  return {
    version: STORAGE_VERSION,
    selectedMeetingId: meeting.id,
    meetings: [meeting],
  };
}
