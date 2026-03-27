import { createInitialSnapshot, STORAGE_KEY, STORAGE_VERSION } from "./defaults";
import type { Meeting, MeetingRecord, MeetingSnapshot } from "./types";

export interface MeetingRepository {
  load(): Promise<MeetingSnapshot>;
  save(snapshot: MeetingSnapshot): Promise<void>;
}

export function normalizeMeeting(meeting: Meeting): Meeting {
  const normalizedVenueConfig =
    meeting.venueConfig.venueType !== "large"
      ? meeting.venueConfig
      : {
          ...meeting.venueConfig,
          groupMode: meeting.venueConfig.groupMode ?? "none",
        };

  return {
    ...meeting,
    isPublished: Boolean(meeting.isPublished),
    venueConfig: normalizedVenueConfig,
    seatingRules: {
      adjacencyMode: meeting.seatingRules?.adjacencyMode ?? "none",
      separationRules: meeting.seatingRules?.separationRules ?? [],
      linePriorityOverrides: meeting.seatingRules?.linePriorityOverrides ?? [],
    },
  };
}

function normalizePublishedMeetings(meetings: Meeting[]) {
  return meetings.map(normalizeMeeting);
}

export function normalizeSnapshot(input: MeetingSnapshot): MeetingSnapshot {
  const fallback = createInitialSnapshot();
  const selectedMeetingId = input.selectedMeetingId || input.meetings[0]?.id || fallback.selectedMeetingId;

  return {
    version: STORAGE_VERSION,
    selectedMeetingId,
    meetings: normalizePublishedMeetings(input.meetings ?? []),
  };
}

export function meetingToRecord(meeting: Meeting): MeetingRecord {
  const normalized = normalizeMeeting(meeting);

  return {
    id: normalized.id,
    name: normalized.name,
    time: normalized.time,
    location: normalized.location,
    organizer: normalized.organizer,
    is_published: normalized.isPublished,
    venue_config: normalized.venueConfig,
    seating_rules: normalized.seatingRules,
    people: normalized.people,
    regions: normalized.regions,
    lines: normalized.lines,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt,
  };
}

export function recordToMeeting(record: MeetingRecord): Meeting {
  return normalizeMeeting({
    id: record.id,
    name: record.name,
    time: record.time,
    location: record.location,
    organizer: record.organizer,
    isPublished: Boolean(record.is_published),
    venueConfig: record.venue_config,
    seatingRules: record.seating_rules,
    people: record.people ?? [],
    regions: record.regions ?? [],
    lines: record.lines ?? [],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

export class LocalStorageMeetingRepository {
  load() {
    if (typeof window === "undefined") {
      return createInitialSnapshot();
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialSnapshot();
    }

    try {
      const parsed = JSON.parse(raw) as MeetingSnapshot;
      if (!parsed || !Array.isArray(parsed.meetings) || parsed.meetings.length === 0) {
        return createInitialSnapshot();
      }

      return normalizeSnapshot(parsed);
    } catch {
      return createInitialSnapshot();
    }
  }

  save(snapshot: MeetingSnapshot) {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSnapshot(snapshot)));
  }

  hasStoredSnapshot() {
    if (typeof window === "undefined") {
      return false;
    }

    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  }

  clear() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export class AdminApiMeetingRepository implements MeetingRepository {
  async load() {
    const response = await fetch("/api/admin/snapshot", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      const message = await readApiError(response, "读取云端会议失败。");
      throw new Error(message);
    }

    const payload = (await response.json()) as MeetingSnapshot;
    return normalizeSnapshot(payload);
  }

  async save(snapshot: MeetingSnapshot) {
    const response = await fetch("/api/admin/snapshot", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeSnapshot(snapshot)),
    });

    if (!response.ok) {
      const message = await readApiError(response, "保存云端会议失败。");
      throw new Error(message);
    }
  }
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}
