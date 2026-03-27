import { createInitialSnapshot, STORAGE_VERSION } from "./defaults";
import { listMeetingRecords, saveMeetingRecords } from "@/lib/cloudbase-service";

import { meetingToRecord, normalizeSnapshot, recordToMeeting, type MeetingRepository } from "./storage";

export class CloudBaseMeetingRepository implements MeetingRepository {
  async load() {
    const records = await listMeetingRecords();
    const meetings = records.map(recordToMeeting);

    if (meetings.length > 0) {
      return normalizeSnapshot({
        version: STORAGE_VERSION,
        selectedMeetingId: meetings[0]?.id ?? "",
        meetings,
      });
    }

    const initialSnapshot = createInitialSnapshot();
    await this.save(initialSnapshot);
    return initialSnapshot;
  }

  async save(snapshot: Parameters<MeetingRepository["save"]>[0]) {
    const normalized = normalizeSnapshot(snapshot);
    const records = normalized.meetings.map(meetingToRecord);
    await saveMeetingRecords(records);
  }
}
