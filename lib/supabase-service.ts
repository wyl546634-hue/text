import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { getBootstrapAdminEmails, getSupabaseServiceRoleKey, getSupabaseUrl, isSupabaseServiceConfigured } from "@/lib/supabase-config";
import type { MeetingPublicState, MeetingRecord, UserProfile, UserRole } from "@/features/seating/types";

const PUBLIC_STATE_BUCKET = "seat-public-state";
const PUBLIC_STATE_PATH = "meeting-state.json";

export function createServiceSupabaseClient() {
  const url = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase 服务端尚未配置，请先设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function authorizeRequest(request: Request) {
  if (!isSupabaseServiceConfigured()) {
    throw new Error("Supabase 服务端尚未配置。");
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!accessToken) {
    throw new Error("未提供登录凭证。");
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("登录状态已失效，请重新登录。");
  }

  const profile = await ensureProfile(supabase, data.user);

  return { supabase, user: data.user, profile };
}

export async function ensureProfile(supabase: SupabaseClient, user: User): Promise<UserProfile> {
  const { data: existing, error: fetchError } = await supabase
    .from("profiles")
    .select("id,email,role,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const normalizedEmail = user.email?.toLowerCase() ?? "";
  const adminEmails = getBootstrapAdminEmails();

  if (existing) {
    const nextRole: UserRole = adminEmails.includes(normalizedEmail) ? "admin" : (existing.role as UserRole);

    if (nextRole !== existing.role) {
      const { data: updated, error: updateError } = await supabase
        .from("profiles")
        .update({ role: nextRole, email: normalizedEmail, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("id,email,role,created_at,updated_at")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      return mapProfile(updated);
    }

    return mapProfile(existing);
  }

  const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "admin");
  const role: UserRole = adminEmails.includes(normalizedEmail) || (count ?? 0) === 0 ? "admin" : "member";

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: normalizedEmail,
      role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id,email,role,created_at,updated_at")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return mapProfile(inserted);
}

export function mapProfile(input: {
  id: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}): UserProfile {
  return {
    id: input.id,
    email: input.email,
    role: input.role as UserRole,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
  };
}

export function mapMeetingRowToRecord(row: Record<string, unknown>): MeetingRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    time: String(row.time ?? ""),
    location: String(row.location ?? ""),
    organizer: String(row.organizer ?? ""),
    is_published: Boolean(row.is_published),
    venue_config: row.venue_config as MeetingRecord["venue_config"],
    seating_rules: row.seating_rules as MeetingRecord["seating_rules"],
    people: (row.people as MeetingRecord["people"]) ?? [],
    regions: (row.regions as MeetingRecord["regions"]) ?? [],
    lines: (row.lines as MeetingRecord["lines"]) ?? [],
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function setMeetingPublicState(supabase: SupabaseClient, state: MeetingPublicState) {
  await ensurePublicStateBucket(supabase);
  const payload = Buffer.from(JSON.stringify(state), "utf8");
  const { error } = await supabase.storage.from(PUBLIC_STATE_BUCKET).upload(PUBLIC_STATE_PATH, payload, {
    upsert: true,
    contentType: "application/json",
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getMeetingPublicState(supabase: SupabaseClient): Promise<MeetingPublicState | null> {
  const { data, error } = await supabase.storage.from(PUBLIC_STATE_BUCKET).download(PUBLIC_STATE_PATH);

  if (error || !data) {
    return null;
  }

  const text = await data.text();
  const payload = JSON.parse(text) as Partial<MeetingPublicState>;
  return {
    selectedMeetingId: payload.selectedMeetingId ?? "",
    publishedMeetingIds: Array.isArray(payload.publishedMeetingIds) ? payload.publishedMeetingIds.filter((item): item is string => typeof item === "string") : [],
  };
}

async function ensurePublicStateBucket(supabase: SupabaseClient) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(error.message);
  }

  const exists = data.some((bucket) => bucket.name === PUBLIC_STATE_BUCKET);
  if (exists) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(PUBLIC_STATE_BUCKET, {
    public: false,
    fileSizeLimit: 1024,
  });

  if (createError && !createError.message.toLowerCase().includes("already exists")) {
    throw new Error(createError.message);
  }
}
