import { NextResponse, type NextRequest } from "next/server";

import { normalizeSnapshot } from "@/features/seating/storage";
import { CloudBaseMeetingRepository } from "@/features/seating/storage-cloudbase";
import type { MeetingSnapshot } from "@/features/seating/types";
import { isAdminRequestAuthenticated } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!isAdminRequestAuthenticated(request)) {
    return NextResponse.json({ error: "未登录或登录已失效。" }, { status: 401 });
  }

  try {
    const repository = new CloudBaseMeetingRepository();
    const snapshot = await repository.load();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取云端会议失败。" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isAdminRequestAuthenticated(request)) {
    return NextResponse.json({ error: "未登录或登录已失效。" }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as MeetingSnapshot;
    const repository = new CloudBaseMeetingRepository();
    await repository.save(normalizeSnapshot(payload));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存云端会议失败。" }, { status: 500 });
  }
}
