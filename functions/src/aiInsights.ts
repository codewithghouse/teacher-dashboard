/* OWNER AI INSIGHTS — 3 callable Cloud Functions migrated from Vercel
 * (owner-dashboard/api/{principal,owner,branch-weekly}-insights.js).
 *
 * Bound to the same OPENAI_API_KEY secret as getTeacherAIInsights in index.ts.
 * Owner-only. Returns the same JSON shapes the rule-based generators in
 * principalLeaderboardService.ts / ownerLeaderboardService.ts /
 * branchWeeklyInsights.ts already produce, so the client can transparently
 * fall back when the callable throws (HttpsError → client catch → rule-based).
 */
import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import OpenAI from "openai";

const openaiApiKey = defineSecret("OPENAI_API_KEY");

const MODEL = "gpt-4o-mini";
const OWNER_ONLY = new Set(["owner"]);

// ── Shared helpers ──────────────────────────────────────────────────────────
function clean(v: unknown, max = 200): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function requireOwner(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
  const role = (context.auth.token as any).role;
  if (!role || !OWNER_ONLY.has(role)) {
    throw new functions.https.HttpsError("permission-denied", "Owner only.");
  }
}

function newOpenAI(): OpenAI {
  return new OpenAI({ apiKey: openaiApiKey.value().trim() });
}

