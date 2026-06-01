/**
 * resultPredictorCache.ts — 3-tier cache for the Pre-Result Predictor AI call.
 *
 * Sibling pattern: `leaderboardPlanCache.ts` (which is cached weekly). This one
 * is cached DAILY because the inputs (paper text, syllabus text, student
 * roster snapshot) don't change between exam day and the day before, but the
 * teacher might iterate on the paper draft. A 24h TTL keeps cost down while
 * still letting the teacher re-run on a fresh paper draft within ~hours.
 *
 * Tier 1 — in-flight dedup (memory map, 60s retain): two simultaneous clicks
 *          on "Predict" with the same key collapse to ONE OpenAI call.
 * Tier 2 — localStorage, 24h TTL: the teacher refreshes the page and the
 *          prediction loads instantly without billing again.
 * Tier 3 — Firestore `result_predictions` collection, 24h TTL: cross-device
 *          enforcement. Same teacher on a different machine hits the same
 *          prediction. AI is billed exactly ONCE per (paper hash + roster hash
 *          + day) across all devices.
 *
 * Read order:  Tier 1 (in-flight)  →  Tier 2 (LS)  →  Tier 3 (FS)  →  AI
 * Write order: AI  →  Tier 3 (FS, cross-device)  →  Tier 2 (LS, fast next-load)
 */

import { doc, getDoc, setDoc, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";

const TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "edul_result_pred_";
// v2 — topic-weighted engine: predictions now align the paper's per-topic mark
// weight against each student's topic-level mastery (not just overall average),
// read past test papers where attached, and downgrade confidence honestly when
// a student's history doesn't cover the paper's topics. Bumping the version
// invalidates all v1 (average-echo) caches so fresh topic-grounded predictions
// are computed.
const CACHE_VERSION = "v2";
const FS_COLLECTION = "result_predictions";
const LS_MAX_ENTRIES = 60;
const INFLIGHT_RETAIN_MS = 60_000;

type Prediction = Record<string, unknown>;

interface CacheEntry {
  prediction: Prediction;
  cachedAt: number;
  version: string;
}

export interface CachedPrediction {
  prediction: Prediction;
  cachedAt: number;
}

export interface TenantContext {
  teacherId: string;
  schoolId: string;
  branchId?: string;
}

// ── Hashing ─────────────────────────────────────────────────────────────────
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const norm = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/\s+/g, " ");

const safeIdPart = (s: string): string => (s || "").replace(/[/.]/g, "_").slice(0, 64);

/** Day key in IST (Asia/Kolkata) — same calendar day → same key.
 *  Honors the IST/UTC date-string memory: never use UTC for India-school
 *  scheduling, the boundary skips events written in early-IST-morning. */
