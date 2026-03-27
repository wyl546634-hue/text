"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, FormEvent, ReactNode, RefObject, SetStateAction } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarDays,
  Download,
  LayoutGrid,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Plus,
  Presentation,
  Settings2,
  ShieldCheck,
  Sheet,
  Trash2,
  Upload,
  Users,
  WandSparkles,
} from "lucide-react";
import { toPng } from "html-to-image";
import type { DragEndEvent } from "@dnd-kit/core";
import Image from "next/image";

import { parsePeopleExcel } from "@/features/import-export/excel";
import { downloadPeopleImportTemplate } from "@/features/import-export/template";
import { assignMeetingSeats, swapPeopleBySeats } from "@/features/seating/assignment";
import { ConfirmDialog, EmptyState, LoadingPill, StatusBanner, type StatusTone } from "@/features/seating/components/product-ui";
import { SeatMapCanvas } from "@/features/seating/components/seat-map-canvas";
import { EditableTags, Field, LineZoneEditor, Panel, RuleRow, StatRow, SummaryCard } from "@/features/seating/components/ui-kit";
import { createDefaultMeeting, LINE_COLORS, REGION_COLORS } from "@/features/seating/defaults";
import { createDemoPeople } from "@/features/seating/demo";
import { AdminApiMeetingRepository, LocalStorageMeetingRepository, normalizeSnapshot } from "@/features/seating/storage";
import type {
  AdjacencyRuleMode,
  AreaType,
  AssignedSeat,
  DuplicateHandling,
  GroupMode,
  LineGroup,
  LineZonePreset,
  Meeting,
  MeetingPublicState,
  MeetingSnapshot,
  Person,
  Region,
  SeparationRule,
  UserProfile,
  VenueType,
  VisionRecognitionResult,
} from "@/features/seating/types";
import { applyVisionResultToMeeting, safeParseVisionResult } from "@/features/vision/utils";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { cn, createId, formatDateTimeInput, parsePositiveInt, toIsoDateTime } from "@/lib/utils";

type TabId = "meetings" | "seats" | "people" | "settings";
type ImportMode = "append" | "replace";
type PeopleFilter = "all" | "rostrum" | "audience" | "absent";
type VisionApplyMode = "replace" | "merge";
type SaveState = "idle" | "loading" | "saving" | "saved" | "error";
type AdminSession = Session;
type NewPersonDraft = { name: string; title: string; areaType: AreaType; regionId: string; lineId: string };
type BannerState = { tone: StatusTone; title: string; description?: string } | null;
type ConfirmState = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (accepted: boolean) => void;
} | null;
type VisionState = {
  previewUrl: string;
  fileName: string;
  loading: boolean;
  result: VisionRecognitionResult | null;
  error: string | null;
};

const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "meetings", label: "会议列表", icon: <Presentation className="size-4" /> },
  { id: "seats", label: "座位图", icon: <LayoutGrid className="size-4" /> },
  { id: "people", label: "人员管理", icon: <Users className="size-4" /> },
  { id: "settings", label: "会议设置", icon: <Settings2 className="size-4" /> },
];

const getVenueLabel = (venueType: VenueType) =>
  venueType === "large" ? "大型报告厅" : venueType === "u_shape" ? "U 型会议室" : "回形布局";
const getGroupModeLabel = (mode: GroupMode) =>
  mode === "none" ? "按优先级" : mode === "region" ? "按企业/区域" : mode === "line" ? "按条线" : "先区域后条线";
const getAreaLabel = (areaType: AreaType) => (areaType === "rostrum" ? "主席台" : "台下");

function touchMeeting(meeting: Meeting) {
  return { ...meeting, updatedAt: new Date().toISOString() };
}

function ensureSnapshot(snapshot: MeetingSnapshot) {
  if (snapshot.meetings.length > 0) return snapshot;
  const fallback = createDefaultMeeting();
  return { version: snapshot.version, selectedMeetingId: fallback.id, meetings: [fallback] };
}

function createVenueConfig(type: VenueType): Meeting["venueConfig"] {
  if (type === "large") {
    return { venueType: "large", rostrumCapacity: 5, audienceRows: 15, audienceBlocks: [5, 7, 5], seatOrderMode: "left-honor", groupMode: "none", lineZones: [] };
  }
  if (type === "u_shape") {
    return { venueType: "u_shape", rostrumCapacity: 5, leftSeats: 8, rightSeats: 8, groupMode: "none" };
  }
  return { venueType: "hollow_square", rostrumCapacity: 5, leftSeats: 6, rightSeats: 6, bottomSeats: 8, innerWidth: 4, innerHeight: 2, groupMode: "none" };
}

function formatSummaryTime(value: string) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function nextPriority(people: Person[], areaType: AreaType) {
  return Math.max(0, ...people.filter((person) => person.areaType === areaType).map((person) => person.priority)) + 1;
}

function reindexPeople(people: Person[]) {
  const rostrum = people.filter((person) => person.areaType === "rostrum").sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, "zh-CN")).map((person, index) => ({ ...person, priority: index + 1 }));
  const audience = people.filter((person) => person.areaType === "audience").sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, "zh-CN")).map((person, index) => ({ ...person, priority: index + 1 }));
  return [...rostrum, ...audience];
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const previewWarnings = (warnings: string[]) => warnings.slice(0, 3).join(" ");
const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
function mapAuthErrorMessage(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) return "账号或密码不正确。";
  if (normalized.includes("email not confirmed")) return "当前项目仍启用了邮箱确认，请先在 Supabase 关闭 Confirm email。";
  if (normalized.includes("user already registered")) return "该邮箱已注册，请直接登录。";
  if (normalized.includes("failed to fetch") || normalized.includes("network")) return "网络连接失败，请检查网络或 Supabase 配置。";
  if (normalized.includes("password should be at least 6 characters")) return "密码至少需要 6 位。";

  return message;
}

function createSupabaseClientSafely() {
  return { client: null, error: null as string | null };
  try {
    return { client: createBrowserSupabaseClient(), error: null as string | null };
  } catch (error) {
    return { client: null, error: getErrorMessage(error, "Supabase 尚未配置。") };
  }
}

function mapProfileRow(row: { id: string; email?: string | null; role?: string | null; created_at?: string | null; updated_at?: string | null }): UserProfile {
  return { id: row.id, email: row.email ?? "", role: row.role === "admin" ? "admin" : "member", createdAt: row.created_at ?? new Date().toISOString(), updatedAt: row.updated_at ?? new Date().toISOString() };
}

async function ensureBrowserProfile(client: SupabaseClient, user: Session["user"]) {
  const { data, error } = await client.from("profiles").select("id,email,role,created_at,updated_at").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return mapProfileRow(data);
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await client.from("profiles").upsert({ id: user.id, email: user.email ?? "", role: "member", created_at: now, updated_at: now }, { onConflict: "id" }).select("id,email,role,created_at,updated_at").single();
  if (insertError) throw new Error(insertError.message);
  return mapProfileRow(inserted);
}

