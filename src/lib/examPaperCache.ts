/**
 * examPaperCache.ts — 2-tier cache for AI-generated exam papers.
 *
 * Tier 1 — in-flight dedup: rapid clicks of "Generate" with the same form
 *          collapse to ONE OpenAI call. Settled promise retained briefly
 *          so back-to-back triggers share the result.
 *
 * Tier 2 — localStorage, 24-hour TTL: same form within 24h returns the
 *          cached paper instantly, no AI bill. Survives page refresh,
 *          scoped per-browser.
 *
 * (Tier 3 — cross-device Firestore cache — deferred. Needs new collection
 *  rule + index deploy. localStorage already eliminates the dominant
 *  cost case: same teacher, same form, repeated clicks.)
 *
 * Cache key is content-derived: (subject, grade, board, topics, difficulty,
 * duration, totalMarks, numQuestions, sorted types, instructions). Decorative
 * fields like teacherName / schoolName are intentionally excluded to maximise
 * hit rate — they only affect the printed header, not the questions.
 *
 * Cost target: a teacher iterating on a paper draft (5-10 clicks) bills
 * OpenAI exactly once per substantive form change.
 */

import type { GeneratedPaper } from "../pages/exam-types";

const TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "edul_exam_paper_";
const CACHE_VERSION = "v1";
const LS_MAX_ENTRIES = 50;
const INFLIGHT_RETAIN_MS = 60_000;

interface CacheEntry {
  paper: GeneratedPaper;
  cachedAt: number;
  version: string;
}

export interface ExamFormFields {
  subject: string;
  grade: string;
  board: string;
  topics: string;
  difficulty: string;
  duration: string;
  totalMarks: number;
  numQuestions: number;
  types: string[];
  instructions: string;
}

// Stable djb2 hash so the key stays short + filesystem-safe.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const norm = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/\s+/g, " ");

/** Content-derived cache key — same form → same key. */
export function examCacheKey(f: ExamFormFields): string {
  const parts = [
    norm(f.subject),
    norm(f.grade),
    norm(f.board),
    norm(f.topics),
    norm(f.difficulty),
    norm(f.duration),
    String(f.totalMarks),
    String(f.numQuestions),
    [...f.types].sort().join(","),
    norm(f.instructions),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

// ── Tier 1: in-flight dedup ─────────────────────────────────────────────
const inflight = new Map<string, Promise<GeneratedPaper>>();

export function getInflight(key: string): Promise<GeneratedPaper> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<GeneratedPaper>): void {
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

export interface CachedPaper {
  paper: GeneratedPaper;
  cachedAt: number;
}

export function lsRead(key: string): CachedPaper | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.paper) return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      try { window.localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
      return null;
    }
    return { paper: parsed.paper, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function lsWrite(key: string, paper: GeneratedPaper): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    pruneLs();
    const entry: CacheEntry = { paper, cachedAt: Date.now(), version: CACHE_VERSION };
    window.localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    // Quota or permission issues — fail silently. The next AI call will retry.
  }
}

// Bound storage usage — when entries exceed LS_MAX_ENTRIES, drop the oldest.
// Each paper can be ~5-20KB; 50 entries ≈ 250KB-1MB, well under the 5MB quota.
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
      } catch { /* skip corrupt entry */ }
    }
    if (ours.length < LS_MAX_ENTRIES) return;
    ours.sort((a, b) => a.cachedAt - b.cachedAt);
    const toRemove = ours.length - LS_MAX_ENTRIES + 1;
    for (let i = 0; i < toRemove; i++) {
      try { window.localStorage.removeItem(ours[i].key); } catch { /* ignore */ }
    }
  } catch { /* no-op */ }
}

/** Human-readable age string for the "X ago" badge. */
export function formatAge(cachedAt: number): string {
  const ms = Date.now() - cachedAt;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return "1d ago";
}
