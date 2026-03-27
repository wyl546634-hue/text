import { NextResponse, type NextRequest } from "next/server";

import type { MeetingPublicState } from "@/features/seating/types";
import { isAdminRequestAuthenticated } from "@/lib/admin-auth";
import { getMeetingPublicState, setMeetingPublicState } from "@/lib/cloudbase-service";

function emptyState(): MeetingPublicState {
  return { selectedMeetingId: "", publishedMeetingIds: [] };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAdminRequestAuthenticated(request)) {
      return NextResponse.json({ error: "管理员登录状态已失效。" }, { status: 401 });
    }

    const state = await getMeetingPublicState();
    return NextResponse.json(state ?? emptyState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取公开状态失败。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAdminRequestAuthenticated(request)) {
      return NextResponse.json({ error: "管理员登录状态已失效。" }, { status: 401 });
    }

    const payload = (await request.json()) as Partial<MeetingPublicState>;
    const state: MeetingPublicState = {
      selectedMeetingId: payload.selectedMeetingId?.trim() ?? "",
      publishedMeetingIds: Array.isArray(payload.publishedMeetingIds)
        ? payload.publishedMeetingIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
    };

    await setMeetingPublicState(state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存公开状态失败。" }, { status: 500 });
  }
}
