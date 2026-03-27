import { NextResponse, type NextRequest } from "next/server";

import { isAdminRequestAuthenticated } from "@/lib/admin-auth";
import { getCloudBaseRuntimeDiagnostics } from "@/lib/cloudbase-config";

export async function GET(request: NextRequest) {
  if (!isAdminRequestAuthenticated(request)) {
    return NextResponse.json({ error: "管理员登录状态已失效。" }, { status: 401 });
  }

  return NextResponse.json(getCloudBaseRuntimeDiagnostics());
}