async function chatJson(client: OpenAI, opts: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<any> {
  const resp = await client.chat.completions.create({
    model: MODEL,
    temperature: opts.temperature ?? 0.4,
    response_format: { type: "json_object" },
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}

// ════════════════════════════════════════════════════════════════════════════
// 1) getPrincipalInsight  — Principal Leaderboard (owner-dashboard)
// ════════════════════════════════════════════════════════════════════════════

function buildPrincipalTopPrompt(p: any, network: any): string {
  const ratio = p.teachers > 0 ? (p.students / p.teachers).toFixed(1) : "—";
  return `Principal: ${clean(p.name, 80)} (Rank #1 of ${num(network.totalPrincipals)})
Branch: ${clean(p.branchName, 120)}
Network: ${clean(network.name)} · ${clean(network.monthLabel)}

THIS PRINCIPAL'S BRANCH METRICS (real, from Firestore):
- Composite AHI: ${num(p.ahi)} (network avg: ${num(network.networkAvgAhi)})
- Attendance: ${num(p.attendance)}% (network avg: ${num(network.networkAvgAtt)}%)
- Pass rate: ${num(p.passRate)}% (network avg: ${num(network.networkAvgPass)}%)
- Fee collection: ${num(p.feeCollection)}% (network avg: ${num(network.networkAvgFee)}%)
- Students: ${num(p.students)}
- Teachers: ${num(p.teachers)} (student-teacher ratio: ${ratio}:1)
- At-risk students: ${num(p.atRiskStudents)}
- Attendance trend (month-over-month): ${num(p.weekChange).toFixed(1)} pts

You are an experienced school network analyst writing for the OWNER of the
school chain. Generate:

- oneLiner: 1 punchy sentence (max 20 words) summarising why this principal
  is leading. Reference at least one specific number.
- reasons: 3 grounded bullets explaining WHY this principal is at the top.
  Each MUST cite a specific number from the metrics above.
- actions: 3 concrete suggestions for HOW THE OWNER CAN HELP THIS PRINCIPAL
  STAY ON TOP. Make them practical — mentorship, documentation, stretch goals,
  protecting their time, etc. NOT generic "keep up the good work" advice.

Tone: respectful, observational, never sycophantic. Address the principal
in third person (they / their).

Return ONLY this JSON:
{
  "oneLiner": "Single sentence.",
  "reasons": ["Bullet 1 citing numbers.", "Bullet 2.", "Bullet 3."],
  "actions": ["Action 1 — concrete and specific.", "Action 2.", "Action 3."]
}`;
}

function buildPrincipalLowerPrompt(p: any, top: any, network: any, rank: number): string {
  const atRiskPct = p.students > 0 ? (p.atRiskStudents / p.students) * 100 : 0;
  const isDeclining = p.weekChange < -1;
  const isAtRisk    = num(p.ahi) > 0 && num(p.ahi) < 50;
  return `Principal: ${clean(p.name, 80)} (Rank #${rank} of ${num(network.totalPrincipals)})
Branch: ${clean(p.branchName, 120)}
Network: ${clean(network.name)} · ${clean(network.monthLabel)}
Top principal reference: ${clean(top.name, 80)} at ${clean(top.branchName, 120)} (AHI ${num(top.ahi)})

THIS PRINCIPAL'S BRANCH METRICS:
- Composite AHI: ${num(p.ahi)} (network avg: ${num(network.networkAvgAhi)}, top: ${num(top.ahi)})
- Attendance: ${num(p.attendance)}% (top: ${num(top.attendance)}%)
- Pass rate: ${num(p.passRate)}% (top: ${num(top.passRate)}%)
- Fee collection: ${num(p.feeCollection)}% (top: ${num(top.feeCollection)}%)
- Students: ${num(p.students)} · Teachers: ${num(p.teachers)}
- At-risk students: ${num(p.atRiskStudents)} (${atRiskPct.toFixed(1)}% of branch)
- Attendance trend (MoM): ${num(p.weekChange).toFixed(1)} pts (${isDeclining ? "DECLINING" : "stable/up"})

You are an experienced school network analyst writing for the OWNER. This is
${isAtRisk ? "an AT-RISK principal needing intervention" : "a principal in the middle of the pack"}.

Generate:

- oneLiner: 1 punchy sentence (max 22 words) summarising the gap or risk.
  Reference at least one specific gap vs top OR network avg.
- reasons: 3 grounded bullets explaining WHY this principal is at this rank.
  Each MUST cite a specific number (a gap, a target missed, a declining trend).
- actions: 3 concrete steps the OWNER and PRINCIPAL can take together.
  ${isAtRisk
    ? "At-risk: urgency matters. Include at least 1 'this week' action."
    : "Focus on closing the gap to the next rank up. Reference the top principal where useful."}
  Make them practical — specific cohorts, weekly rituals, peer pairing, etc.
- actionsLabel: "${rank === 2 ? "How to reach #1" : rank === 3 ? "How to reach #2" : isAtRisk ? "Recovery plan" : "How to climb the rankings"}"

Tone: direct but supportive, never demoralising.

Return ONLY this JSON:
{
  "oneLiner": "Single sentence.",
  "reasons": ["Bullet 1 citing numbers.", "Bullet 2.", "Bullet 3."],
  "actions": ["Action 1 — specific.", "Action 2.", "Action 3."],
  "actionsLabel": "How to reach #1 | How to climb the rankings | Recovery plan"
}`;
}

function sanitizePrincipalInsight(parsed: any, fallbackLabel: string) {
  const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons : [];
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  return {
    oneLiner: clean(parsed?.oneLiner, 240),
    reasons:  reasons.slice(0, 4).map((r: any) => clean(r, 360)).filter(Boolean),
    actions:  actions.slice(0, 4).map((a: any) => clean(a, 360)).filter(Boolean),
    actionsLabel: clean(parsed?.actionsLabel, 60) || fallbackLabel,
  };
}

export const getPrincipalInsight = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data: any, context) => {
    requireOwner(context);

    const { rank, principal, top, network } = data || {};
    if (!principal || !network || typeof rank !== "number") {
      throw new functions.https.HttpsError("invalid-argument", "Missing principal / network / rank.");
    }
    if (rank > 1 && !top) {
      throw new functions.https.HttpsError("invalid-argument", "Missing top principal reference for non-top rank.");
    }

    const isTop = rank === 1;
    const userPrompt = isTop
      ? buildPrincipalTopPrompt(principal, network)
      : buildPrincipalLowerPrompt(principal, top, network, rank);
    const systemPrompt = isTop
      ? "You are a school network analyst writing for the OWNER. Cite specific numbers from the metrics. Reply ONLY with valid JSON."
      : "You are a school network analyst writing for the OWNER. Diagnose root causes; suggest concrete fixes. Cite specific numbers. Reply ONLY with valid JSON.";
    const fallbackLabel = isTop
      ? "How to keep this lead"
      : (rank === 2 ? "How to reach #1" : rank === 3 ? "How to reach #2" : "How to climb");

    try {
      const client = newOpenAI();
      const parsed = await chatJson(client, { systemPrompt, userPrompt, temperature: 0.5 });
      const insight = sanitizePrincipalInsight(parsed, fallbackLabel);
      if (!insight.oneLiner || insight.reasons.length === 0 || insight.actions.length === 0) {
        throw new functions.https.HttpsError("unavailable", "AI returned empty insight.");
      }
      return { isTop, rank, model: MODEL, generatedAt: Date.now(), insight };
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error("[getPrincipalInsight] error:", err?.message || err);
      throw new functions.https.HttpsError("internal", "AI provider error.");
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 2) getOwnerBranchInsight  — Owner Branch Leaderboard
// ════════════════════════════════════════════════════════════════════════════

function buildBranchTopPrompt(b: any, network: any): string {
  const networkAvg = num(network.networkAvg);
  const atRiskPct  = b.studentCount > 0 ? (b.activeAlerts / b.studentCount) * 100 : 0;
  return `Branch: ${clean(b.name, 120)} (Rank #1 of ${num(network.totalBranches)})
Network: ${clean(network.name)} · ${clean(network.monthLabel)}

METRICS (real, from Firestore aggregation):
- Composite (AHI): ${num(b.ahi)} (network avg: ${networkAvg})
- Attendance: ${num(b.attendance)}%
- Pass rate: ${num(b.passRate)}%
- Fee collection: ${num(b.feeCollection)}%
- At-risk students: ${num(b.activeAlerts)} of ${num(b.studentCount)} (${atRiskPct.toFixed(1)}%)
- Teachers: ${num(b.teacherCount)}

Generate 4-5 specific strength bullets explaining WHY this branch leads.
Each bullet MUST cite a specific number from the metrics above.
Do NOT suggest improvements — this is a top-branch celebration.

Return ONLY this JSON:
{
  "whyTop": [
    { "metric": "Short label e.g. 'Attendance 92%'", "detail": "Specific explanation citing exact numbers" }
  ],
  "pills": ["Label 1", "Label 2", "Label 3", "Label 4"]
}`;
}

function buildBranchLowerPrompt(b: any, top: any, network: any, rank: number): string {
  const atRiskPct = b.studentCount > 0 ? (b.activeAlerts / b.studentCount) * 100 : 0;
  const isDeclining = b.weekChange < -1;
  return `Branch: ${clean(b.name, 120)} (Rank #${rank} of ${num(network.totalBranches)})
Network: ${clean(network.name)} · ${clean(network.monthLabel)}
Top branch reference: ${clean(top.name, 120)} (composite ${num(top.ahi)})

THIS BRANCH METRICS:
- Composite (AHI): ${num(b.ahi)} (network avg: ${num(network.networkAvg)}, top: ${num(top.ahi)})
- Attendance: ${num(b.attendance)}% (top: ${num(top.attendance)}%)
- Pass rate: ${num(b.passRate)}% (top: ${num(top.passRate)}%)
- Fee collection: ${num(b.feeCollection)}% (top: ${num(top.feeCollection)}%)
- At-risk students: ${num(b.activeAlerts)} of ${num(b.studentCount)} (${atRiskPct.toFixed(1)}%)
- Month-over-month attendance change: ${num(b.weekChange).toFixed(1)} points (${isDeclining ? "DECLINING" : "stable/up"})

Generate:
- 2-3 root-cause bullets (cite specific gaps vs top branch or network)
- 3-4 specific solution steps (must reference attendance/pass/fee/at-risk action — be concrete)
- urgent=true ONLY for: branch declining (>1 point drop) OR at-risk pct >= 10%
- solutionLabel: "How to reach #${rank - 1}" if not declining, else "Recovery plan"

Return ONLY this JSON:
{
  "whyHere": [
    { "color": "#FF8800 or #FF453A", "bold": "Short bold label with the specific issue.", "rest": " Continued explanation citing numbers." }
  ],
  "solutions": [
    { "urgent": false, "text": "Concrete action — must name attendance/pass/fee or specific cohort." }
  ],
  "solutionLabel": "How to reach #${rank - 1} | Recovery plan"
}`;
}

const VALID_COLORS = new Set(["#FF8800", "#FF453A"]);

function sanitizeBranchTop(parsed: any) {
  const whyTop = Array.isArray(parsed?.whyTop) ? parsed.whyTop : [];
  const pills  = Array.isArray(parsed?.pills) ? parsed.pills : [];
  return {
    whyTop: whyTop.slice(0, 5).map((it: any) => ({
      metric: clean(it?.metric, 80),
      detail: clean(it?.detail, 400),
    })).filter((x: any) => x.metric && x.detail),
    pills: pills.slice(0, 6).map((p: any) => clean(p, 40)).filter(Boolean),
  };
}

function sanitizeBranchLower(parsed: any) {
  const whyHere = Array.isArray(parsed?.whyHere) ? parsed.whyHere : [];
  const solutions = Array.isArray(parsed?.solutions) ? parsed.solutions : [];
  return {
    whyHere: whyHere.slice(0, 4).map((it: any) => ({
      color: VALID_COLORS.has(it?.color) ? it.color : "#FF8800",
      bold: clean(it?.bold, 120),
      rest: clean(it?.rest, 400),
    })).filter((x: any) => x.bold),
    solutions: solutions.slice(0, 5).map((it: any) => ({
      urgent: Boolean(it?.urgent),
      text: clean(it?.text, 400),
    })).filter((x: any) => x.text),
    solutionLabel: clean(parsed?.solutionLabel, 60) || "How to improve",
  };
}

export const getOwnerBranchInsight = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data: any, context) => {
    requireOwner(context);

    const { rank, branch, top, network } = data || {};
    if (!branch || !network || typeof rank !== "number") {
      throw new functions.https.HttpsError("invalid-argument", "Missing branch / network / rank.");
    }
    if (rank > 1 && !top) {
      throw new functions.https.HttpsError("invalid-argument", "Missing top branch reference for non-top rank.");
    }

    const isTop = rank === 1;
    const userPrompt = isTop
      ? buildBranchTopPrompt(branch, network)
      : buildBranchLowerPrompt(branch, top, network, rank);
    const systemPrompt = isTop
      ? "You are a school network analyst. Explain WHY this branch is ranked #1. Cite specific numbers. Reply ONLY with valid JSON."
      : "You are a school network analyst. Diagnose root causes and suggest concrete fixes. Cite specific numbers. Reply ONLY with valid JSON.";

    try {
      const client = newOpenAI();
      const parsed = await chatJson(client, { systemPrompt, userPrompt, temperature: 0.4 });
      const insight: any = isTop ? sanitizeBranchTop(parsed) : sanitizeBranchLower(parsed);
      if (isTop && (insight.whyTop.length === 0 || insight.pills.length === 0)) {
        throw new functions.https.HttpsError("unavailable", "AI returned empty insight.");
      }
      if (!isTop && (insight.whyHere.length === 0 || insight.solutions.length === 0)) {
        throw new functions.https.HttpsError("unavailable", "AI returned empty insight.");
      }
      return { isTop, rank, model: MODEL, generatedAt: Date.now(), insight };
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error("[getOwnerBranchInsight] error:", err?.message || err);
      throw new functions.https.HttpsError("internal", "AI provider error.");
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 3) getBranchWeeklyInsight  — Branch Detail (4-section narrative)
// ════════════════════════════════════════════════════════════════════════════

function buildBranchWeeklyPrompt(branch: any, network: any): string {
  const name        = clean(branch.name, 120);
  const ahi         = num(branch.ahi);
  const attendance  = num(branch.attendance);
  const passRate    = num(branch.passRate);
  const feeColl     = num(branch.feeCollection);
  const growth      = num(branch.growthRate);
  const studentCount = num(branch.studentCount);
  const teacherCount = num(branch.teacherCount);
  const atRisk      = num(branch.activeAlerts);
  const atRiskPct   = studentCount > 0 ? (atRisk / studentCount) * 100 : 0;

  const netAhi        = num(network.avgAhi);
  const netAttendance = num(network.avgAttendance);
  const netPassRate   = num(network.avgPassRate);
  const netFeeColl    = num(network.avgFeeCollection);

  const recentTrend = Array.isArray(branch.historicalTrend)
    ? branch.historicalTrend
        .filter((t: any) => typeof t?.score === "number")
        .slice(-8)
        .map((t: any) => `${t.period}:${t.score}`).join(", ")
    : "";

  return `Branch: ${name}
Network avg: AHI ${netAhi}, attendance ${netAttendance}%, pass rate ${netPassRate}%, fee collection ${netFeeColl}%

CURRENT METRICS (real, from Firestore aggregation):
- Academic Health Index (AHI): ${ahi} (network avg ${netAhi})
- Attendance: ${attendance}% (network avg ${netAttendance}%)
- Pass rate: ${passRate}% (network avg ${netPassRate}%)
- Fee collection: ${feeColl}% (network avg ${netFeeColl}%)
- Growth rate (MoM): ${growth.toFixed(1)} points
- Students: ${studentCount}, Teachers: ${teacherCount}
- At-risk students: ${atRisk} (${atRiskPct.toFixed(1)}% of class)
- Recent 8-week trend (period:score): ${recentTrend || "no historical data yet"}

Generate the FOUR sections below. Each item MUST cite a specific number from
the metrics above — no vague platitudes. Be honest: if a metric is poor say
so directly with the number, if a metric is strong call it out the same way.

Return ONLY this JSON (no markdown, no commentary):
{
  "trendReasons": [
    { "headline": "Short label (e.g. 'Attendance is climbing')", "detail": "1-2 sentences citing exact numbers and the likely root cause." }
  ],
  "suggestions": [
    { "headline": "Concrete action (e.g. 'Run parent-meeting drive in 2 weeks')", "detail": "1-2 sentences explaining the expected lift and what to measure." }
  ],
  "strengths": [
    { "headline": "Strength label citing the metric (e.g. 'Fee collection 94%')", "detail": "1 sentence explaining why this is a strength and how to preserve it." }
  ],
  "areasOfImprovement": [
    { "headline": "Area label with the gap (e.g. 'Pass rate 12 points below network')", "detail": "1 sentence on what's likely driving the gap." }
  ]
}

Rules:
- 3-4 items in each section
- "headline" max 80 chars, "detail" max 220 chars
- Never invent metrics — if a value is 0 or missing, treat it as "no data yet"
- Tone: senior school analyst briefing the owner — factual, decisive`;
}

function sanitizeBranchWeeklySection(arr: any, max = 4) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, max)
    .map((it: any) => ({
      headline: clean(it?.headline, 80),
      detail:   clean(it?.detail, 220),
    }))
    .filter((it: any) => it.headline && it.detail);
}

export const getBranchWeeklyInsight = functions
  .runWith({ secrets: [openaiApiKey], timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data: any, context) => {
    requireOwner(context);

    const { branch, network } = data || {};
    if (!branch || !network) {
      throw new functions.https.HttpsError("invalid-argument", "Missing branch / network payload.");
    }

    const userPrompt = buildBranchWeeklyPrompt(branch, network);
    const systemPrompt =
      "You are a senior school network analyst. Read the branch's current metrics, " +
      "compare against the network average, and explain trends + recommend next " +
      "steps in plain English. Every bullet must reference a specific number. " +
      "Reply ONLY with valid JSON in the exact schema provided.";

    try {
      const client = newOpenAI();
      const parsed = await chatJson(client, {
        systemPrompt, userPrompt, temperature: 0.4, maxTokens: 1800,
      });
      const insight = {
        trendReasons:       sanitizeBranchWeeklySection(parsed?.trendReasons, 4),
        suggestions:        sanitizeBranchWeeklySection(parsed?.suggestions, 4),
        strengths:          sanitizeBranchWeeklySection(parsed?.strengths, 4),
        areasOfImprovement: sanitizeBranchWeeklySection(parsed?.areasOfImprovement, 4),
      };
      const total = insight.trendReasons.length + insight.suggestions.length
                  + insight.strengths.length + insight.areasOfImprovement.length;
      if (total === 0) {
        throw new functions.https.HttpsError("unavailable", "AI returned empty insight.");
      }
      return { model: MODEL, generatedAt: Date.now(), insight };
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error("[getBranchWeeklyInsight] error:", err?.message || err);
      throw new functions.https.HttpsError("internal", "AI provider error.");
    }
  });
