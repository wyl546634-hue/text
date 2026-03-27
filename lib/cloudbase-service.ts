import tcb from "@cloudbase/node-sdk";

import type { MeetingPublicState, MeetingRecord } from "@/features/seating/types";
import {
  getCloudBaseEnvId,
  getCloudBaseRegion,
  getCloudBaseSecretId,
  getCloudBaseSecretKey,
  getCloudBaseSessionToken,
  isCloudBaseConfigured,
} from "@/lib/cloudbase-config";

const MEETINGS_COLLECTION = "meetings";
const PUBLIC_STATE_COLLECTION = "public_state";
const PUBLIC_STATE_DOC_ID = "default";

type CloudBaseDb = ReturnType<ReturnType<typeof tcb.init>["database"]>;

let cloudbaseDb: CloudBaseDb | null = null;

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function createCloudBaseDb() {
  if (cloudbaseDb) {
    return cloudbaseDb;
  }

  const env = getCloudBaseEnvId();
  if (!env) {
    throw new Error("CloudBase 尚未配置，请先设置 CLOUDBASE_ENV_ID。");
  }

  const secretId = getCloudBaseSecretId();
  const secretKey = getCloudBaseSecretKey();
  const sessionToken = getCloudBaseSessionToken();
  const region = getCloudBaseRegion();
  const app = tcb.init({
    env,
    ...(region ? { region } : {}),
    ...(secretId && secretKey
      ? {
          secretId,
          secretKey,
          ...(sessionToken ? { sessionToken } : {}),
        }
      : {}),
  });

  cloudbaseDb = app.database();
  return cloudbaseDb;
}

export function isCloudBaseServiceConfigured() {
  return isCloudBaseConfigured();
}

export async function ensureCloudBaseCollections() {
  const db = createCloudBaseDb();

  try {
    await db.createCollection(MEETINGS_COLLECTION);
  } catch (error) {
    const message = toErrorMessage(error, "");
    if (!message.toLowerCase().includes("exist")) {
      // ignore when collection already exists
    }
  }

  try {
    await db.createCollection(PUBLIC_STATE_COLLECTION);
  } catch (error) {
    const message = toErrorMessage(error, "");
    if (!message.toLowerCase().includes("exist")) {
      // ignore when collection already exists
    }
  }
}

export function mapMeetingDocToRecord(doc: Record<string, unknown>): MeetingRecord {
  return {
    id: String(doc._id ?? doc.id ?? ""),
    name: String(doc.name ?? ""),
    time: String(doc.time ?? ""),
    location: String(doc.location ?? ""),
    organizer: String(doc.organizer ?? ""),
    is_published: Boolean(doc.is_published),
    venue_config: doc.venue_config as MeetingRecord["venue_config"],
    seating_rules: doc.seating_rules as MeetingRecord["seating_rules"],
    people: (doc.people as MeetingRecord["people"]) ?? [],
    regions: (doc.regions as MeetingRecord["regions"]) ?? [],
    lines: (doc.lines as MeetingRecord["lines"]) ?? [],
    created_at: String(doc.created_at ?? ""),
    updated_at: String(doc.updated_at ?? ""),
  };
}

export async function listMeetingRecords() {
  await ensureCloudBaseCollections();
  const db = createCloudBaseDb();
  const { data } = await db.collection(MEETINGS_COLLECTION).orderBy("updated_at", "desc").limit(1000).get();
  return Array.isArray(data) ? data.map((doc) => mapMeetingDocToRecord(doc as Record<string, unknown>)) : [];
}

export async function saveMeetingRecords(records: MeetingRecord[]) {
  await ensureCloudBaseCollections();
  const db = createCloudBaseDb();
  const collection = db.collection(MEETINGS_COLLECTION);
  const current = await collection.limit(1000).get();
  const currentIds = Array.isArray(current.data)
    ? current.data.map((doc) => String((doc as Record<string, unknown>)._id ?? ""))
    : [];
  const nextIds = records.map((record) => record.id);

  for (const record of records) {
    await collection.doc(record.id).set({
      _id: record.id,
      ...record,
    });
  }

  const obsoleteIds = currentIds.filter((id) => id && !nextIds.includes(id));
  for (const id of obsoleteIds) {
    await collection.doc(id).remove();
  }
}

export async function getMeetingPublicState(): Promise<MeetingPublicState | null> {
  await ensureCloudBaseCollections();
  const db = createCloudBaseDb();

  try {
    const result = await db.collection(PUBLIC_STATE_COLLECTION).doc(PUBLIC_STATE_DOC_ID).get();
    const doc = result.data?.[0] as Record<string, unknown> | undefined;
    if (!doc) {
      return null;
    }

    return {
      selectedMeetingId: String(doc.selectedMeetingId ?? ""),
      publishedMeetingIds: Array.isArray(doc.publishedMeetingIds)
        ? doc.publishedMeetingIds.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export async function setMeetingPublicState(state: MeetingPublicState) {
  await ensureCloudBaseCollections();
  const db = createCloudBaseDb();
  await db.collection(PUBLIC_STATE_COLLECTION).doc(PUBLIC_STATE_DOC_ID).set({
    _id: PUBLIC_STATE_DOC_ID,
    selectedMeetingId: state.selectedMeetingId,
    publishedMeetingIds: state.publishedMeetingIds,
    updatedAt: new Date().toISOString(),
  });
}
