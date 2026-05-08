/**
 * summaryCache.ts — 2-tier cache for AI-generated lesson summaries.
 *
 * Mirrors lessonPlanCache.ts. Per memory `teacher_dashboard_ai_strategy.md`:
 *   "Lesson Summary — cache by file hash"
 *
 * Tier 1 — in-flight dedup: rapid clicks of "Generate" with the same file
 *          collapse to ONE OpenAI call.
 * Tier 2 — localStorage, 24-hour TTL: same file within 24h returns the
 *          cached summary instantly. Survives page refresh.
 *
 * Cache key is content-derived from a cheap file fingerprint (filename +
 * size + page count) — not a full SHA of the PDF (which would block the
 * UI). For typical use this gives a high hit rate without the hashing cost.
 *
 * Cost target: a teacher iterating on the same chapter PDF bills OpenAI
 * exactly once per 24h.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "edul_lesson_summary_";
const CACHE_VERSION = "v1";
const LS_MAX_ENTRIES = 50;
const INFLIGHT_RETAIN_MS = 60_000;

// Loose record — caller passes their own SummaryDoc shape.
type Summary = Record<string, unknown>;

interface CacheEntry {
  summary: Summary;
  cachedAt: number;
  version: string;
}

export interface SummaryFingerprint {
  fileName: string;
  fileSize: number;
  pageCount: number;
}

// Stable djb2 hash over a short fingerprint string.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const norm = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/\s+/g, " ");

/** Content-derived cache key — same file → same key. */
export function summaryCacheKey(f: SummaryFingerprint): string {
  const parts = [norm(f.fileName), String(f.fileSize), String(f.pageCount)];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

// ── Tier 1: in-flight dedup ─────────────────────────────────────────────
const inflight = new Map<string, Promise<Summary>>();

export function getInflight(key: string): Promise<Summary> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<Summary>): void {
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

export interface CachedSummary {
  summary: Summary;
  cachedAt: number;
}

export function lsRead(key: string): CachedSummary | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.summary) return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      try { window.localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
      return null;
    }
    return { summary: parsed.summary, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

export function lsWrite(key: string, summary: Summary): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    pruneLs();
    const entry: CacheEntry = { summary, cachedAt: Date.now(), version: CACHE_VERSION };
    window.localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    // Quota or permission issues — fail silently.
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

/** Human-readable age string for the "Cached · X ago" badge. */
export function formatAge(cachedAt: number): string {
  const ms = Date.now() - cachedAt;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return "1d ago";
}
