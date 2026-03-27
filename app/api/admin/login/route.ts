import { NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, createAdminSessionToken, getAdminCookieOptions, verifyAdminCredentials } from "@/lib/admin-auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { username?: string; password?: string };
    const username = payload.username?.trim() ?? "";
    const password = payload.password ?? "";

    if (!verifyAdminCredentials(username, password)) {
      return NextResponse.json({ error: "账号或密码错误。" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(), getAdminCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "登录请求无效。" }, { status: 400 });
  }
}