export function dayKeyIST(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Hash of the paper text — same paper string → same key. We hash on the
 *  trimmed + collapsed-whitespace version so trivial whitespace edits don't
 *  bust the cache. */
export function paperHash(paperText: string): string {
  return djb2(norm(paperText));
}

/** Hash of the class roster + their score signatures. Includes per-student
 *  recent-test count + avg, so the prediction recomputes when fresh scores
 *  land (not just when the paper changes). */
export function rosterHash(students: Array<{ studentId?: string; recentTests?: number; avgScore?: number }>): string {
  const parts = students
    .map(s => `${safeIdPart(s.studentId || "")}:${s.recentTests ?? 0}:${Math.round((s.avgScore ?? 0) * 10) / 10}`)
    .sort()
    .join("|");
  return djb2(parts);
}

// ── localStorage key (hashed) ────────────────────────────────────────────────
export function predictionLocalKey(opts: {
  paperHash: string;
  rosterHash: string;
  classId: string;
}): string {
  const parts = [
    "pred",
    opts.paperHash,
    opts.rosterHash,
    norm(opts.classId),
    dayKeyIST(),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

// ── Firestore deterministic doc id (NOT hashed — readable + queryable) ──────
export interface FirestoreCacheCoords {
  teacherId: string;
  classId: string;
  paperHash: string;
  rosterHash: string;
  dayKey?: string;
}

/** Deterministic Firestore doc id — same context + same day → same doc.
 *  Format: `{teacherId}__pred__{classId}__{paperHash}__{rosterHash}__{dayKey}` */
export function firestoreDocId(c: FirestoreCacheCoords): string {
  const day = c.dayKey || dayKeyIST();
  return [
    safeIdPart(c.teacherId),
    "pred",
    safeIdPart(c.classId),
    safeIdPart(c.paperHash),
    safeIdPart(c.rosterHash),
    day,
  ].join("__");
}

// ── Tier 1: in-flight dedup ─────────────────────────────────────────────
const inflight = new Map<string, Promise<Prediction>>();

export function getInflight(key: string): Promise<Prediction> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<Prediction>): void {
  inflight.set(key, p);
  p.finally(() => {
    setTimeout(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    }, INFLIGHT_RETAIN_MS);
  });
}

// ── Tier 2: localStorage 24h ────────────────────────────────────────────
function lsKey(key: string): string {
  return LS_PREFIX + key;
}

export function lsRead(key: string): CachedPrediction | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.prediction) return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      try { window.localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
      return null;
    }
    return { prediction: parsed.prediction, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function lsWrite(key: string, prediction: Prediction): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    pruneLs();
    const entry: CacheEntry = { prediction, cachedAt: Date.now(), version: CACHE_VERSION };
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

// ── Tier 3: Firestore 24h (cross-device daily enforcement) ──────────────
export async function fsRead(coords: FirestoreCacheCoords): Promise<CachedPrediction | null> {
  try {
    const docId = firestoreDocId(coords);
    const snap = await getDoc(doc(db, FS_COLLECTION, docId));
    if (!snap.exists()) return null;
    const data = snap.data() as DocumentData;
    if (data.version !== CACHE_VERSION) return null;
    const cachedAt = Number(data.cachedAtMs ?? 0);
    if (!cachedAt || Date.now() - cachedAt > TTL_MS) return null;
    const prediction = data.prediction as Prediction | undefined;
    if (!prediction || typeof prediction !== "object") return null;
    return { prediction, cachedAt };
  } catch {
    // Firestore read failure is non-fatal — fall through to AI call
    return null;
  }
}

export async function fsWrite(
  coords: FirestoreCacheCoords,
  prediction: Prediction,
  tenant: TenantContext,
): Promise<void> {
  try {
    const docId = firestoreDocId(coords);
    const day = coords.dayKey || dayKeyIST();
    const payload: DocumentData = {
      version: CACHE_VERSION,
      teacherId: tenant.teacherId,
      schoolId: tenant.schoolId,
      branchId: tenant.branchId || "",
      classId: coords.classId,
      paperHash: coords.paperHash,
      rosterHash: coords.rosterHash,
      dayKey: day,
      prediction,
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

// ── 3-tier orchestrator ─────────────────────────────────────────────────
/**
 * The single entry point UI should call. Reads in order LS → FS → invokes
 * `fetchFn` (the AI call) → writes back to FS + LS.
 */
export async function getPredictionWithCache(opts: {
  coords: FirestoreCacheCoords;
  tenant: TenantContext;
  forceRefresh?: boolean;
  fetchFn: () => Promise<Prediction>;
}): Promise<{ prediction: Prediction; fromCache: boolean; cachedAt: number }> {
  const { coords, tenant, forceRefresh, fetchFn } = opts;
  const localKey = predictionLocalKey({
    paperHash: coords.paperHash,
    rosterHash: coords.rosterHash,
    classId: coords.classId,
  });

  if (!forceRefresh) {
    // Tier 1: in-flight dedup — two clicks at once → one network roundtrip
    const live = getInflight(localKey);
    if (live) {
      const prediction = await live;
      return { prediction, fromCache: true, cachedAt: Date.now() };
    }
    // Tier 2: localStorage
    const ls = lsRead(localKey);
    if (ls) return { prediction: ls.prediction, fromCache: true, cachedAt: ls.cachedAt };
    // Tier 3: Firestore
    const fs = await fsRead(coords);
    if (fs) {
      lsWrite(localKey, fs.prediction); // backfill LS so next read is instant
      return { prediction: fs.prediction, fromCache: true, cachedAt: fs.cachedAt };
    }
  }

  // Cache miss (or forced refresh) → fetch from AI
  const promise = fetchFn();
  setInflight(localKey, promise);
  const prediction = await promise;
  // Best-effort writes; either failure is non-fatal
  fsWrite(coords, prediction, tenant);
  lsWrite(localKey, prediction);
  return { prediction, fromCache: false, cachedAt: Date.now() };
}