function mergeSnapshots(remote: MeetingSnapshot, local: MeetingSnapshot) {
  const mergedById = new Map(remote.meetings.map((meeting) => [meeting.id, meeting]));
  local.meetings.forEach((meeting) => mergedById.set(meeting.id, meeting));
  const meetings = [...mergedById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selectedMeetingId = meetings.some((meeting) => meeting.id === local.selectedMeetingId) ? local.selectedMeetingId : remote.selectedMeetingId || meetings[0]?.id || "";
  return ensureSnapshot(normalizeSnapshot({ version: remote.version, selectedMeetingId, meetings }));
}

function emptyPublicState(): MeetingPublicState {
  return { selectedMeetingId: "", publishedMeetingIds: [] };
}

export function SeatPlannerApp() {
  const localRepository = useMemo(() => new LocalStorageMeetingRepository(), []);
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null);
  const [publicState, setPublicState] = useState<MeetingPublicState>(emptyPublicState);
  const [legacySnapshot, setLegacySnapshot] = useState<MeetingSnapshot | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<BannerState>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("meetings");
  const [adjustMode, setAdjustMode] = useState(false);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [importAreaType, setImportAreaType] = useState<AreaType>("audience");
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateHandling>("skip");
  const [newMeetingName, setNewMeetingName] = useState("");
  const [banner, setBanner] = useState<BannerState>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [newRegionName, setNewRegionName] = useState("");
  const [newLineName, setNewLineName] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [newPerson, setNewPerson] = useState<NewPersonDraft>({ name: "", title: "", areaType: "audience", regionId: "", lineId: "" });
  const [visionState, setVisionState] = useState<VisionState>({ previewUrl: "", fileName: "", loading: false, result: null, error: null });
  const [visionApplyMode, setVisionApplyMode] = useState<VisionApplyMode>("merge");
  const exportRef = useRef<HTMLDivElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const hydratedSnapshotRef = useRef(false);
  const lastSavedSnapshotRef = useRef("");
  const lastPublicMeetingSyncRef = useRef("");
  const remoteRepository = useMemo(() => new AdminApiMeetingRepository(), []);
  const showBanner = (tone: StatusTone, title: string, description?: string) => setBanner({ tone, title, description });
  const requestConfirm = (config: Omit<NonNullable<ConfirmState>, "resolve">) => new Promise<boolean>((resolve) => setConfirmState({ ...config, resolve }));

  useEffect(() => {
    const { client, error } = createSupabaseClientSafely();
    setSupabaseClient(client);
    setSupabaseError(error);
    if (!client) {
      setAuthReady(true);
      return;
    }

    let active = true;
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setAuthFeedback({ tone: "error", title: "读取登录状态失败", description: sessionError.message });
      }
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        hydratedSnapshotRef.current = false;
        lastSavedSnapshotRef.current = "";
        lastPublicMeetingSyncRef.current = "";
        setProfile(null);
        setSnapshot(null);
        setPublicState(emptyPublicState());
        setLegacySnapshot(null);
        setSaveState("idle");
        setSaveError(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabaseClient || !remoteRepository) return;
    let cancelled = false;

    const loadCloudData = async () => {
      try {
        setSaveState("loading");
        setSaveError(null);
        const nextProfile = await ensureBrowserProfile(supabaseClient, session.user);
        const loadedSnapshot = ensureSnapshot(await remoteRepository.load());
        const publicStateResponse = await fetch("/api/admin/public-state", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const nextPublicState = publicStateResponse.ok
          ? ((await publicStateResponse.json()) as MeetingPublicState)
          : emptyPublicState();
        const publishedMeetingIds = nextPublicState.publishedMeetingIds.filter((meetingId) =>
          loadedSnapshot.meetings.some((meeting) => meeting.id === meetingId),
        );
        const selectedMeetingId = loadedSnapshot.meetings.some((meeting) => meeting.id === nextPublicState.selectedMeetingId)
          ? nextPublicState.selectedMeetingId
          : loadedSnapshot.selectedMeetingId;
        const hydratedSnapshot = ensureSnapshot({
          ...loadedSnapshot,
          selectedMeetingId,
          meetings: loadedSnapshot.meetings.map((meeting) => ({
            ...meeting,
            isPublished: publishedMeetingIds.includes(meeting.id),
          })),
        });
        const serialized = JSON.stringify(normalizeSnapshot(hydratedSnapshot));
        const storedLegacy = localRepository.hasStoredSnapshot() ? localRepository.load() : null;
        if (cancelled) return;
        hydratedSnapshotRef.current = true;
        lastSavedSnapshotRef.current = serialized;
        lastPublicMeetingSyncRef.current = JSON.stringify({
          selectedMeetingId,
          publishedMeetingIds,
        });
        setProfile(nextProfile);
        setSnapshot(hydratedSnapshot);
        setPublicState({ selectedMeetingId, publishedMeetingIds });
        setLegacySnapshot(storedLegacy && storedLegacy.meetings.length > 0 ? storedLegacy : null);
        setSaveState("saved");
      } catch (error) {
        if (cancelled) return;
        const message = getErrorMessage(error, "读取云端会议失败，请稍后重试。");
        setSaveState("error");
        setSaveError(message);
        setBanner({ tone: "error", title: "读取云端会议失败", description: message });
      }
    };

    void loadCloudData();
    return () => {
      cancelled = true;
    };
  }, [localRepository, remoteRepository, session, supabaseClient]);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/admin/session", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({ authenticated: false }))) as { authenticated?: boolean };
        if (cancelled) return;

        if (payload.authenticated) {
          setSession({} as Session);
          setProfile({
            id: "admin",
            email: "admin",
            role: "admin",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else {
          setSession(null);
          setProfile(null);
        }

        setAuthReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setSession(null);
        setProfile(null);
        setAuthReady(true);
        setAuthFeedback({
          tone: "error",
          title: "读取登录状态失败",
          description: getErrorMessage(error, "请稍后重试。"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const loadAdminData = async () => {
      try {
        setSaveState("loading");
        setSaveError(null);
        const loadedSnapshot = ensureSnapshot(await remoteRepository.load());
        const publicStateResponse = await fetch("/api/admin/public-state", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const nextPublicState = publicStateResponse.ok
          ? ((await publicStateResponse.json()) as MeetingPublicState)
          : emptyPublicState();
        const publishedMeetingIds = nextPublicState.publishedMeetingIds.filter((meetingId) =>
          loadedSnapshot.meetings.some((meeting) => meeting.id === meetingId),
        );
        const selectedMeetingId = loadedSnapshot.meetings.some((meeting) => meeting.id === nextPublicState.selectedMeetingId)
          ? nextPublicState.selectedMeetingId
          : loadedSnapshot.selectedMeetingId;
        const hydratedSnapshot = ensureSnapshot({
          ...loadedSnapshot,
          selectedMeetingId,
          meetings: loadedSnapshot.meetings.map((meeting) => ({
            ...meeting,
            isPublished: publishedMeetingIds.includes(meeting.id),
          })),
        });
        const serialized = JSON.stringify(normalizeSnapshot(hydratedSnapshot));
        const storedLegacy = localRepository.hasStoredSnapshot() ? localRepository.load() : null;
        if (cancelled) return;
        hydratedSnapshotRef.current = true;
        lastSavedSnapshotRef.current = serialized;
        lastPublicMeetingSyncRef.current = JSON.stringify({
          selectedMeetingId,
          publishedMeetingIds,
        });
        setSnapshot(hydratedSnapshot);
        setPublicState({ selectedMeetingId, publishedMeetingIds });
        setLegacySnapshot(storedLegacy && storedLegacy.meetings.length > 0 ? storedLegacy : null);
        setSaveState("saved");
      } catch (error) {
        if (cancelled) return;
        const message = getErrorMessage(error, "读取云端会议失败，请稍后重试。");
        setSaveState("error");
        setSaveError(message);
        setBanner({ tone: "error", title: "读取云端会议失败", description: message });
      }
    };

    void loadAdminData();
    return () => {
      cancelled = true;
    };
  }, [localRepository, remoteRepository, session]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 4500);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const currentMeeting = useMemo(() => !snapshot ? null : snapshot.meetings.find((meeting) => meeting.id === snapshot.selectedMeetingId) ?? snapshot.meetings[0] ?? null, [snapshot]);

  useEffect(() => {
    if (!currentMeeting) return;
    setNewPerson((current) => ({
      ...current,
      regionId: currentMeeting.regions.some((item) => item.id === current.regionId) ? current.regionId : currentMeeting.regions[0]?.id ?? "",
      lineId: currentMeeting.lines.some((item) => item.id === current.lineId) ? current.lineId : currentMeeting.lines[0]?.id ?? "",
    }));
  }, [currentMeeting]);

  const normalizedNewPerson = useMemo(() => !currentMeeting ? newPerson : { ...newPerson, regionId: currentMeeting.regions.some((item) => item.id === newPerson.regionId) ? newPerson.regionId : currentMeeting.regions[0]?.id ?? "", lineId: currentMeeting.lines.some((item) => item.id === newPerson.lineId) ? newPerson.lineId : currentMeeting.lines[0]?.id ?? "" }, [currentMeeting, newPerson]);
  const assignments = useMemo(() => (currentMeeting ? assignMeetingSeats(currentMeeting) : []), [currentMeeting]);
  const assignedIds = useMemo(() => new Set(assignments.map((seat) => seat.person?.id).filter((id): id is string => Boolean(id))), [assignments]);
  const unseatedPeople = useMemo(() => !currentMeeting ? [] : currentMeeting.people.filter((person) => person.status === "normal" && !assignedIds.has(person.id)).sort((left, right) => left.areaType.localeCompare(right.areaType) || left.priority - right.priority), [assignedIds, currentMeeting]);
  const filteredPeople = useMemo(() => { if (!currentMeeting) return []; const keyword = peopleSearch.trim().toLowerCase(); return [...currentMeeting.people].filter((person) => { if (peopleFilter === "rostrum" && person.areaType !== "rostrum") return false; if (peopleFilter === "audience" && person.areaType !== "audience") return false; if (peopleFilter === "absent" && person.status !== "absent") return false; if (!keyword) return true; const regionName = currentMeeting.regions.find((region) => region.id === person.regionId)?.name ?? ""; const lineName = currentMeeting.lines.find((line) => line.id === person.lineId)?.name ?? ""; return [person.name, person.title, regionName, lineName].some((value) => value.toLowerCase().includes(keyword)); }).sort((left, right) => left.areaType !== right.areaType ? left.areaType.localeCompare(right.areaType) : left.priority - right.priority); }, [currentMeeting, peopleFilter, peopleSearch]);

  useEffect(() => {
    if (!snapshot || !session || !remoteRepository || !hydratedSnapshotRef.current) return;
    const serialized = JSON.stringify(normalizeSnapshot(snapshot));
    if (serialized === lastSavedSnapshotRef.current) return;
    setSaveState("saving");
    setSaveError(null);
    const timer = window.setTimeout(() => {
      void remoteRepository.save(snapshot).then(() => {
        lastSavedSnapshotRef.current = serialized;
        setSaveState("saved");
      }).catch((error) => {
        const message = getErrorMessage(error, "云端保存失败，请稍后重试。");
        setSaveState("error");
        setSaveError(message);
        setBanner({ tone: "error", title: "云端保存失败", description: message });
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [remoteRepository, session, snapshot]);

  useEffect(() => {
    if (!session || !snapshot || !hydratedSnapshotRef.current) {
      return;
    }

    const nextPublicState: MeetingPublicState = {
      selectedMeetingId: snapshot.selectedMeetingId,
      publishedMeetingIds: snapshot.meetings.filter((meeting) => meeting.isPublished).map((meeting) => meeting.id),
    };
    const serialized = JSON.stringify(nextPublicState);

    if (lastPublicMeetingSyncRef.current === serialized) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetch("/api/admin/public-state", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nextPublicState),
      })
        .then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({ error: "同步公开页状态失败。" }))) as { error?: string };
            throw new Error(payload.error || "同步公开页状态失败。");
          }
          lastPublicMeetingSyncRef.current = serialized;
          setPublicState(nextPublicState);
        })
        .catch((error) => {
          showBanner("warning", "公开页状态同步失败", getErrorMessage(error, "请稍后重试。"));
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [session, snapshot]);

  function closeConfirm(accepted: boolean) {
    if (!confirmState) return;
    confirmState.resolve(accepted);
    setConfirmState(null);
  }

  function updateSnapshot(updater: (current: MeetingSnapshot) => MeetingSnapshot) {
    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const nextSnapshot = ensureSnapshot(updater(current));
      if (nextSnapshot.selectedMeetingId !== current.selectedMeetingId) {
        return ensureSnapshot({
          ...nextSnapshot,
          meetings: nextSnapshot.meetings.map((meeting) =>
            meeting.id === nextSnapshot.selectedMeetingId ? touchMeeting(meeting) : meeting,
          ),
        });
      }

      return nextSnapshot;
    });
  }

  function updateMeeting(meetingId: string, updater: (meeting: Meeting) => Meeting) {
    updateSnapshot((current) => ({ ...current, meetings: current.meetings.map((meeting) => meeting.id === meetingId ? touchMeeting(updater(meeting)) : meeting) }));
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseClient) {
      setAuthBusy(true);
      setAuthFeedback(null);
      try {
        if (!authEmail.trim() || !authPassword) throw new Error("请输入账号和密码。");
        const loginResponse = await fetch("/api/admin/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: authEmail.trim(), password: authPassword }),
        });
        const loginPayload = (await loginResponse.json().catch(() => ({ error: "登录失败" }))) as { ok?: boolean; error?: string };
        if (!loginResponse.ok) {
          throw new Error(loginPayload.error || "管理员登录失败。");
        }
        setSession({} as Session);
        setProfile({
          id: "admin",
          email: "admin",
          role: "admin",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        setAuthFeedback({ tone: "success", title: "登录成功", description: "正在进入后台。" });
      } catch (error) {
        setAuthFeedback({ tone: "error", title: "登录失败", description: mapAuthErrorMessage(error, "请稍后重试。") });
      } finally {
        setAuthBusy(false);
      }
      return;
    }
    if (!supabaseClient) return;
    setAuthBusy(true);
    setAuthFeedback(null);
    try {
      if (!authEmail.trim() || !authPassword) throw new Error("请输入账号和密码。");
      const bootstrapResponse = await fetch("/api/admin/bootstrap-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authEmail.trim(), password: authPassword }),
      });
      const bootstrapPayload = (await bootstrapResponse.json()) as { email?: string; error?: string };
      if (!bootstrapResponse.ok || !bootstrapPayload.email) {
        throw new Error(bootstrapPayload.error || "管理员登录初始化失败。");
      }

      const { error } = await supabaseClient.auth.signInWithPassword({
        email: bootstrapPayload.email,
        password: authPassword,
      });
      if (error) throw error;
      setAuthFeedback({ tone: "success", title: "登录成功", description: "正在进入后台。" });
    } catch (error) {
      setAuthFeedback({ tone: "error", title: "登录失败", description: mapAuthErrorMessage(error, "请稍后重试。") });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabaseClient) {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        showBanner("error", "退出登录失败", "请稍后重试。");
        return;
      }
      hydratedSnapshotRef.current = false;
      lastSavedSnapshotRef.current = "";
      lastPublicMeetingSyncRef.current = "";
      setSession(null);
      setProfile(null);
      setSnapshot(null);
      setPublicState(emptyPublicState());
      setSaveState("idle");
      setSaveError(null);
      setAuthFeedback({ tone: "info", title: "已退出登录", description: "如需继续访问后台，请重新登录。" });
      return;
    }
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      showBanner("error", "退出登录失败", error.message);
      return;
    }
    setAuthFeedback({ tone: "info", title: "已退出登录", description: "如需继续访问共享数据，请重新登录。" });
  }

  async function importLegacyData() {
    if (!snapshot || !legacySnapshot) return;
    const confirmed = await requestConfirm({ title: "导入本机旧数据", description: "会把当前浏览器里的本机旧会议合并到云端数据中，同 ID 的会议将以本机版本覆盖。", confirmLabel: "确认导入" });
    if (!confirmed) return;
    setLegacySnapshot(null);
    localRepository.clear();
    updateSnapshot(() => mergeSnapshots(snapshot, legacySnapshot));
    showBanner("success", "本机旧数据已加入云端队列", "稍后会自动同步到共享数据库。");
  }

  async function ignoreLegacyData() {
    const confirmed = await requestConfirm({ title: "忽略本机旧数据", description: "忽略后将清空当前浏览器的旧 localStorage 会议数据，之后只保留云端版本。", confirmLabel: "确认忽略", destructive: true });
    if (!confirmed) return;
    localRepository.clear();
    setLegacySnapshot(null);
    showBanner("info", "已忽略本机旧数据", "当前浏览器后续将只使用云端共享数据。");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    if (!currentMeeting) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await parsePeopleExcel(file, currentMeeting, { defaultAreaType: importAreaType, duplicateHandling, existingPeople: currentMeeting.people.filter((person) => person.areaType === importAreaType) });
      if (result.people.length === 0) {
        showBanner("error", "未导入任何人员", result.warnings[0] ?? "请检查表头映射、姓名列或文件内容。");
        return;
      }
      if (importMode === "replace") {
        const confirmed = await requestConfirm({ title: "替换导入", description: `这会清空当前${getAreaLabel(importAreaType)}名单，再导入 ${result.people.length} 条新记录。`, confirmLabel: "确认替换", destructive: true });
        if (!confirmed) return;
      }
      startTransition(() => updateMeeting(currentMeeting.id, (meeting) => { const otherAreaPeople = meeting.people.filter((person) => person.areaType !== importAreaType); return importMode === "replace" ? { ...meeting, people: reindexPeople([...otherAreaPeople, ...result.people.map((person) => ({ ...person, areaType: importAreaType }))]) } : { ...meeting, people: reindexPeople([...otherAreaPeople, ...result.remainingPeople, ...result.people.map((person) => ({ ...person, areaType: importAreaType }))]) }; }));
      showBanner(result.warnings.length > 0 ? "warning" : "success", `已导入 ${result.people.length} 人`, result.warnings.length > 0 ? previewWarnings(result.warnings) : undefined);
    } catch (error) {
      showBanner("error", "导入失败", getErrorMessage(error, "请检查 Excel 文件后重试。"));
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  }

  async function handleExport() {
    if (!exportRef.current) return;
    try {
      const dataUrl = await toPng(exportRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#f8fafc" });
      const link = document.createElement("a");
      link.download = `座位安排图_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      showBanner("success", "PNG 已导出");
    } catch (error) {
      showBanner("error", "导出失败", getErrorMessage(error, "请稍后重试。"));
    }
  }

  async function handleVisionUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!currentMeeting) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      setVisionState({ previewUrl: imageDataUrl, fileName: file.name, loading: true, result: null, error: null });
      const response = await fetch("/api/vision-reference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl, regions: currentMeeting.regions.map((region) => region.name), lines: currentMeeting.lines.map((line) => line.name) }) });
      const payload = (await response.json()) as { content?: string; error?: string; detail?: string };
      if (!response.ok || !payload.content) throw new Error(payload.detail || payload.error || "AI 识图请求失败");
      const parsed = safeParseVisionResult(payload.content);
      if (!parsed) throw new Error("AI 返回的结果不是有效的 JSON 结构");
      setVisionState({ previewUrl: imageDataUrl, fileName: file.name, loading: false, result: parsed, error: null });
      showBanner("success", "AI 识图完成", parsed.summary || "已经生成可预览的识别结果。");
    } catch (error) {
      setVisionState((current) => ({ ...current, loading: false, result: null, error: getErrorMessage(error, "AI 识图失败") }));
      showBanner("error", "AI 识图失败", getErrorMessage(error, "请稍后重试。"));
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function applyVisionResult() {
    if (!currentMeeting || !visionState.result) return;
    const confirmed = await requestConfirm({ title: visionApplyMode === "replace" ? "替换当前名单" : "合并识别结果", description: visionApplyMode === "replace" ? "会使用识图结果替换当前会议名单，并同步应用识别到的会场类型。" : "会按姓名合并识图结果，重名人员将以识图结果为准。", confirmLabel: visionApplyMode === "replace" ? "确认替换" : "确认合并", destructive: visionApplyMode === "replace" });
    if (!confirmed) return;
    updateMeeting(currentMeeting.id, (meeting) => { const nextMeeting = applyVisionResultToMeeting(meeting, visionState.result!, visionApplyMode); return { ...nextMeeting, people: reindexPeople(nextMeeting.people) }; });
    showBanner("success", "AI 识图结果已应用");
  }

  function clearVisionState() {
    setVisionState({ previewUrl: "", fileName: "", loading: false, result: null, error: null });
  }

  function handleDragEnd(event: DragEndEvent) {
    const over = event.over;
    if (!adjustMode || !currentMeeting || !over || event.active.id === over.id) return;
    updateMeeting(currentMeeting.id, (meeting) => swapPeopleBySeats(meeting, assignments, String(event.active.id), String(over.id)));
    setSelectedSeatId(null);
  }

  function handleSeatPick(seatId: string) {
    if (!adjustMode || !currentMeeting) return;
    if (!selectedSeatId) {
      setSelectedSeatId(seatId);
      return;
    }
    if (selectedSeatId === seatId) {
      setSelectedSeatId(null);
      return;
    }
    updateMeeting(currentMeeting.id, (meeting) => swapPeopleBySeats(meeting, assignments, selectedSeatId, seatId));
    setSelectedSeatId(null);
  }

  if (supabaseError) return <SetupRequiredState message={supabaseError} />;
  if (!authReady) return <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900"><div className="mx-auto flex max-w-7xl items-center justify-center rounded-[32px] border border-white/70 bg-white/80 p-12 shadow-xl shadow-slate-300/30 backdrop-blur">正在检查登录状态...</div></main>;
  if (!session) return <AuthGatewayCard email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} busy={authBusy} feedback={authFeedback} onSubmit={handleAuthSubmit} />;
  if (!snapshot || !currentMeeting || !profile) return <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900"><div className="mx-auto flex max-w-7xl items-center justify-center rounded-[32px] border border-white/70 bg-white/80 p-12 shadow-xl shadow-slate-300/30 backdrop-blur">正在同步云端会议数据...</div></main>;

  const activePeopleCount = currentMeeting.people.filter((person) => person.status === "normal").length;
  const absentPeopleCount = currentMeeting.people.filter((person) => person.status === "absent").length;
  const canDeleteMeetings = profile.role === "admin";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_46%,#f8fafc_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-xl shadow-slate-300/25 backdrop-blur">
          <div className="flex flex-col gap-5 border-b border-slate-200/80 px-5 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-amber-900 uppercase">智能排座系统 Cloud</span>
                <SaveStatusChip state={saveState} error={saveError} />
                <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium", profile.role === "admin" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700")}><ShieldCheck className="size-3.5" />{profile.role === "admin" ? "管理员" : "成员"}</span>
                {currentMeeting.isPublished ? <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">当前会议正在公开页显示</span> : null}
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{currentMeeting.name}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">这是管理员后台。你登录后可以编辑会议，公开首页默认显示你当前正在操作的会议。</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard icon={<CalendarDays className="size-4" />} label="会议时间" value={formatSummaryTime(currentMeeting.time)} />
              <SummaryCard icon={<MapPin className="size-4" />} label="会议地点" value={currentMeeting.location || "未设置"} />
              <SummaryCard icon={<Users className="size-4" />} label="参会情况" value={`${activePeopleCount} 人正常 / ${absentPeopleCount} 人缺席`} />
              <SummaryCard icon={<Sheet className="size-4" />} label="会场类型" value={getVenueLabel(currentMeeting.venueConfig.venueType)} />
            </div>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); if (tab.id !== "seats") setSelectedSeatId(null); }} className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition", activeTab === tab.id ? "bg-slate-950 text-white shadow-lg shadow-slate-300" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{tab.icon}{tab.label}</button>)}</div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={snapshot.selectedMeetingId} onChange={(event) => updateSnapshot((current) => ({ ...current, selectedMeetingId: event.target.value }))} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">{snapshot.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.name}</option>)}</select>
              <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">查看公开页</a>
              <button type="button" onClick={handleExport} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"><Download className="size-4" />导出 PNG</button>
              <button type="button" onClick={() => void handleSignOut()} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"><LogOut className="size-4" />退出登录</button>
            </div>
          </div>
        </section>

        {legacySnapshot ? <LegacyMigrationPanel onImport={() => void importLegacyData()} onIgnore={() => void ignoreLegacyData()} /> : null}
        {banner ? <StatusBanner tone={banner.tone} title={banner.title} description={banner.description} /> : null}

        {activeTab === "meetings" ? <MeetingsTab snapshot={snapshot} currentMeetingId={currentMeeting.id} newMeetingName={newMeetingName} setNewMeetingName={setNewMeetingName} updateSnapshot={updateSnapshot} canDeleteMeetings={canDeleteMeetings} publishedMeetingIds={publicState.publishedMeetingIds} onTogglePublished={(meetingId) => updateSnapshot((current) => ({ ...current, meetings: current.meetings.map((meeting) => meeting.id === meetingId ? { ...meeting, isPublished: !meeting.isPublished } : meeting) }))} onDelete={async (meetingId) => { if (!canDeleteMeetings) { showBanner("warning", "当前账号暂无删除会议权限", "如需删除会议，请使用管理员账号登录。"); return; } const confirmed = await requestConfirm({ title: "删除会议", description: "删除后会同时移除该会议的名单、布局、区域和条线配置，且无法恢复。", confirmLabel: "确认删除", destructive: true }); if (!confirmed) return; updateSnapshot((current) => { const meetings = current.meetings.filter((meeting) => meeting.id !== meetingId); if (meetings.length === 0) { const fallback = createDefaultMeeting(); return { ...current, meetings: [fallback], selectedMeetingId: fallback.id }; } return { ...current, meetings, selectedMeetingId: current.selectedMeetingId === meetingId ? meetings[0]?.id ?? current.selectedMeetingId : current.selectedMeetingId }; }); showBanner("success", "会议已删除"); }} /> : null}
        {activeTab === "seats" ? <SeatsTab currentMeeting={currentMeeting} assignments={assignments} adjustMode={adjustMode} setAdjustMode={setAdjustMode} selectedSeatId={selectedSeatId} onSeatPick={handleSeatPick} clearSeatSelection={() => setSelectedSeatId(null)} unseatedPeople={unseatedPeople} exportRef={exportRef} onDragEnd={handleDragEnd} /> : null}
        {activeTab === "people" ? <PeopleTab currentMeeting={currentMeeting} newPerson={normalizedNewPerson} setNewPerson={setNewPerson} importAreaType={importAreaType} setImportAreaType={setImportAreaType} importMode={importMode} setImportMode={setImportMode} duplicateHandling={duplicateHandling} setDuplicateHandling={setDuplicateHandling} peopleFilter={peopleFilter} setPeopleFilter={setPeopleFilter} peopleSearch={peopleSearch} setPeopleSearch={setPeopleSearch} filteredPeople={filteredPeople} excelInputRef={excelInputRef} imageInputRef={imageInputRef} handleImport={handleImport} handleVisionUpload={handleVisionUpload} visionState={visionState} visionApplyMode={visionApplyMode} setVisionApplyMode={setVisionApplyMode} applyVisionResult={applyVisionResult} clearVisionState={clearVisionState} updateMeeting={updateMeeting} showBanner={showBanner} requestConfirm={requestConfirm} /> : null}
        {activeTab === "settings" ? <SettingsTab currentMeeting={currentMeeting} newRegionName={newRegionName} setNewRegionName={setNewRegionName} newLineName={newLineName} setNewLineName={setNewLineName} updateMeeting={updateMeeting} setBanner={showBanner} requestConfirm={requestConfirm} /> : null}
      </div>

      <ConfirmDialog open={Boolean(confirmState)} title={confirmState?.title ?? ""} description={confirmState?.description ?? ""} confirmLabel={confirmState?.confirmLabel} cancelLabel={confirmState?.cancelLabel} destructive={confirmState?.destructive} onConfirm={() => closeConfirm(true)} onCancel={() => closeConfirm(false)} />
    </main>
  );
}

function SetupRequiredState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-xl shadow-slate-300/25 backdrop-blur">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">云端共享准备中</span>
          <h1 className="mt-5 font-serif text-3xl font-semibold text-slate-950">还没有配置 Supabase 环境变量</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">当前应用已经切换到多电脑共享架构。要让所有电脑登录后看到同一份会议数据，需要先在本地和 Vercel 上配置 Supabase 连接信息。</p>
          <div className="mt-5"><StatusBanner tone="warning" title="当前阻塞" description={message} /></div>
          <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <div className="text-sm font-semibold text-slate-900">请先补齐以下变量</div>
            <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div>`NEXT_PUBLIC_SUPABASE_URL`</div>
              <div>`NEXT_PUBLIC_SUPABASE_ANON_KEY`</div>
              <div>`SUPABASE_SERVICE_ROLE_KEY`</div>
              <div>`SUPABASE_ADMIN_EMAILS`</div>
              <div>`ARK_API_KEY`</div>
              <div>`ARK_VISION_MODEL`</div>
            </div>
          </div>
        </section>
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-xl shadow-slate-300/25 backdrop-blur">
          <div className="flex items-center gap-3 text-slate-900"><MonitorSmartphone className="size-5" /><div className="text-sm font-semibold">共享效果</div></div>
          <div className="mt-5 space-y-4 text-sm leading-7 text-slate-600">
            <p>配置完成后，任何联网电脑都可以通过同一个 HTTPS 地址访问系统。</p>
            <p>用户登录后会直接读取云端数据库，不再依赖本机浏览器 localStorage。</p>
            <p>当前浏览器里的旧会议数据也可以在登录后一次性迁移到云端。</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthGatewayCard({ email, setEmail, password, setPassword, busy, feedback, onSubmit }: { email: string; setEmail: Dispatch<SetStateAction<string>>; password: string; setPassword: Dispatch<SetStateAction<string>>; busy: boolean; feedback: BannerState; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>; }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md">
        <section className="rounded-[32px] border border-white/70 bg-white/90 p-8 shadow-xl shadow-slate-300/25 backdrop-blur">
          <div className="space-y-3 text-center">
            <p className="text-sm font-medium tracking-[0.2em] text-slate-500 uppercase">智能排座系统</p>
            <h1 className="font-serif text-3xl font-semibold text-slate-950">管理员登录</h1>
            <p className="text-sm leading-6 text-slate-600">后台只保留一个管理员账号，其他人直接访问首页即可查看已发布会议。</p>
          </div>
          <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
            <Field label="账号"><input required value={email} onChange={(event) => setEmail(event.target.value)} type="text" autoComplete="username" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" placeholder="请输入管理员账号" /></Field>
            <Field label="密码"><input required value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" placeholder="请输入管理员密码" /></Field>
            {feedback ? <StatusBanner tone={feedback.tone} title={feedback.title} description={feedback.description} /> : null}
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">{busy ? <LoadingPill text="正在登录" /> : "登录后台"}</button>
          </form>
        </section>
      </div>
    </main>
  );
}

function SaveStatusChip({ state, error }: { state: SaveState; error?: string | null }) {
  const config = state === "loading"
    ? { className: "bg-sky-100 text-sky-900", text: "正在同步云端..." }
    : state === "saving"
      ? { className: "bg-amber-100 text-amber-900", text: "保存中" }
      : state === "saved"
        ? { className: "bg-emerald-100 text-emerald-900", text: "已保存到云端" }
        : state === "error"
          ? { className: "bg-rose-100 text-rose-900", text: error ? `保存失败：${error}` : "保存失败，请重试" }
          : { className: "bg-slate-100 text-slate-700", text: "尚未开始同步" };
  return <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-medium", config.className)}>{config.text}</span>;
}

function LegacyMigrationPanel({ onImport, onIgnore }: { onImport: () => void; onIgnore: () => void }) {
  return (
    <section className="rounded-[28px] border border-sky-200 bg-sky-50 px-5 py-4 text-sky-950 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-semibold">检测到当前浏览器还有旧的本机会议数据</div>
          <div className="mt-1 text-sm leading-6 text-sky-900/80">你可以把旧 localStorage 数据一次性导入云端，或者清空本机旧数据后继续使用共享版本。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onImport} className="rounded-full bg-sky-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800">导入到云端</button>
          <button type="button" onClick={onIgnore} className="rounded-full border border-sky-300 bg-white px-4 py-2 text-sm text-sky-900 transition hover:bg-sky-100">忽略并清空本机旧数据</button>
        </div>
      </div>
    </section>
  );
}

function MeetingsTab({ snapshot, currentMeetingId, newMeetingName, setNewMeetingName, updateSnapshot, canDeleteMeetings, publishedMeetingIds, onTogglePublished, onDelete }: { snapshot: MeetingSnapshot; currentMeetingId: string; newMeetingName: string; setNewMeetingName: (value: string) => void; updateSnapshot: (updater: (current: MeetingSnapshot) => MeetingSnapshot) => void; canDeleteMeetings: boolean; publishedMeetingIds: string[]; onTogglePublished: (meetingId: string) => void; onDelete: (meetingId: string) => Promise<void>; }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Panel title="创建会议" description="每个会议独立保存名单、布局、区域、条线和导入结果。">
        <div className="space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">会议名称</span>
            <input value={newMeetingName} onChange={(event) => setNewMeetingName(event.target.value)} placeholder={`会议 ${snapshot.meetings.length + 1}`} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" />
          </label>
          <button type="button" onClick={() => { const meeting = createDefaultMeeting(newMeetingName.trim() || `会议 ${snapshot.meetings.length + 1}`, false); updateSnapshot((current) => ({ ...current, meetings: [meeting, ...current.meetings], selectedMeetingId: meeting.id })); setNewMeetingName(""); }} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white"><Plus className="size-4" />新建会议</button>
        </div>
      </Panel>
      <Panel title="会议列表" description="管理员可以切换当前编辑会议，并勾选哪些会议对外公开。">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.meetings.map((meeting) => {
            const isActive = meeting.id === currentMeetingId;
            const isPublished = publishedMeetingIds.includes(meeting.id);
            return (
              <div key={meeting.id} className={cn("rounded-[28px] border p-5 transition", isActive ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-slate-50 text-slate-900")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{meeting.name}</h3>
                    <p className={cn("mt-1 text-sm", isActive ? "text-slate-200" : "text-slate-500")}>{getVenueLabel(meeting.venueConfig.venueType)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isActive ? <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", isActive ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700")}>当前编辑中</span> : null}
                      {isPublished ? <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", isActive ? "bg-emerald-400/20 text-emerald-100" : "bg-emerald-100 text-emerald-900")}>公开页可见</span> : null}
                    </div>
                  </div>
                  <button type="button" disabled={!canDeleteMeetings} onClick={() => void onDelete(meeting.id)} className={cn("rounded-full p-2 transition disabled:cursor-not-allowed disabled:opacity-40", isActive ? "bg-white/10 text-white hover:bg-white/20" : "bg-white text-slate-600 hover:bg-slate-100")} title={canDeleteMeetings ? "删除会议" : "当前账号无删除权限"}><Trash2 className="size-4" /></button>
                </div>
                <dl className={cn("mt-5 space-y-2 text-sm", isActive ? "text-slate-200" : "text-slate-600")}>
                  <div className="flex items-center justify-between gap-2"><dt>时间</dt><dd>{formatSummaryTime(meeting.time)}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt>地点</dt><dd>{meeting.location || "未设置"}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt>人数</dt><dd>{meeting.people.length}</dd></div>
                </dl>
                <div className="mt-5 grid gap-2">
                  <button type="button" onClick={() => updateSnapshot((current) => ({ ...current, selectedMeetingId: meeting.id }))} className={cn("w-full rounded-full px-4 py-2 text-sm font-medium transition", isActive ? "bg-white text-slate-950" : "bg-slate-950 text-white hover:bg-slate-800")}>{isActive ? "当前会议" : "切换到此会议"}</button>
                  <button type="button" onClick={() => onTogglePublished(meeting.id)} className={cn("w-full rounded-full border px-4 py-2 text-sm font-medium transition", isPublished ? (isActive ? "border-emerald-300 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25" : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100") : (isActive ? "border-white/20 bg-white/10 text-white hover:bg-white/20" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"))}>{isPublished ? "取消公开" : "发布到公开页"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}

function SeatsTab({ currentMeeting, assignments, adjustMode, setAdjustMode, selectedSeatId, onSeatPick, clearSeatSelection, unseatedPeople, exportRef, onDragEnd }: { currentMeeting: Meeting; assignments: AssignedSeat[]; adjustMode: boolean; setAdjustMode: Dispatch<SetStateAction<boolean>>; selectedSeatId: string | null; onSeatPick: (seatId: string) => void; clearSeatSelection: () => void; unseatedPeople: Person[]; exportRef: RefObject<HTMLDivElement | null>; onDragEnd: (event: DragEndEvent) => void; }) {
  const activeLines = currentMeeting.lines.filter((line) => currentMeeting.people.some((person) => person.lineId === line.id));
  const activeRegions = currentMeeting.regions.filter((region) => currentMeeting.people.some((person) => person.regionId === region.id));
  return (
    <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="座位总览" description="自动排座会随着人员和配置变化实时刷新。">
          <div className="space-y-3">
            <StatRow label="主席台已安排" value={`${assignments.filter((seat) => seat.areaType === "rostrum" && seat.person).length} / ${assignments.filter((seat) => seat.areaType === "rostrum").length}`} />
            <StatRow label="台下已安排" value={`${assignments.filter((seat) => seat.areaType === "audience" && seat.person).length} / ${assignments.filter((seat) => seat.areaType === "audience").length}`} />
            <StatRow label="未安排人员" value={`${unseatedPeople.length} 人`} />
            <StatRow label="当前布局" value={getVenueLabel(currentMeeting.venueConfig.venueType)} />
          </div>
          <div className="mt-5 space-y-3">
            <button type="button" onClick={() => { if (adjustMode) clearSeatSelection(); setAdjustMode((value) => !value); }} className={cn("rounded-full px-4 py-2 text-sm font-medium transition", adjustMode ? "bg-amber-500 text-white hover:bg-amber-400" : "bg-slate-950 text-white hover:bg-slate-800")}>{adjustMode ? "退出座位调整" : "开启座位调整"}</button>
            <p className="text-sm leading-6 text-slate-500">{adjustMode ? "调整模式下支持直接拖拽，也支持先点选一个座位，再点目标座位完成交换。" : "普通浏览模式下可直接拖动画布，快速查看上下左右各区域。"}</p>
          </div>
        </Panel>
        <Panel title="未安排人员" description="当前正常参会但尚未进入座位图的人员。">
          {unseatedPeople.length === 0 ? <EmptyState title="没有待安排人员" description="当前正常参会人员都已经进入座位图。" /> : <div className="space-y-2">{unseatedPeople.map((person) => <div key={person.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"><div className="font-medium text-slate-900">{person.name}</div><div className="mt-1 text-slate-500">{getAreaLabel(person.areaType)} / 优先级 {person.priority} / {person.title || "未填写职务"}</div></div>)}</div>}
        </Panel>
      </div>
      <Panel title="座位图" description="导出时会自动带出会议名称、时间地点和区域/条线标识。">
        <div className="max-h-[75vh] overflow-auto rounded-[28px] border border-slate-200 bg-slate-50/60 p-2">
          <div ref={exportRef} className="min-w-[760px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 border-b border-slate-200 pb-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div><h3 className="text-2xl font-semibold text-slate-950">{currentMeeting.name}</h3><p className="mt-2 text-sm text-slate-500">智能排座导出图</p></div>
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><div>时间：{formatSummaryTime(currentMeeting.time)}</div><div>地点：{currentMeeting.location || "未设置"}</div><div>主办方：{currentMeeting.organizer || "未设置"}</div><div>布局：{getVenueLabel(currentMeeting.venueConfig.venueType)}</div></div>
              </div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]"><SeatMapCanvas meeting={currentMeeting} assignments={assignments} adjustMode={adjustMode} onDragEnd={onDragEnd} selectedSeatId={selectedSeatId} onSeatClick={onSeatPick} /></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2"><LegendPanel title="区域标识" items={activeRegions.map((region) => ({ id: region.id, name: region.name, color: region.color }))} emptyText="当前没有使用区域标签" /><LegendPanel title="条线标识" items={activeLines.map((line) => ({ id: line.id, name: line.name, color: line.color }))} emptyText="当前没有使用条线标签" /></div>
          </div>
        </div>
      </Panel>
    </section>
  );
}

function PeopleTab({ currentMeeting, newPerson, setNewPerson, importAreaType, setImportAreaType, importMode, setImportMode, duplicateHandling, setDuplicateHandling, peopleFilter, setPeopleFilter, peopleSearch, setPeopleSearch, filteredPeople, excelInputRef, imageInputRef, handleImport, handleVisionUpload, visionState, visionApplyMode, setVisionApplyMode, applyVisionResult, clearVisionState, updateMeeting, showBanner, requestConfirm }: { currentMeeting: Meeting; newPerson: NewPersonDraft; setNewPerson: Dispatch<SetStateAction<NewPersonDraft>>; importAreaType: AreaType; setImportAreaType: Dispatch<SetStateAction<AreaType>>; importMode: ImportMode; setImportMode: Dispatch<SetStateAction<ImportMode>>; duplicateHandling: DuplicateHandling; setDuplicateHandling: Dispatch<SetStateAction<DuplicateHandling>>; peopleFilter: PeopleFilter; setPeopleFilter: Dispatch<SetStateAction<PeopleFilter>>; peopleSearch: string; setPeopleSearch: Dispatch<SetStateAction<string>>; filteredPeople: Person[]; excelInputRef: RefObject<HTMLInputElement | null>; imageInputRef: RefObject<HTMLInputElement | null>; handleImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>; handleVisionUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>; visionState: VisionState; visionApplyMode: VisionApplyMode; setVisionApplyMode: Dispatch<SetStateAction<VisionApplyMode>>; applyVisionResult: () => Promise<void>; clearVisionState: () => void; updateMeeting: (meetingId: string, updater: (meeting: Meeting) => Meeting) => void; showBanner: (tone: StatusTone, title: string, description?: string) => void; requestConfirm: (config: Omit<NonNullable<ConfirmState>, "resolve">) => Promise<boolean>; }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="手动添加人员" description="支持主席台和台下分别录入，优先级会自动续排。">
          <div className="grid gap-4">
            <Field label="姓名"><input value={newPerson.name} onChange={(event) => setNewPerson((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" placeholder="输入姓名" /></Field>
            <Field label="职务"><input value={newPerson.title} onChange={(event) => setNewPerson((current) => ({ ...current, title: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" placeholder="输入职务" /></Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="区域"><select value={newPerson.regionId} onChange={(event) => setNewPerson((current) => ({ ...current, regionId: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="">未设置</option>{currentMeeting.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></Field>
              <Field label="条线"><select value={newPerson.lineId} onChange={(event) => setNewPerson((current) => ({ ...current, lineId: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="">未设置</option>{currentMeeting.lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select></Field>
              <Field label="归属"><select value={newPerson.areaType} onChange={(event) => setNewPerson((current) => ({ ...current, areaType: event.target.value as AreaType }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="audience">台下</option><option value="rostrum">主席台</option></select></Field>
            </div>
            <button type="button" onClick={() => { if (!newPerson.name.trim()) { showBanner("warning", "请先填写姓名"); return; } updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, people: [...meeting.people, { id: createId("person"), name: newPerson.name.trim(), title: newPerson.title.trim(), priority: nextPriority(meeting.people, newPerson.areaType), status: "normal", areaType: newPerson.areaType, regionId: newPerson.regionId || undefined, lineId: newPerson.lineId || undefined }] })); setNewPerson((current) => ({ ...current, name: "", title: "" })); showBanner("success", "人员已添加"); }} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white"><Plus className="size-4" />添加人员</button>
          </div>
        </Panel>

        <Panel title="批量导入" description="支持 Excel 导入、模板下载、示例数据，以及重复姓名处理策略。">
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="导入到"><select value={importAreaType} onChange={(event) => setImportAreaType(event.target.value as AreaType)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="audience">台下</option><option value="rostrum">主席台</option></select></Field>
              <Field label="导入方式"><select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="append">追加导入</option><option value="replace">替换导入</option></select></Field>
            </div>
            <Field label="重名处理"><select value={duplicateHandling} onChange={(event) => setDuplicateHandling(event.target.value as DuplicateHandling)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="skip">跳过重名人员</option><option value="overwrite">覆盖现有重名人员</option><option value="keep">保留并继续导入</option></select></Field>
            <p className="text-sm leading-6 text-slate-500">覆盖策略只影响当前导入区域的重名人员；表头支持姓名、职务、优先级、区域、条线、归属和状态识别。</p>
            <input ref={excelInputRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => excelInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"><Upload className="size-4" />选择 Excel</button>
              <button type="button" onClick={downloadPeopleImportTemplate} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50">下载导入模板</button>
              <button type="button" onClick={async () => { if (currentMeeting.people.length > 0) { const confirmed = await requestConfirm({ title: "填充示例数据", description: "这会覆盖当前会议的全部人员名单，适合快速体验排座效果。", confirmLabel: "确认覆盖", destructive: true }); if (!confirmed) return; } updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, people: createDemoPeople(meeting.regions, meeting.lines) })); showBanner("success", "已填充示例数据"); }} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50">填充示例数据</button>
            </div>
          </div>
        </Panel>

        <Panel title="AI 参考图识别" description="上传参考图后自动识别会场类型、主席台名单和台下名单。">
          <div className="space-y-4">
            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleVisionUpload} className="hidden" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => imageInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"><WandSparkles className="size-4" />上传参考图</button>
              {visionState.loading ? <LoadingPill text="AI 正在识别中" /> : null}
              {visionState.previewUrl ? <button type="button" onClick={clearVisionState} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50">清空识别结果</button> : null}
            </div>
            {!visionState.previewUrl ? <EmptyState title="还没有参考图" description="适合上传带有名单或座位关系的截图、照片、示意图，用于快速生成初始名单。" /> : <div className="space-y-4"><div className="relative h-52 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50"><Image src={visionState.previewUrl} alt={visionState.fileName || "参考图预览"} fill unoptimized className="object-cover" /></div>{visionState.error ? <StatusBanner tone="error" title="识别失败" description={visionState.error} /> : null}{visionState.result ? <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4"><div className="grid gap-3 md:grid-cols-2"><StatRow label="识别会场类型" value={visionState.result.venueType ? getVenueLabel(visionState.result.venueType) : "未识别"} /><StatRow label="置信度" value={visionState.result.confidence ? `${Math.round(visionState.result.confidence * 100)}%` : "未提供"} /><StatRow label="主席台人数" value={`${visionState.result.rostrumPeople.length} 人`} /><StatRow label="台下人数" value={`${visionState.result.audiencePeople.length} 人`} /></div>{visionState.result.summary ? <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">{visionState.result.summary}</div> : null}<Field label="应用方式"><select value={visionApplyMode} onChange={(event) => setVisionApplyMode(event.target.value as VisionApplyMode)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="merge">合并到当前名单</option><option value="replace">替换当前名单</option></select></Field><button type="button" onClick={() => void applyVisionResult()} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">应用识别结果</button></div> : null}</div>}
          </div>
        </Panel>
      </div>

      <Panel title="人员列表" description="支持搜索、筛选、编辑、缺席管理和删除。">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="搜索姓名、职务、区域或条线" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm lg:max-w-sm" />
          <div className="flex flex-wrap gap-2">{[{ id: "all", label: "全部" }, { id: "rostrum", label: "主席台" }, { id: "audience", label: "台下" }, { id: "absent", label: "缺席" }].map((option) => <button key={option.id} type="button" onClick={() => setPeopleFilter(option.id as PeopleFilter)} className={cn("rounded-full px-4 py-2 text-sm transition", peopleFilter === option.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{option.label}</button>)}</div>
        </div>
        {filteredPeople.length === 0 ? <EmptyState title="当前没有匹配人员" description="可以调整筛选条件、搜索关键词，或先手动添加 / 批量导入名单。" /> : <div className="overflow-x-auto rounded-[24px] border border-slate-200"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-3 font-medium">姓名</th><th className="px-4 py-3 font-medium">职务</th><th className="px-4 py-3 font-medium">优先级</th><th className="px-4 py-3 font-medium">归属</th><th className="px-4 py-3 font-medium">区域</th><th className="px-4 py-3 font-medium">条线</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">操作</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{filteredPeople.map((person) => <tr key={person.id}><td className="px-4 py-3"><input value={person.name} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { name: event.target.value })} className="w-28 rounded-xl border border-slate-300 px-3 py-2" /></td><td className="px-4 py-3"><input value={person.title} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { title: event.target.value })} className="w-36 rounded-xl border border-slate-300 px-3 py-2" /></td><td className="px-4 py-3"><input type="number" min={1} value={person.priority} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { priority: parsePositiveInt(event.target.value, person.priority) })} className="w-20 rounded-xl border border-slate-300 px-3 py-2" /></td><td className="px-4 py-3"><select value={person.areaType} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { areaType: event.target.value as AreaType })} className="rounded-xl border border-slate-300 px-3 py-2"><option value="rostrum">主席台</option><option value="audience">台下</option></select></td><td className="px-4 py-3"><select value={person.regionId ?? ""} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { regionId: event.target.value || undefined })} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">未设置</option>{currentMeeting.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></td><td className="px-4 py-3"><select value={person.lineId ?? ""} onChange={(event) => patchPerson(currentMeeting.id, person.id, updateMeeting, { lineId: event.target.value || undefined })} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">未设置</option>{currentMeeting.lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select></td><td className="px-4 py-3"><button type="button" onClick={() => patchPerson(currentMeeting.id, person.id, updateMeeting, { status: person.status === "normal" ? "absent" : "normal" })} className={cn("rounded-full px-3 py-1 text-xs font-medium", person.status === "normal" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{person.status === "normal" ? "正常" : "缺席"}</button></td><td className="px-4 py-3"><button type="button" onClick={async () => { const confirmed = await requestConfirm({ title: "删除人员", description: `将从当前会议中删除“${person.name}”。`, confirmLabel: "确认删除", destructive: true }); if (!confirmed) return; updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, people: reindexPeople(meeting.people.filter((item) => item.id !== person.id)), seatingRules: { ...meeting.seatingRules, separationRules: meeting.seatingRules.separationRules.filter((rule) => rule.firstPersonId !== person.id && rule.secondPersonId !== person.id) } })); showBanner("success", "人员已删除"); }} className="rounded-full border border-rose-200 px-3 py-2 text-xs text-rose-700">删除</button></td></tr>)}</tbody></table></div>}
      </Panel>
    </section>
  );
}

function SettingsTab({ currentMeeting, newRegionName, setNewRegionName, newLineName, setNewLineName, updateMeeting, setBanner, requestConfirm }: { currentMeeting: Meeting; newRegionName: string; setNewRegionName: Dispatch<SetStateAction<string>>; newLineName: string; setNewLineName: Dispatch<SetStateAction<string>>; updateMeeting: (meetingId: string, updater: (meeting: Meeting) => Meeting) => void; setBanner: (tone: StatusTone, title: string, description?: string) => void; requestConfirm: (config: Omit<NonNullable<ConfirmState>, "resolve">) => Promise<boolean>; }) {
  const audiencePeople = currentMeeting.people.filter((person) => person.areaType === "audience").sort((left, right) => left.priority - right.priority);
  const [firstRulePersonId, setFirstRulePersonId] = useState("");
  const [secondRulePersonId, setSecondRulePersonId] = useState("");

  function updateSeparationRules(nextRules: SeparationRule[]) {
    updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, seatingRules: { ...meeting.seatingRules, separationRules: nextRules } }));
  }

  function updateAdjacencyMode(mode: AdjacencyRuleMode) {
    updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, seatingRules: { ...meeting.seatingRules, adjacencyMode: mode } }));
  }

  function updateLinePriority(lineId: string, value: string) {
    const rank = Number.parseInt(value, 10);
    updateMeeting(currentMeeting.id, (meeting) => ({
      ...meeting,
      seatingRules: {
        ...meeting.seatingRules,
        linePriorityOverrides: Number.isFinite(rank) && rank > 0 ? [...meeting.seatingRules.linePriorityOverrides.filter((item) => item.lineId !== lineId), { lineId, rank }].sort((left, right) => left.rank - right.rank) : meeting.seatingRules.linePriorityOverrides.filter((item) => item.lineId !== lineId),
      },
    }));
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Panel title="会议基本信息" description="修改会议名称、时间、地点和主办方。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="会议名称"><input value={currentMeeting.name} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, name: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            <Field label="会议时间"><input type="datetime-local" value={formatDateTimeInput(currentMeeting.time)} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, time: toIsoDateTime(event.target.value) }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            <Field label="会议地点"><input value={currentMeeting.location} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, location: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            <Field label="主办方"><input value={currentMeeting.organizer} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, organizer: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
          </div>
        </Panel>
        <Panel title="会场布局" description="支持大型报告厅、U 型会议室和回形布局。">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">{(["large", "u_shape", "hollow_square"] as const).map((type) => <button key={type} type="button" onClick={async () => { if (currentMeeting.venueConfig.venueType === type) return; const confirmed = await requestConfirm({ title: "切换会场类型", description: "切换会场类型会重置当前布局参数，但不会删除人员名单。", confirmLabel: "确认切换" }); if (!confirmed) return; updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, venueConfig: createVenueConfig(type) })); }} className={cn("rounded-full px-4 py-2 text-sm font-medium transition", currentMeeting.venueConfig.venueType === type ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{getVenueLabel(type)}</button>)}</div>
            <Field label="主席台席位数"><input type="number" min={1} max={15} value={currentMeeting.venueConfig.rostrumCapacity} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, venueConfig: { ...meeting.venueConfig, rostrumCapacity: parsePositiveInt(event.target.value, meeting.venueConfig.rostrumCapacity) } }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field>
            {currentMeeting.venueConfig.venueType === "large" ? <div className="grid gap-4 md:grid-cols-4"><Field label="台下排数"><input type="number" min={1} max={50} value={currentMeeting.venueConfig.audienceRows} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, audienceRows: parsePositiveInt(event.target.value, meeting.venueConfig.audienceRows) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="区块布局"><input value={currentMeeting.venueConfig.audienceBlocks.join(",")} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, audienceBlocks: event.target.value.split(",").map((item) => parsePositiveInt(item.trim(), 0)).filter((item) => item > 0) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" placeholder="5,7,5" /></Field><Field label="座位排序"><select value={currentMeeting.venueConfig.seatOrderMode} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, seatOrderMode: event.target.value as "left-honor" | "ltr" } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="left-honor">以左为尊</option><option value="ltr">从左到右</option></select></Field><Field label="普通台分组"><select value={currentMeeting.venueConfig.groupMode} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, groupMode: event.target.value as GroupMode } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="none">按优先级</option><option value="line">按条线</option><option value="region">按企业/区域</option></select></Field></div> : null}
            {currentMeeting.venueConfig.venueType === "u_shape" ? <div className="grid gap-4 md:grid-cols-3"><Field label="左侧席位"><input type="number" min={1} value={currentMeeting.venueConfig.leftSeats} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "u_shape" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, leftSeats: parsePositiveInt(event.target.value, meeting.venueConfig.leftSeats) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="右侧席位"><input type="number" min={1} value={currentMeeting.venueConfig.rightSeats} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "u_shape" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, rightSeats: parsePositiveInt(event.target.value, meeting.venueConfig.rightSeats) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="分组方式"><select value={currentMeeting.venueConfig.groupMode} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "u_shape" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, groupMode: event.target.value as GroupMode } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="none">不分组</option><option value="region">按企业/区域</option><option value="line">按条线</option><option value="region+line">先区域后条线</option></select></Field></div> : null}
            {currentMeeting.venueConfig.venueType === "hollow_square" ? <div className="grid gap-4 md:grid-cols-3"><Field label="左侧席位"><input type="number" min={1} value={currentMeeting.venueConfig.leftSeats} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, leftSeats: parsePositiveInt(event.target.value, meeting.venueConfig.leftSeats) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="右侧席位"><input type="number" min={1} value={currentMeeting.venueConfig.rightSeats} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, rightSeats: parsePositiveInt(event.target.value, meeting.venueConfig.rightSeats) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="底部席位"><input type="number" min={1} value={currentMeeting.venueConfig.bottomSeats} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, bottomSeats: parsePositiveInt(event.target.value, meeting.venueConfig.bottomSeats) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="内圈宽度"><input type="number" min={1} max={6} value={currentMeeting.venueConfig.innerWidth} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, innerWidth: parsePositiveInt(event.target.value, meeting.venueConfig.innerWidth) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="内圈高度"><input type="number" min={1} max={4} value={currentMeeting.venueConfig.innerHeight} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, innerHeight: parsePositiveInt(event.target.value, meeting.venueConfig.innerHeight) } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /></Field><Field label="分组方式"><select value={currentMeeting.venueConfig.groupMode} onChange={(event) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "hollow_square" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, groupMode: event.target.value as GroupMode } })} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="none">不分组</option><option value="region">按企业/区域</option><option value="line">按条线</option><option value="region+line">先区域后条线</option></select></Field></div> : null}
          </div>
        </Panel>
        {currentMeeting.venueConfig.venueType === "large" && currentMeeting.venueConfig.groupMode === "line" ? <Panel title="条线区域预设" description="大型报告厅会优先把对应条线人员安排到预设区域。"><div className="space-y-4">{currentMeeting.venueConfig.lineZones.map((zone) => <LineZoneEditor key={zone.id} zone={zone} lines={currentMeeting.lines} onChange={(nextZone) => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, lineZones: meeting.venueConfig.lineZones.map((item) => item.id === zone.id ? nextZone : item) } })} onDelete={() => updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, lineZones: meeting.venueConfig.lineZones.filter((item) => item.id !== zone.id) } })} />)}<button type="button" onClick={() => { const firstLine = currentMeeting.lines[0]; if (!firstLine) { setBanner("warning", "请先创建条线，再添加预设区域"); return; } const zone: LineZonePreset = { id: createId("zone"), lineId: firstLine.id, startRow: 1, endRow: 2, startCol: 1, endCol: 3 }; updateMeeting(currentMeeting.id, (meeting) => meeting.venueConfig.venueType !== "large" ? meeting : { ...meeting, venueConfig: { ...meeting.venueConfig, lineZones: [...meeting.venueConfig.lineZones, zone] } }); }} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700"><Plus className="size-4" />新增预设区域</button></div></Panel> : null}
      </div>
      <div className="space-y-6">
        <Panel title="区域管理" description="区域配置仅作用于当前会议，可修改名称和颜色。"><EditableTags items={currentMeeting.regions} onChange={(regions) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, regions }))} onDelete={(regionId) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, regions: meeting.regions.filter((region) => region.id !== regionId), people: meeting.people.map((person) => person.regionId === regionId ? { ...person, regionId: undefined } : person) }))} /><div className="mt-4 flex gap-2"><input value={newRegionName} onChange={(event) => setNewRegionName(event.target.value)} placeholder="新增区域名称" className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /><button type="button" onClick={() => { if (!newRegionName.trim()) return; const region: Region = { id: createId("region"), name: newRegionName.trim(), color: REGION_COLORS[currentMeeting.regions.length % REGION_COLORS.length] }; updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, regions: [...meeting.regions, region] })); setNewRegionName(""); }} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white">添加</button></div></Panel>
        <Panel title="条线管理" description="条线颜色会用于座位卡和条线预设区域。"><EditableTags items={currentMeeting.lines} onChange={(lines) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, lines }))} onDelete={(lineId) => updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, lines: meeting.lines.filter((line) => line.id !== lineId), people: meeting.people.map((person) => person.lineId === lineId ? { ...person, lineId: undefined } : person), venueConfig: meeting.venueConfig.venueType === "large" ? { ...meeting.venueConfig, lineZones: meeting.venueConfig.lineZones.filter((zone) => zone.lineId !== lineId) } : meeting.venueConfig, seatingRules: { ...meeting.seatingRules, linePriorityOverrides: meeting.seatingRules.linePriorityOverrides.filter((item) => item.lineId !== lineId) } }))} /><div className="mt-4 flex gap-2"><input value={newLineName} onChange={(event) => setNewLineName(event.target.value)} placeholder="新增条线名称" className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm" /><button type="button" onClick={() => { if (!newLineName.trim()) return; const line: LineGroup = { id: createId("line"), name: newLineName.trim(), color: LINE_COLORS[currentMeeting.lines.length % LINE_COLORS.length] }; updateMeeting(currentMeeting.id, (meeting) => ({ ...meeting, lines: [...meeting.lines, line] })); setNewLineName(""); }} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white">添加</button></div></Panel>
        <Panel title="高级排座规则" description="用于控制相邻规避、指定人员分开以及条线优先级覆盖。"><div className="space-y-5"><Field label="相邻规避"><select value={currentMeeting.seatingRules.adjacencyMode} onChange={(event) => updateAdjacencyMode(event.target.value as AdjacencyRuleMode)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="none">不启用</option><option value="region">同区域不相邻</option><option value="line">同条线不相邻</option></select></Field><div className="space-y-3"><div className="text-sm font-medium text-slate-700">条线优先级覆盖</div>{currentMeeting.lines.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">请先创建条线。</div> : currentMeeting.lines.map((line) => <div key={line.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_120px]"><div className="flex items-center gap-3 text-sm text-slate-700"><span className="size-3 rounded-full" style={{ backgroundColor: line.color }} />{line.name}</div><input type="number" min={1} value={currentMeeting.seatingRules.linePriorityOverrides.find((item) => item.lineId === line.id)?.rank ?? ""} onChange={(event) => updateLinePriority(line.id, event.target.value)} placeholder="留空=默认" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" /></div>)}</div><div className="space-y-3"><div className="text-sm font-medium text-slate-700">指定两人分开</div>{currentMeeting.seatingRules.separationRules.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">当前没有设置分开规则。</div> : currentMeeting.seatingRules.separationRules.map((rule) => { const firstPerson = currentMeeting.people.find((person) => person.id === rule.firstPersonId); const secondPerson = currentMeeting.people.find((person) => person.id === rule.secondPersonId); return <div key={rule.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"><span className="text-slate-700">{firstPerson?.name ?? "已删除人员"} 与 {secondPerson?.name ?? "已删除人员"} 不相邻</span><button type="button" onClick={() => updateSeparationRules(currentMeeting.seatingRules.separationRules.filter((item) => item.id !== rule.id))} className="rounded-full border border-rose-200 px-3 py-2 text-xs text-rose-700">删除</button></div>; })}<div className="grid gap-3 md:grid-cols-2"><select value={firstRulePersonId} onChange={(event) => setFirstRulePersonId(event.target.value)} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="">选择人员 A</option>{audiencePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select value={secondRulePersonId} onChange={(event) => setSecondRulePersonId(event.target.value)} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="">选择人员 B</option>{audiencePeople.filter((person) => person.id !== firstRulePersonId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div><button type="button" onClick={() => { if (!firstRulePersonId || !secondRulePersonId || firstRulePersonId === secondRulePersonId) { setBanner("warning", "请先选择两名不同的台下人员"); return; } const exists = currentMeeting.seatingRules.separationRules.some((rule) => (rule.firstPersonId === firstRulePersonId && rule.secondPersonId === secondRulePersonId) || (rule.firstPersonId === secondRulePersonId && rule.secondPersonId === firstRulePersonId)); if (exists) { setBanner("warning", "该分开规则已经存在"); return; } updateSeparationRules([...currentMeeting.seatingRules.separationRules, { id: createId("rule"), firstPersonId: firstRulePersonId, secondPersonId: secondRulePersonId }]); setFirstRulePersonId(""); setSecondRulePersonId(""); }} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white">新增分开规则</button></div></div></Panel>
        <Panel title="当前排座规则" description="快速查看当前会议使用的排座逻辑。"><dl className="space-y-3"><RuleRow label="主席台排序" value="以左为尊" /><RuleRow label="普通台排序" value={currentMeeting.venueConfig.venueType === "large" ? currentMeeting.venueConfig.groupMode === "none" ? currentMeeting.venueConfig.seatOrderMode === "left-honor" ? "按优先级，座位以左为尊" : "按优先级，从左到右" : getGroupModeLabel(currentMeeting.venueConfig.groupMode) : getGroupModeLabel(currentMeeting.venueConfig.groupMode)} /><RuleRow label="相邻规避" value={currentMeeting.seatingRules.adjacencyMode === "none" ? "未启用" : currentMeeting.seatingRules.adjacencyMode === "region" ? "同区域不相邻" : "同条线不相邻"} /><RuleRow label="分开规则" value={`${currentMeeting.seatingRules.separationRules.length} 条`} /><RuleRow label="条线优先级覆盖" value={`${currentMeeting.seatingRules.linePriorityOverrides.length} 条`} /><RuleRow label="缺席递补" value="主席台与台下独立递补" /><RuleRow label="数据持久化" value="云端自动保存（最后一次写入生效）" /></dl></Panel>
      </div>
    </section>
  );
}

function LegendPanel({ title, items, emptyText }: { title: string; items: Array<{ id: string; name: string; color: string }>; emptyText: string }) {
  return <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-medium text-slate-900">{title}</div>{items.length === 0 ? <div className="mt-3 text-sm text-slate-500">{emptyText}</div> : <div className="mt-3 flex flex-wrap gap-2">{items.map((item) => <span key={item.id} className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>)}</div>}</div>;
}

function patchPerson(meetingId: string, personId: string, updateMeeting: (meetingId: string, updater: (meeting: Meeting) => Meeting) => void, patch: Partial<Person>) {
  updateMeeting(meetingId, (meeting) => ({ ...meeting, people: reindexPeople(meeting.people.map((item) => item.id === personId ? { ...item, ...patch } : item)) }));
}
