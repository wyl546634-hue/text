import { NextResponse, type NextRequest } from "next/server";

import { isAdminRequestAuthenticated } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isAdminRequestAuthenticated(request) });
}
