import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "seat_admin_session";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";

function getAdminUsername() {
  return process.env.ADMIN_USERNAME ?? DEFAULT_ADMIN_USERNAME;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
}

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? process.env.CLOUDBASE_SECRET_KEY ?? process.env.CLOUDBASE_ENV_ID ?? "seat-admin-secret";
}

function sign(value: string) {
  return createHmac("sha256", getAdminSessionSecret()).update(value).digest("hex");
}

export function verifyAdminCredentials(username: string, password: string) {
  return username === getAdminUsername() && password === getAdminPassword();
}

export function createAdminSessionToken() {
  const payload = JSON.stringify({
    username: getAdminUsername(),
    issuedAt: Date.now(),
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAdminSessionToken(token?: string | null) {
  if (!token) return false;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  const expected = sign(encoded);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { username?: string };
    return payload.username === getAdminUsername();
  } catch {
    return false;
  }
}

export function isAdminRequestAuthenticated(request: NextRequest) {
  return verifyAdminSessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export function getAdminCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
