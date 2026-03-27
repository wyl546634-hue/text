import { PublishedMeetingPage } from "@/features/seating/components/published-meeting-page";
import { recordToMeeting } from "@/features/seating/storage";
import { getMeetingPublicState, listMeetingRecords } from "@/lib/cloudbase-service";
import type { Meeting } from "@/features/seating/types";

export const dynamic = "force-dynamic";

async function getPublishedMeetings(): Promise<{ meetings: Meeting[]; activeMeetingId: string }> {
  try {
    const state = await getMeetingPublicState();
    const publishedMeetingIds = state?.publishedMeetingIds ?? [];

    if (publishedMeetingIds.length === 0) {
      return { meetings: [], activeMeetingId: "" };
    }

    const order = new Map(publishedMeetingIds.map((id, index) => [id, index]));
    const meetings = (await listMeetingRecords())
      .filter((record) => publishedMeetingIds.includes(record.id))
      .map((record) => recordToMeeting(record))
      .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));

    const activeMeetingId = meetings.some((meeting) => meeting.id === state?.selectedMeetingId)
      ? state?.selectedMeetingId ?? meetings[0]?.id ?? ""
      : meetings[0]?.id ?? "";

    return { meetings, activeMeetingId };
  } catch {
    return { meetings: [], activeMeetingId: "" };
  }
}

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const meetingIdFromQuery = typeof resolvedSearchParams.meeting === "string" ? resolvedSearchParams.meeting : "";
  const { meetings, activeMeetingId } = await getPublishedMeetings();
  const finalActiveMeetingId = meetings.some((meeting) => meeting.id === meetingIdFromQuery)
    ? meetingIdFromQuery
    : activeMeetingId;

  return <PublishedMeetingPage meetings={meetings} activeMeetingId={finalActiveMeetingId} />;
}
