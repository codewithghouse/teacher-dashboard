/**
 * leaderboardPlanCache.ts — 3-tier cache for AI-generated leaderboard action plans.
 *
 * Per memory `teacher_dashboard_ai_strategy.md`:
 *   "Class / Student / Teacher-self Action Plan — cache weekly per leaderboard cycle"
 *
 * Tier 1 — in-flight dedup (memory map, 60s retain): simultaneous calls with
 *          the same key collapse to ONE OpenAI call.
 * Tier 2 — localStorage, 7-day TTL: same key on same device returns the cached
 *          plan instantly. Survives page refresh.
 * Tier 3 — Firestore `leaderboard_ai_plans` collection, 7-day TTL: cross-device
 *          weekly enforcement. Same teacher on a different device hits the same
 *          weekly plan. AI is billed exactly ONCE per (teacher + context + ISO week)
 *          across all devices.
 *
 * Read order:  LS  →  FS  →  AI
 * Write order: AI  →  FS (cross-device)  →  LS (fast next-load)
 *
 * Tenant scope: Firestore writes carry schoolId + branchId for security rules.
 */

import { doc, getDoc, setDoc, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LS_PREFIX = "edul_leaderboard_plan_";
// v3 — bumped 2026-05-21 round 2: prompt strengthened with explicit
// "do not use Hinglish" rules + correct/incorrect examples after first
// English flip didn't take effect (gpt-4o still produced Hinglish output
// because earlier prompt only said "write in English" without negative examples).
// Forces another cache invalidation after the next function deploy.
const CACHE_VERSION = "v3";
const FS_COLLECTION = "leaderboard_ai_plans";
const LS_MAX_ENTRIES = 80;
const INFLIGHT_RETAIN_MS = 60_000;

type Plan = Record<string, unknown>;

interface CacheEntry {
  plan: Plan;
  cachedAt: number;
  version: string;
}

export interface CachedLeaderboardPlan {
  plan: Plan;
  cachedAt: number;
}

export interface TenantContext {
  teacherId: string;
  schoolId: string;
  branchId?: string;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const norm = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/\s+/g, " ");

/** Sanitize a string for use inside a Firestore doc id — Firestore forbids `/` and `.` is reserved. */
const safeIdPart = (s: string): string => (s || "").replace(/[/.]/g, "_").slice(0, 64);

/** ISO week key: YYYY-Www (e.g. "2026-W19") — same week → same key. */
export function isoWeekKey(d: Date = new Date()): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Local cache key (hashed for localStorage) ────────────────────────────────
export function classPlanKey(opts: {
  classId: string;
  composite: number;
  totalStudents: number;
}): string {
  const parts = [
    "cls",
    norm(opts.classId),
    String(Math.round(opts.composite * 10) / 10),
    String(opts.totalStudents),
    isoWeekKey(),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

export function studentPlanKey(opts: {
  studentId: string;
  classId: string;
  composite: number;
}): string {
  const parts = [
    "stu",
    norm(opts.studentId),
    norm(opts.classId),
    String(Math.round(opts.composite * 10) / 10),
    isoWeekKey(),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

export function teacherSelfPlanKey(opts: {
  teacherId: string;
  composite: number;
  totalStudents: number;
}): string {
  const parts = [
    "self",
    norm(opts.teacherId),
    String(Math.round(opts.composite * 10) / 10),
    String(opts.totalStudents),
    isoWeekKey(),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

// ── Firestore deterministic doc id (NOT hashed — readable + queryable) ──────
export type CacheKind = "class" | "student" | "self";

export interface FirestoreCacheCoords {
  kind: CacheKind;
  teacherId: string;
  classId?: string;       // class + student
  studentId?: string;     // student only
  weekKey?: string;       // defaults to isoWeekKey()
}

/** Deterministic Firestore doc id — same context + same week → same doc.
 *  Format: `{teacherId}__{kind}__{contextId}__{weekKey}`.
 *  Length capped via safeIdPart for Firestore's 1500-char limit. */
export function firestoreDocId(c: FirestoreCacheCoords): string {
  const wk = c.weekKey || isoWeekKey();
  const tch = safeIdPart(c.teacherId);
  if (c.kind === "self") return `${tch}__self__${wk}`;
  if (c.kind === "class") return `${tch}__cls__${safeIdPart(c.classId || "")}__${wk}`;
  return `${tch}__stu__${safeIdPart(c.classId || "")}__${safeIdPart(c.studentId || "")}__${wk}`;
}

// ── Tier 1: in-flight dedup ─────────────────────────────────────────────
const inflight = new Map<string, Promise<Plan>>();

export function getInflight(key: string): Promise<Plan> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<Plan>): void {
  inflight.set(key, p);
  p.finally(() => {
    setTimeout(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    }, INFLIGHT_RETAIN_MS);
  });
}

// ── Tier 2: localStorage 7-day ──────────────────────────────────────────
function lsKey(key: string): string {
  return LS_PREFIX + key;
}

export function lsRead(key: string): CachedLeaderboardPlan | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.plan) return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      try { window.localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
      return null;
    }
    return { plan: parsed.plan, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function lsWrite(key: string, plan: Plan): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    pruneLs();
    const entry: CacheEntry = { plan, cachedAt: Date.now(), version: CACHE_VERSION };
    window.localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    /* quota or permission issue — fail silently */
  }
}

function pruneLs(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const ours: { key: string; cachedAt: number }[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const p = JSON.parse(raw) as CacheEntry;
        ours.push({ key: k, cachedAt: p.cachedAt || 0 });
      } catch { /* skip corrupt */ }
    }
    if (ours.length < LS_MAX_ENTRIES) return;
    ours.sort((a, b) => a.cachedAt - b.cachedAt);
    const toRemove = ours.length - LS_MAX_ENTRIES + 1;
    for (let i = 0; i < toRemove; i++) {
      try { window.localStorage.removeItem(ours[i].key); } catch { /* ignore */ }
    }
  } catch { /* no-op */ }
}

// ── Tier 3: Firestore 7-day (cross-device weekly enforcement) ──────────
export async function fsRead(coords: FirestoreCacheCoords): Promise<CachedLeaderboardPlan | null> {
  try {
    const docId = firestoreDocId(coords);
    const snap = await getDoc(doc(db, FS_COLLECTION, docId));
    if (!snap.exists()) return null;
    const data = snap.data() as DocumentData;
    if (data.version !== CACHE_VERSION) return null;
    const cachedAt = Number(data.cachedAtMs ?? 0);
    if (!cachedAt || Date.now() - cachedAt > TTL_MS) return null;
    const plan = data.plan as Plan | undefined;
    if (!plan || typeof plan !== "object") return null;
    return { plan, cachedAt };
  } catch {
    // Firestore read failure is non-fatal — fall through to AI call
    return null;
  }
}

export async function fsWrite(coords: FirestoreCacheCoords, plan: Plan, tenant: TenantContext): Promise<void> {
  try {
    const docId = firestoreDocId(coords);
    const wk = coords.weekKey || isoWeekKey();
    const payload: DocumentData = {
      version: CACHE_VERSION,
      kind: coords.kind,
      teacherId: tenant.teacherId,
      schoolId: tenant.schoolId,
      branchId: tenant.branchId || "",
      weekKey: wk,
      classId: coords.classId || "",
      studentId: coords.studentId || "",
      plan,
      cachedAt: new Date().toISOString(),
      cachedAtMs: Date.now(),
    };
    await setDoc(doc(db, FS_COLLECTION, docId), payload, { merge: false });
  } catch {
    // Non-fatal — localStorage is still warm and the request already succeeded
  }
}

export function formatAge(cachedAt: number): string {
  const ms = Date.now() - cachedAt;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1d ago" : `${d}d ago`;
}
