/**
 * lessonPlanCache.ts — 2-tier cache for AI-generated lesson plans.
 *
 * Mirrors examPaperCache.ts. Per memory `teacher_dashboard_ai_strategy.md`:
 *   "Lesson Plan Generation — cache by (topic + grade + duration)"
 * (broadened here to include all form fields that affect the AI output).
 *
 * Tier 1 — in-flight dedup: rapid clicks of "Generate plan" with the same
 *          form collapse to ONE OpenAI call.
 * Tier 2 — localStorage, 24-hour TTL: same form within 24h returns the
 *          cached plan instantly, no AI bill. Survives page refresh.
 *
 * Cost target: a teacher iterating on a plan draft bills OpenAI exactly
 * once per substantive form change.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "edul_lesson_plan_";
const CACHE_VERSION = "v1";
const LS_MAX_ENTRIES = 50;
const INFLIGHT_RETAIN_MS = 60_000;

// Use a structural type — caller passes their own LessonPlanResult shape.
// We only need to JSON.stringify it, so keep this loose.
type LessonPlan = Record<string, unknown>;

interface CacheEntry {
  plan: LessonPlan;
  cachedAt: number;
  version: string;
}

export interface LessonPlanFormFields {
  subject: string;
  grade: string;
  topic: string;
  duration_per_lesson: string;
  num_lessons: number;
  board: string;
  learning_goals: string;
  special_considerations: string;
}

// Stable djb2 hash for a short, filesystem-safe key.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const norm = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/\s+/g, " ");

/** Content-derived cache key — same form → same key. */
export function lessonPlanCacheKey(f: LessonPlanFormFields): string {
  const parts = [
    norm(f.subject),
    norm(f.grade),
    norm(f.topic),
    norm(f.duration_per_lesson),
    String(f.num_lessons),
    norm(f.board),
    norm(f.learning_goals),
    norm(f.special_considerations),
  ];
  return `${CACHE_VERSION}_${djb2(parts.join("||"))}`;
}

// ── Tier 1: in-flight dedup ─────────────────────────────────────────────
const inflight = new Map<string, Promise<LessonPlan>>();

export function getInflight(key: string): Promise<LessonPlan> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<LessonPlan>): void {
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

export interface CachedPlan {
  plan: LessonPlan;
  cachedAt: number;
}

export function lsRead(key: string): CachedPlan | null {
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

export function lsWrite(key: string, plan: LessonPlan): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    pruneLs();
    const entry: CacheEntry = { plan, cachedAt: Date.now(), version: CACHE_VERSION };
    window.localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    // Quota or permission issues — fail silently. The next AI call will retry.
  }
}

// Bound storage usage — when entries exceed LS_MAX_ENTRIES, drop the oldest.
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
