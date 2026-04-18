// api/_auth.js — shared helpers for serverless API handlers.
// Files with leading _ are NOT exposed as routes by Vercel.
//
// Requires: FIREBASE_ADMIN_SA_JSON env var (stringified service account JSON)
//           OR GOOGLE_APPLICATION_CREDENTIALS on the host.
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";

// ── Admin SDK singleton ────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return admin;
  const saJson = process.env.FIREBASE_ADMIN_SA_JSON;
  if (saJson) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
  } else {
    // Relies on GOOGLE_APPLICATION_CREDENTIALS or ADC on the host.
    admin.initializeApp();
  }
  return admin;
}

// ── Origin allowlist — set via ALLOWED_ORIGINS env (comma-separated) ───────
const DEFAULT_ALLOWED = [
  "https://owner-dashboard-blue.vercel.app",
  "https://principal-dashboard-seven.vercel.app",
  "https://teacher-dashboard-ochre.vercel.app",
  "https://parent-dashboard-ten.vercel.app",
];
function getAllowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return new Set(fromEnv.length ? fromEnv : DEFAULT_ALLOWED);
}

// ── Set CORS headers safely (NO wildcards) ──────────────────────────────────
export function applyCors(req, res) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── Verify Firebase ID token from Authorization: Bearer header ──────────────
// Returns decoded token on success; sends 401 and returns null on failure.
export async function requireAuth(req, res) {
  const authz = req.headers.authorization || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: "Missing auth token" });
    return null;
  }
  try {
    const a = initAdmin();
    return await a.auth().verifyIdToken(token);
  } catch (err) {
    console.warn("[auth] verifyIdToken failed:", err?.code || err?.message);
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

// ── Role gate ──────────────────────────────────────────────────────────────
export function requireRole(decoded, allowedRoles, res) {
  const role = decoded?.role;
  if (!role || !allowedRoles.includes(role)) {
    res.status(403).json({ error: "Insufficient privileges" });
    return false;
  }
  return true;
}

// ── HTML escape ────────────────────────────────────────────────────────────
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ── Tagged template for safe HTML ──────────────────────────────────────────
// Usage: html`<p>${userInput}</p>`  → auto-escapes userInput.
export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => {
    const v = i < values.length ? escapeHtml(values[i]) : "";
    return acc + s + v;
  }, "");
}

// ── Validate + cap a string field ───────────────────────────────────────────
export function boundString(v, max, fallback = "") {
  if (typeof v !== "string") return fallback;
  return v.slice(0, max);
}

// ── Validate RFC-5322-ish email ─────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
}

// ── Validate E.164 phone number (+ up to 15 digits) ─────────────────────────
const E164_RE = /^\+[1-9]\d{7,14}$/;
export function isValidE164(v) {
  return typeof v === "string" && E164_RE.test(v);
}

// ── Simple in-memory rate limiter (per warm lambda instance) ────────────────
// Good enough to cap abuse spikes; for real protection add a Firestore-backed
// counter or Cloud Armor rule.
const RL = new Map();
export function rateLimit(key, maxPerMinute = 20) {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = RL.get(key) || { count: 0, resetAt: now + windowMs };
  if (now >= bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
  bucket.count++;
  RL.set(key, bucket);
  return bucket.count <= maxPerMinute;
}