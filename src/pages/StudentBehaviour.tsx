import { useState, useEffect, useMemo, useRef } from "react";
import {
  collection, query, where, onSnapshot, doc, serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { auditedAdd, auditedUpdate, auditedDelete } from "../lib/auditedWrites";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";
import { useIsMobile } from "../hooks/use-mobile";
import { toast } from "sonner";
import {
  Loader2, Plus, X, Edit3, Trash2, Star, Users,
  TrendingUp, AlertTriangle, CheckCircle2, Sparkles, Search,
} from "lucide-react";

// ── Apple Bright-Blue tokens (matches all other teacher pages) ───────────────
const MA = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  SURFACE: "#F4F7FE",
  P: "#0055FF",
  T1: "#001040", T3: "#5070B0", T4: "#99AACC",
  GREEN: "#00C853",
  RED: "#FF3355",
  ORANGE: "#FF8800",
  GOLD: "#FFAA00",
  VIOLET: "#7B3FF4",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 20px 48px rgba(0,85,255,0.14)",
  SH_SM: "0 0 0 0.5px rgba(0,85,255,0.09), 0 2px 10px rgba(0,85,255,0.10), 0 10px 26px rgba(0,85,255,0.12)",
  BDR: "0.5px solid rgba(0,85,255,0.10)",
  HERO_GRAD: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
};

// ── Types ────────────────────────────────────────────────────────────────────
type Enrollment = { id: string; studentId?: string; studentEmail?: string; studentName?: string; classId?: string; className?: string; rollNo?: string };
type Student = { id: string; name: string; email?: string; classId?: string; className?: string; rollNo?: string };
type Incident = {
  id: string;
  type?: "POSITIVE" | "CONCERN" | "INCIDENT" | string;
  description?: string;
  content?: string;
  studentId?: string;
  createdAt?: { toDate?: () => Date; toMillis?: () => number };
  date?: { toDate?: () => Date; toMillis?: () => number };
};
type Improvement = {
  id: string;
  title?: string;
  description?: string;
  priority?: "low" | "medium" | "high" | string;
  status?: "active" | "resolved" | string;
  studentId?: string;
  createdAt?: { toDate?: () => Date; toMillis?: () => number };
};
type Rating = {
  id: string;
  rating?: number;
  note?: string;
  studentId?: string;
  createdAt?: { toDate?: () => Date; toMillis?: () => number };
};

const toDate = (v: { toDate?: () => Date } | undefined): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  return null;
};

const timeAgo = (ts: { toDate?: () => Date } | undefined) => {
  const d = toDate(ts);
  if (!d) return "";
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const initials = (name = "") => {
  const p = name.trim().split(" ").filter(Boolean);
  return (p.length >= 2 ? p[0][0] + p[1][0] : (p[0] || "??").slice(0, 2)).toUpperCase();
};

// ── Component ────────────────────────────────────────────────────────────────
export default function StudentBehaviour() {
  const { teacherData } = useAuth();
  const isMobile = useIsMobile();

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(true);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);

  // Modals
  const [behaviourModal, setBehaviourModal] = useState<{ open: boolean; edit?: Incident }>({ open: false });
  const [improvementModal, setImprovementModal] = useState<{ open: boolean; edit?: Improvement }>({ open: false });

  // Quick rate state
  const [quickRating, setQuickRating] = useState(0);
  const [quickNote, setQuickNote] = useState("");
  const [savingRating, setSavingRating] = useState(false);

  // ── Load enrolled students ──
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setLoadingStudents(true);
    const qEnroll = query(
      collection(db, "enrollments"),
      where("schoolId", "==", teacherData.schoolId),
      where("teacherId", "==", teacherData.id),
    );
    const unsub = onSnapshot(qEnroll, snap => {
      const docs = snap.docs.map(d => ({ ...(d.data() as Enrollment), id: d.id }));
      const map = new Map<string, Student>();
      docs.forEach(e => {
        const sid = e.studentId || e.studentEmail;
        if (!sid || map.has(sid)) return;
        map.set(sid, {
          id: sid,
          name: e.studentName || e.studentEmail || "Student",
          email: e.studentEmail,
          classId: e.classId,
          className: e.className,
          rollNo: e.rollNo,
        });
      });
      const arr = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      setStudents(arr);
      setSelectedId(prev => prev || arr[0]?.id || "");
      setLoadingStudents(false);
    });
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId]);

  // ── Load behaviour data for selected student ──
  useEffect(() => {
    if (!teacherData?.schoolId || !selectedId) {
      setIncidents([]); setImprovements([]); setRatings([]);
      return;
    }
    const SC: QueryConstraint[] = [
      where("schoolId", "==", teacherData.schoolId),
      where("studentId", "==", selectedId),
    ];

    const u1 = onSnapshot(
      query(collection(db, "incidents"), ...SC),
      snap => setIncidents(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Incident)),
      err => console.warn("[StudentBehaviour/incidents]", err.code),
    );
    const u2 = onSnapshot(
      query(collection(db, "improvement_areas"), ...SC),
      snap => setImprovements(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Improvement)),
      err => console.warn("[StudentBehaviour/improvements]", err.code),
    );
    const u3 = onSnapshot(
      query(collection(db, "student_ratings"), ...SC),
      snap => setRatings(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Rating)),
      err => console.warn("[StudentBehaviour/ratings]", err.code),
    );
    return () => { u1(); u2(); u3(); };
  }, [teacherData?.schoolId, selectedId]);

  const selected = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);

  // ── Computed metrics ──
  const sortedRatings = useMemo(
    () => [...ratings].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [ratings],
  );
  const avgRating = useMemo(() => {
    if (ratings.length === 0) return 0;
    return ratings.reduce((a, r) => a + (r.rating || 0), 0) / ratings.length;
  }, [ratings]);
  const positiveCount = incidents.filter(i => i.type === "POSITIVE").length;
  const concernCount = incidents.filter(i => i.type === "CONCERN" || i.type === "INCIDENT").length;
  const activeImprovements = improvements.filter(i => i.status !== "resolved").length;
  const sortedIncidents = useMemo(
    () => [...incidents].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [incidents],
  );
  const sortedImprovements = useMemo(
    () => [...improvements].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [improvements],
  );

  // Filter students by search
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => s.name.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q));
  }, [students, search]);

  // ── Quick rate ──
  const handleQuickRate = async () => {
    if (!selected || quickRating === 0) {
      toast.error("Pick a star rating first.");
      return;
    }
    setSavingRating(true);
    try {
      await auditedAdd(collection(db, "student_ratings"), {
        studentId: selected.id,
        studentName: selected.name,
        schoolId: teacherData?.schoolId || "",
        branchId: teacherData?.branchId || "",
        teacherId: teacherData?.id || "",
        teacherName: teacherData?.name || "",
        classId: selected.classId || "",
        className: selected.className || "",
        rating: quickRating,
        note: quickNote.trim(),
        createdAt: serverTimestamp(),
      });
      toast.success(`Rated ${selected.name} ${quickRating}/5`);
      setQuickRating(0);
      setQuickNote("");
    } catch (e) {
      console.error("[StudentBehaviour] quickRate failed", e);
      toast.error("Failed to save rating.");
    } finally {
      setSavingRating(false);
    }
  };

  // ── Delete handlers ──
  const deleteIncident = async (id: string) => {
    if (!window.confirm("Delete this behaviour entry?")) return;
    try {
      await auditedDelete(doc(db, "incidents", id));
      toast.success("Behaviour entry deleted.");
    } catch (e) {
      console.error("[StudentBehaviour] deleteIncident", e);
      toast.error("Delete failed.");
    }
  };
  const deleteImprovement = async (id: string) => {
    if (!window.confirm("Delete this improvement area?")) return;
    try {
      await auditedDelete(doc(db, "improvement_areas", id));
      toast.success("Improvement area deleted.");
    } catch (e) {
      console.error("[StudentBehaviour] deleteImprovement", e);
      toast.error("Delete failed.");
    }
  };
  const toggleImprovementStatus = async (imp: Improvement) => {
    const next = imp.status === "resolved" ? "active" : "resolved";
    try {
      await auditedUpdate(doc(db, "improvement_areas", imp.id), { status: next });
      toast.success(next === "resolved" ? "Marked resolved." : "Reopened.");
    } catch (e) {
      console.error("[StudentBehaviour] toggleImprovement", e);
      toast.error("Update failed.");
    }
  };

  // ── Type/priority color helpers ──
  const incidentTone = (t?: string) =>
    t === "POSITIVE" ? { bg: "rgba(0,200,83,0.10)", color: MA.GREEN, label: "Positive" }
    : t === "CONCERN" ? { bg: "rgba(255,136,0,0.12)", color: MA.ORANGE, label: "Concern" }
    : { bg: "rgba(255,51,85,0.10)", color: MA.RED, label: "Incident" };

  const priorityTone = (p?: string) =>
    p === "high" ? { bg: "rgba(255,51,85,0.10)", color: MA.RED, label: "High" }
    : p === "medium" ? { bg: "rgba(255,136,0,0.12)", color: MA.ORANGE, label: "Medium" }
    : { bg: "rgba(0,85,255,0.08)", color: MA.P, label: "Low" };

  return (
    <div
      className="-mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8"
      style={{ background: MA.BG, minHeight: "100vh", fontFamily: MA.FONT, fontVariantNumeric: "tabular-nums" }}
    >
      <style>{`
        @keyframes sbFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .sb-enter > * { animation: sbFadeUp .42s cubic-bezier(.34,1.56,.64,1) both; }
        .sb-enter > *:nth-child(1) { animation-delay: .04s; }
        .sb-enter > *:nth-child(2) { animation-delay: .10s; }
        .sb-enter > *:nth-child(3) { animation-delay: .16s; }
        .sb-enter > *:nth-child(4) { animation-delay: .22s; }
        .sb-enter > *:nth-child(5) { animation-delay: .28s; }
        .sb-press { transition: transform .16s cubic-bezier(.34,1.56,.64,1); }
        .sb-press:active { transform: scale(.96); }
        .sb-row { transition: background .16s ease; }
        .sb-row:hover { background: rgba(0,85,255,0.04); }
        .sb-star { transition: transform .12s ease, color .12s ease; cursor: pointer; }
        .sb-star:hover { transform: scale(1.15); }
      `}</style>

      <div className={isMobile ? "px-3 pt-3 pb-24" : "max-w-[1400px] mx-auto px-8 pt-6 pb-12"}>

        <div style={{ marginBottom: isMobile ? 14 : 22 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: MA.P }} />
            Teacher Dashboard · Behaviour & Growth
          </div>
          <h1 style={{ fontSize: isMobile ? 26 : 34, fontWeight: 700, color: MA.T1, letterSpacing: "-1.2px", lineHeight: 1.05, margin: 0 }}>
            Student <span style={{ color: MA.P }}>behaviour</span>
          </h1>
          <div style={{ fontSize: 13, color: MA.T3, fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
            Track behaviour, areas of improvement, and ratings · syncs to parent portal in real time.
          </div>
        </div>

        {loadingStudents ? (
          <div style={{ background: MA.CARD, borderRadius: 18, padding: "60px 20px", display: "flex", justifyContent: "center", boxShadow: MA.SH, border: MA.BDR }}>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: MA.P }} />
          </div>
        ) : students.length === 0 ? (
          <div style={{ background: MA.CARD, borderRadius: 22, padding: "40px 20px", textAlign: "center", boxShadow: MA.SH, border: MA.BDR }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: "rgba(0,85,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Users className="w-7 h-7" style={{ color: MA.P }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: MA.T1, marginBottom: 6 }}>No students assigned yet</div>
            <div style={{ fontSize: 12, color: MA.T3 }}>Once your principal enrolls students under your classes, they will appear here.</div>
          </div>
        ) : (
          <div className="sb-enter" style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 18 }}>

            <div style={{ background: MA.CARD, borderRadius: 22, padding: isMobile ? 14 : 18, boxShadow: MA.SH, border: MA.BDR }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Search className="w-4 h-4" style={{ color: MA.T4, flexShrink: 0 }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search students…"
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 12,
                    border: "0.5px solid rgba(0,85,255,0.12)",
                    background: MA.SURFACE,
                    fontSize: 13, fontWeight: 500, color: MA.T1,
                    fontFamily: MA.FONT, outline: "none",
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: MA.T3 }}>
                  {filteredStudents.length} / {students.length}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                {filteredStudents.map(s => {
                  const active = s.id === selectedId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className="sb-press"
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 14px", borderRadius: 999,
                        background: active ? MA.P : MA.SURFACE,
                        color: active ? "#fff" : MA.T1,
                        border: `0.5px solid ${active ? "transparent" : "rgba(0,85,255,0.12)"}`,
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                        boxShadow: active ? "0 4px 12px rgba(0,85,255,0.3)" : "none",
                        fontFamily: MA.FONT, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: active ? "rgba(255,255,255,0.2)" : "rgba(0,85,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: active ? "#fff" : MA.P }}>
                        {initials(s.name)}
                      </span>
                      {s.name}
                      {s.className && <span style={{ fontSize: 10, opacity: 0.6 }}>· {s.className}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {selected && (
              <>
                <div
                  {...tilt3D}
                  style={{
                    background: MA.HERO_GRAD, borderRadius: 24, padding: isMobile ? 18 : 26,
                    color: "#fff", position: "relative", overflow: "hidden",
                    boxShadow: MA.SH, ...tilt3DStyle,
                  }}
                >
                  <div style={{ position: "absolute", top: -50, right: -30, width: 240, height: 240, background: "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)", borderRadius: "50%", pointerEvents: "none" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 18, position: "relative", zIndex: 1 }}>
                    <div style={{
                      width: isMobile ? 56 : 72, height: isMobile ? 56 : 72,
                      borderRadius: 18,
                      background: "rgba(255,255,255,0.16)",
                      border: "0.5px solid rgba(255,255,255,0.26)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                      fontSize: isMobile ? 18 : 24, fontWeight: 700, color: "#fff", letterSpacing: "-0.4px",
                    }}>
                      {initials(selected.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)", border: "0.5px solid rgba(255,255,255,0.22)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
                        <Sparkles className="w-3 h-3" />
                        Behaviour profile
                      </div>
                      <h2 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, letterSpacing: "-0.6px", margin: 0, color: "#fff", lineHeight: 1.1 }}>
                        {selected.name}
                      </h2>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", fontWeight: 500, margin: "5px 0 0 0" }}>
                        {selected.className || "Class —"} · Roll {selected.rollNo || "—"}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star
                            key={n}
                            className="w-4 h-4"
                            style={{
                              color: n <= Math.round(avgRating) ? "#FFD060" : "rgba(255,255,255,0.18)",
                              fill: n <= Math.round(avgRating) ? "#FFD060" : "transparent",
                            }}
                          />
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.65)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        {ratings.length === 0 ? "Not rated" : `${avgRating.toFixed(1)} avg · ${ratings.length}`}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: isMobile ? 10 : 14 }}>
                  {([
                    {
                      key: "rating", label: "Avg Rating",
                      value: ratings.length === 0 ? "—" : avgRating.toFixed(1),
                      sub: `${ratings.length} ratings on record`,
                      color: "#FFAA00",
                      tintBg: "linear-gradient(135deg, #FFF6E0 0%, #FFEDC4 100%)",
                      tintBorder: "rgba(255,170,0,0.16)",
                      icon: <Star className="w-[18px] h-[18px]" />,
                      decor: <Star className="w-[60px] h-[60px]" strokeWidth={1.5} />,
                      onClick: () => document.getElementById("sb-quick-rate")?.scrollIntoView({ behavior: "smooth", block: "center" }),
                    },
                    {
                      key: "behaviour", label: "Behaviour Entries",
                      value: incidents.length.toString(),
                      sub: `${positiveCount} positive · ${concernCount} concern`,
                      color: incidents.length === 0 ? "#0055FF" : concernCount > positiveCount ? "#FF3355" : "#00C853",
                      tintBg: incidents.length === 0
                        ? "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)"
                        : concernCount > positiveCount
                          ? "linear-gradient(135deg, #FFEEF0 0%, #FFE2E6 100%)"
                          : "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)",
                      tintBorder: incidents.length === 0 ? "rgba(0,85,255,0.10)" : concernCount > positiveCount ? "rgba(255,51,85,0.14)" : "rgba(0,200,83,0.16)",
                      icon: <AlertTriangle className="w-[18px] h-[18px]" />,
                      decor: <AlertTriangle className="w-[60px] h-[60px]" strokeWidth={1.5} />,
                      onClick: () => document.getElementById("sb-behaviour-log")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    },
                    {
                      key: "improvements", label: "Active Improvements",
                      value: activeImprovements.toString(),
                      sub: improvements.length === 0 ? "Nothing tracked yet" : `${improvements.length - activeImprovements} resolved`,
                      color: "#7B3FF4",
                      tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)",
                      tintBorder: "rgba(123,63,244,0.12)",
                      icon: <TrendingUp className="w-[18px] h-[18px]" />,
                      decor: <TrendingUp className="w-[60px] h-[60px]" strokeWidth={1.5} />,
                      onClick: () => document.getElementById("sb-improvements")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    },
                  ] as const).map(k => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={k.onClick}
                      {...tilt3D}
                      aria-label={`${k.label}: ${k.value}`}
                      style={{
                        background: k.tintBg, borderRadius: 20, padding: isMobile ? 14 : 20,
                        position: "relative", overflow: "hidden",
                        border: `0.5px solid ${k.tintBorder}`,
                        boxShadow: "0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)",
                        cursor: "pointer", textAlign: "left",
                        fontFamily: MA.FONT,
                        ...tilt3DStyle,
                      }}
                    >
                      <div style={{ position: "absolute", right: 14, bottom: 12, color: k.color, opacity: 0.22, pointerEvents: "none" }}>
                        {k.decor}
                      </div>
                      <div style={{ width: 38, height: 38, borderRadius: 12, background: `${k.color}1F`, color: k.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, position: "relative", zIndex: 1 }}>
                        {k.icon}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: k.color, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6, position: "relative", zIndex: 1 }}>{k.label}</div>
                      <div style={{ fontSize: isMobile ? 26 : 32, fontWeight: 700, color: "#001040", letterSpacing: "-1.2px", lineHeight: 1.05, position: "relative", zIndex: 1 }}>{k.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#5070B0", marginTop: 8, position: "relative", zIndex: 1 }}>{k.sub}</div>
                    </button>
                  ))}
                </div>

                <div
                  id="sb-quick-rate"
                  {...tilt3D}
                  style={{
                    background: MA.CARD, borderRadius: 22, padding: isMobile ? 16 : 22,
                    boxShadow: MA.SH, border: MA.BDR, ...tilt3DStyle,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#FFAA00,#FFCC55)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(255,170,0,0.3)" }}>
                      <Star className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: MA.T1, letterSpacing: "-0.2px" }}>Quick rate</div>
                      <div style={{ fontSize: 11, color: MA.T3, fontWeight: 500 }}>Snapshot rating that flows to parent dashboard.</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 14, padding: "10px 0", background: MA.SURFACE, borderRadius: 14 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuickRating(n)}
                        className="sb-star sb-press"
                        aria-label={`Rate ${n} out of 5`}
                        style={{ background: "none", border: "none", padding: 4 }}
                      >
                        <Star
                          className="w-7 h-7"
                          style={{
                            color: n <= quickRating ? MA.GOLD : "#D5DEEC",
                            fill: n <= quickRating ? MA.GOLD : "transparent",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={quickNote}
                    onChange={e => setQuickNote(e.target.value)}
                    placeholder="Optional note (visible to parents)…"
                    rows={2}
                    maxLength={300}
                    style={{
                      width: "100%", padding: "12px 14px", borderRadius: 12,
                      border: "0.5px solid rgba(0,85,255,0.12)", background: MA.SURFACE,
                      fontSize: 13, color: MA.T1, fontFamily: MA.FONT, outline: "none",
                      resize: "none", lineHeight: 1.5, marginBottom: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleQuickRate}
                    disabled={savingRating || quickRating === 0}
                    className="sb-press"
                    style={{
                      width: "100%", height: 46, borderRadius: 14,
                      background: quickRating === 0 ? MA.SURFACE : MA.P,
                      color: quickRating === 0 ? MA.T4 : "#fff",
                      fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
                      border: "none", fontFamily: MA.FONT,
                      cursor: quickRating === 0 || savingRating ? "not-allowed" : "pointer",
                      boxShadow: quickRating === 0 ? "none" : "0 6px 18px rgba(0,85,255,0.32)",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}
                  >
                    {savingRating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Star className="w-4 h-4" /> Save rating</>}
                  </button>
                </div>

                <div
                  id="sb-behaviour-log"
                  {...tilt3D}
                  style={{
                    background: MA.CARD, borderRadius: 22,
                    boxShadow: MA.SH, border: MA.BDR, overflow: "hidden",
                    ...tilt3DStyle,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "14px 16px" : "16px 22px", borderBottom: "0.5px solid rgba(0,85,255,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(0,85,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <AlertTriangle className="w-4 h-4" style={{ color: MA.P }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: MA.T1, letterSpacing: "-0.2px" }}>
                          Behaviour Log
                        </div>
                        <div style={{ fontSize: 11, color: MA.T3, fontWeight: 500 }}>
                          {incidents.length} {incidents.length === 1 ? "entry" : "entries"} · positive + concerns
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBehaviourModal({ open: true })}
                      className="sb-press"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "8px 14px", borderRadius: 12,
                        background: MA.P, color: "#fff",
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                        border: "none", fontFamily: MA.FONT, cursor: "pointer",
                        boxShadow: "0 4px 12px rgba(0,85,255,0.28)",
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                  <div style={{ padding: isMobile ? "8px 16px 14px" : "8px 22px 18px" }}>
                    {sortedIncidents.length === 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px", background: "rgba(0,200,83,0.06)", borderRadius: 12, border: "0.5px solid rgba(0,200,83,0.18)" }}>
                        <CheckCircle2 className="w-4 h-4" style={{ color: MA.GREEN }} />
                        <span style={{ fontSize: 12, color: MA.GREEN, fontWeight: 600 }}>No behaviour entries yet — clean record.</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {sortedIncidents.map((inc, idx) => {
                          const tone = incidentTone(inc.type);
                          return (
                            <div
                              key={inc.id}
                              className="sb-row"
                              style={{
                                display: "flex", alignItems: "flex-start", gap: 12,
                                padding: "12px 8px", borderRadius: 10,
                                borderBottom: idx < sortedIncidents.length - 1 ? "0.5px solid rgba(0,85,255,0.06)" : "none",
                              }}
                            >
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: tone.color, marginTop: 8, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                  <span style={{ padding: "2px 9px", borderRadius: 6, background: tone.bg, color: tone.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                    {tone.label}
                                  </span>
                                  <span style={{ fontSize: 11, color: MA.T4 }}>{timeAgo(inc.createdAt || inc.date)}</span>
                                </div>
                                <p style={{ fontSize: 13, color: MA.T1, lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
                                  {inc.description || inc.content || "—"}
                                </p>
                              </div>
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                <button type="button" aria-label="Edit" onClick={() => setBehaviourModal({ open: true, edit: inc })}
                                  className="sb-press"
                                  style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(0,85,255,0.06)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                                  <Edit3 className="w-3.5 h-3.5" style={{ color: MA.P }} />
                                </button>
                                <button type="button" aria-label="Delete" onClick={() => deleteIncident(inc.id)}
                                  className="sb-press"
                                  style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,51,85,0.08)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                                  <Trash2 className="w-3.5 h-3.5" style={{ color: MA.RED }} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  id="sb-improvements"
                  {...tilt3D}
                  style={{
                    background: MA.CARD, borderRadius: 22,
                    boxShadow: MA.SH, border: MA.BDR, overflow: "hidden",
                    ...tilt3DStyle,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "14px 16px" : "16px 22px", borderBottom: "0.5px solid rgba(0,85,255,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(123,63,244,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <TrendingUp className="w-4 h-4" style={{ color: MA.VIOLET }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: MA.T1, letterSpacing: "-0.2px" }}>
                          Areas of Improvement
                        </div>
                        <div style={{ fontSize: 11, color: MA.T3, fontWeight: 500 }}>
                          {activeImprovements} active · {improvements.length - activeImprovements} resolved
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setImprovementModal({ open: true })}
                      className="sb-press"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "8px 14px", borderRadius: 12,
                        background: MA.VIOLET, color: "#fff",
                        fontSize: 12, fontWeight: 700, letterSpacing: "-0.15px",
                        border: "none", fontFamily: MA.FONT, cursor: "pointer",
                        boxShadow: "0 4px 12px rgba(123,63,244,0.32)",
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                  <div style={{ padding: isMobile ? "8px 16px 14px" : "8px 22px 18px" }}>
                    {sortedImprovements.length === 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px", background: MA.SURFACE, borderRadius: 12, border: "0.5px dashed rgba(0,85,255,0.16)" }}>
                        <Sparkles className="w-4 h-4" style={{ color: MA.T4 }} />
                        <span style={{ fontSize: 12, color: MA.T3, fontWeight: 600 }}>No improvement areas tracked yet. Add one to set a goal.</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {sortedImprovements.map((imp, idx) => {
                          const ptone = priorityTone(imp.priority);
                          const resolved = imp.status === "resolved";
                          return (
                            <div
                              key={imp.id}
                              className="sb-row"
                              style={{
                                display: "flex", alignItems: "flex-start", gap: 12,
                                padding: "12px 8px", borderRadius: 10,
                                borderBottom: idx < sortedImprovements.length - 1 ? "0.5px solid rgba(0,85,255,0.06)" : "none",
                                opacity: resolved ? 0.65 : 1,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleImprovementStatus(imp)}
                                aria-label={resolved ? "Reopen" : "Mark resolved"}
                                className="sb-press"
                                style={{
                                  width: 22, height: 22, borderRadius: 6,
                                  background: resolved ? MA.GREEN : "transparent",
                                  border: `1.5px solid ${resolved ? MA.GREEN : "rgba(0,85,255,0.25)"}`,
                                  flexShrink: 0, marginTop: 2,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  cursor: "pointer",
                                }}
                              >
                                {resolved && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                              </button>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: MA.T1, letterSpacing: "-0.2px", textDecoration: resolved ? "line-through" : "none" }}>
                                    {imp.title || "Untitled"}
                                  </span>
                                  <span style={{ padding: "2px 8px", borderRadius: 6, background: ptone.bg, color: ptone.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                    {ptone.label}
                                  </span>
                                  <span style={{ fontSize: 11, color: MA.T4 }}>{timeAgo(imp.createdAt)}</span>
                                </div>
                                {imp.description && (
                                  <p style={{ fontSize: 12, color: MA.T3, lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
                                    {imp.description}
                                  </p>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                <button type="button" aria-label="Edit" onClick={() => setImprovementModal({ open: true, edit: imp })}
                                  className="sb-press"
                                  style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(0,85,255,0.06)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                                  <Edit3 className="w-3.5 h-3.5" style={{ color: MA.P }} />
                                </button>
                                <button type="button" aria-label="Delete" onClick={() => deleteImprovement(imp.id)}
                                  className="sb-press"
                                  style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,51,85,0.08)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                                  <Trash2 className="w-3.5 h-3.5" style={{ color: MA.RED }} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {sortedRatings.length > 0 && (
                  <div
                    {...tilt3D}
                    style={{
                      background: MA.CARD, borderRadius: 22,
                      boxShadow: MA.SH, border: MA.BDR, overflow: "hidden",
                      ...tilt3DStyle,
                    }}
                  >
                    <div style={{ padding: isMobile ? "14px 16px 6px" : "16px 22px 6px", borderBottom: "0.5px solid rgba(0,85,255,0.08)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,170,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Star className="w-4 h-4" style={{ color: MA.GOLD }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: MA.T1, letterSpacing: "-0.2px" }}>Rating History</div>
                          <div style={{ fontSize: 11, color: MA.T3, fontWeight: 500 }}>Last {Math.min(sortedRatings.length, 6)} ratings</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: isMobile ? "10px 16px 14px" : "12px 22px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {sortedRatings.slice(0, 6).map(r => (
                        <div
                          key={r.id}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 10,
                            padding: "10px 12px", borderRadius: 12,
                            background: MA.SURFACE,
                            border: "0.5px solid rgba(0,85,255,0.06)",
                          }}
                        >
                          <div style={{ display: "flex", gap: 1, flexShrink: 0, marginTop: 2 }}>
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star key={n} className="w-3 h-3" style={{ color: n <= (r.rating || 0) ? MA.GOLD : "#D5DEEC", fill: n <= (r.rating || 0) ? MA.GOLD : "transparent" }} />
                            ))}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {r.note && <p style={{ fontSize: 12, color: MA.T1, fontWeight: 500, margin: 0, lineHeight: 1.5 }}>{r.note}</p>}
                            <div style={{ fontSize: 10, color: MA.T4, fontWeight: 600, marginTop: 3 }}>{timeAgo(r.createdAt)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    background: "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)",
                    borderRadius: 22, padding: isMobile ? 18 : 24, color: "#fff",
                    position: "relative", overflow: "hidden",
                    boxShadow: MA.SH,
                  }}
                >
                  <div style={{ position: "absolute", bottom: -50, left: -40, width: 240, height: 240, background: "radial-gradient(circle, rgba(123,63,244,0.28) 0%, transparent 65%)", borderRadius: "50%", pointerEvents: "none" }} />
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, position: "relative", zIndex: 1, marginBottom: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(255,255,255,0.18)", border: "0.5px solid rgba(255,255,255,0.28)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)", border: "0.5px solid rgba(255,255,255,0.22)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                        AI Behaviour Intelligence
                      </div>
                      <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.4px", marginBottom: 6 }}>
                        Growth Summary
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.82)", lineHeight: 1.6 }}>
                        {ratings.length === 0 ? (
                          <>No ratings yet — start with the <strong style={{ color: "#fff" }}>Quick rate</strong> panel above to baseline {selected.name}.</>
                        ) : avgRating >= 4 ? (
                          <><strong style={{ color: "#fff" }}>{selected.name} is performing strongly</strong> — average {avgRating.toFixed(1)}/5 across {ratings.length} ratings. {activeImprovements > 0 ? `${activeImprovements} growth area${activeImprovements === 1 ? "" : "s"} to keep momentum.` : "Maintain consistency."}</>
                        ) : avgRating >= 3 ? (
                          <><strong style={{ color: "#fff" }}>Steady progress</strong> — average {avgRating.toFixed(1)}/5. {concernCount > 0 ? `Address ${concernCount} concern${concernCount === 1 ? "" : "s"} this week.` : "Add a positive entry to celebrate wins."}</>
                        ) : (
                          <><strong style={{ color: "#fff" }}>Needs attention</strong> — average {avgRating.toFixed(1)}/5. Schedule a 1:1 with parents and document {activeImprovements === 0 ? "improvement areas to focus on" : `progress on ${activeImprovements} active area${activeImprovements === 1 ? "" : "s"}`}.</>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, position: "relative", zIndex: 1 }}>
                    {[
                      { label: "Avg Rating", value: ratings.length === 0 ? "—" : avgRating.toFixed(1), color: "#FFD088" },
                      { label: "Positive", value: positiveCount.toString(), color: "#6FFFAA" },
                      { label: "Concerns", value: concernCount.toString(), color: concernCount > 0 ? "#FF9AA9" : "rgba(255,255,255,0.6)" },
                    ].map(s => (
                      <div key={s.label} style={{ background: "rgba(255,255,255,0.10)", borderRadius: 12, padding: "10px 12px", border: "0.5px solid rgba(255,255,255,0.14)" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.65)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: s.color, letterSpacing: "-0.4px" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {behaviourModal.open && selected && (
        <BehaviourModal
          edit={behaviourModal.edit}
          student={selected}
          teacherData={teacherData}
          onClose={() => setBehaviourModal({ open: false })}
        />
      )}

      {improvementModal.open && selected && (
        <ImprovementModal
          edit={improvementModal.edit}
          student={selected}
          teacherData={teacherData}
          onClose={() => setImprovementModal({ open: false })}
        />
      )}
    </div>
  );
}

type ModalProps<E> = {
  edit?: E;
  student: Student;
  teacherData: ReturnType<typeof useAuth>["teacherData"];
  onClose: () => void;
};

function BehaviourModal({ edit, student, teacherData, onClose }: ModalProps<Incident>) {
  const [type, setType] = useState<"POSITIVE" | "CONCERN" | "INCIDENT">((edit?.type as "POSITIVE" | "CONCERN" | "INCIDENT") || "POSITIVE");
  const [description, setDescription] = useState(edit?.description || edit?.content || "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handleSave = async () => {
    if (!description.trim()) { toast.error("Description is required."); return; }
    setSaving(true);
    try {
      const payload = {
        type, description: description.trim(),
        studentId: student.id,
        studentName: student.name,
        classId: student.classId || "",
        className: student.className || "",
        schoolId: teacherData?.schoolId || "",
        branchId: teacherData?.branchId || "",
        teacherId: teacherData?.id || "",
        teacherName: teacherData?.name || "",
      };
      if (edit) {
        await auditedUpdate(doc(db, "incidents", edit.id), payload);
        toast.success("Updated.");
      } else {
        await auditedAdd(collection(db, "incidents"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Behaviour entry added.");
      }
      onClose();
    } catch (e) {
      console.error("[BehaviourModal] save", e);
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,16,64,0.4)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: MA.CARD, borderRadius: 22, width: 440, maxWidth: "100%", padding: 22, boxShadow: "0 20px 60px rgba(0,8,40,0.3)", fontFamily: MA.FONT }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: MA.T1, letterSpacing: "-0.3px" }}>{edit ? "Edit" : "Add"} behaviour entry</div>
            <div style={{ fontSize: 11, color: MA.T3, marginTop: 2 }}>For {student.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, background: MA.SURFACE, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X className="w-4 h-4" style={{ color: MA.T3 }} />
          </button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Type</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["POSITIVE", "CONCERN", "INCIDENT"] as const).map(t => {
              const active = type === t;
              const c = t === "POSITIVE" ? MA.GREEN : t === "CONCERN" ? MA.ORANGE : MA.RED;
              return (
                <button key={t} type="button" onClick={() => setType(t)}
                  style={{
                    flex: 1, padding: "9px 10px", borderRadius: 10,
                    background: active ? c : MA.SURFACE,
                    color: active ? "#fff" : MA.T3,
                    fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
                    border: "none", cursor: "pointer", fontFamily: MA.FONT,
                    textTransform: "capitalize",
                  }}>
                  {t.toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>
            Description <span style={{ color: MA.RED }}>*</span>
          </div>
          <textarea
            ref={ref}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What happened? Be specific…"
            rows={4} maxLength={500}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12,
              border: "0.5px solid rgba(0,85,255,0.15)", background: MA.SURFACE,
              fontSize: 13, color: MA.T1, fontFamily: MA.FONT, outline: "none",
              resize: "none", lineHeight: 1.5,
            }}
          />
          <div style={{ textAlign: "right", fontSize: 10, color: MA.T4, marginTop: 4 }}>{description.length}/500</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ flex: "0 0 100px", height: 44, borderRadius: 12, background: MA.SURFACE, color: MA.T1, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !description.trim()}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              background: !description.trim() ? MA.SURFACE : MA.P,
              color: !description.trim() ? MA.T4 : "#fff",
              fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
              border: "none", cursor: saving || !description.trim() ? "not-allowed" : "pointer",
              fontFamily: MA.FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              boxShadow: !description.trim() ? "none" : "0 6px 18px rgba(0,85,255,0.32)",
            }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : edit ? "Save changes" : "Add entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImprovementModal({ edit, student, teacherData, onClose }: ModalProps<Improvement>) {
  const [title, setTitle] = useState(edit?.title || "");
  const [description, setDescription] = useState(edit?.description || "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">((edit?.priority as "low" | "medium" | "high") || "medium");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        priority,
        status: edit?.status || "active",
        studentId: student.id,
        studentName: student.name,
        classId: student.classId || "",
        className: student.className || "",
        schoolId: teacherData?.schoolId || "",
        branchId: teacherData?.branchId || "",
        teacherId: teacherData?.id || "",
        teacherName: teacherData?.name || "",
      };
      if (edit) {
        await auditedUpdate(doc(db, "improvement_areas", edit.id), payload);
        toast.success("Updated.");
      } else {
        await auditedAdd(collection(db, "improvement_areas"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Improvement area added.");
      }
      onClose();
    } catch (e) {
      console.error("[ImprovementModal] save", e);
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,16,64,0.4)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: MA.CARD, borderRadius: 22, width: 440, maxWidth: "100%", padding: 22, boxShadow: "0 20px 60px rgba(0,8,40,0.3)", fontFamily: MA.FONT }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: MA.T1, letterSpacing: "-0.3px" }}>{edit ? "Edit" : "Add"} improvement area</div>
            <div style={{ fontSize: 11, color: MA.T3, marginTop: 2 }}>For {student.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, background: MA.SURFACE, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X className="w-4 h-4" style={{ color: MA.T3 }} />
          </button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>
            Title <span style={{ color: MA.RED }}>*</span>
          </div>
          <input
            ref={ref}
            type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Improve handwriting"
            maxLength={120}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12,
              border: "0.5px solid rgba(0,85,255,0.15)", background: MA.SURFACE,
              fontSize: 13, color: MA.T1, fontFamily: MA.FONT, outline: "none",
            }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Description</div>
          <textarea
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What does growth in this area look like?"
            rows={3} maxLength={500}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12,
              border: "0.5px solid rgba(0,85,255,0.15)", background: MA.SURFACE,
              fontSize: 13, color: MA.T1, fontFamily: MA.FONT, outline: "none",
              resize: "none", lineHeight: 1.5,
            }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MA.T3, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Priority</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["low", "medium", "high"] as const).map(p => {
              const active = priority === p;
              const c = p === "high" ? MA.RED : p === "medium" ? MA.ORANGE : MA.P;
              return (
                <button key={p} type="button" onClick={() => setPriority(p)}
                  style={{
                    flex: 1, padding: "9px 10px", borderRadius: 10,
                    background: active ? c : MA.SURFACE,
                    color: active ? "#fff" : MA.T3,
                    fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
                    border: "none", cursor: "pointer", fontFamily: MA.FONT,
                    textTransform: "capitalize",
                  }}>
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ flex: "0 0 100px", height: 44, borderRadius: 12, background: MA.SURFACE, color: MA.T1, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: MA.FONT }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !title.trim()}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              background: !title.trim() ? MA.SURFACE : MA.VIOLET,
              color: !title.trim() ? MA.T4 : "#fff",
              fontSize: 13, fontWeight: 700, letterSpacing: "-0.2px",
              border: "none", cursor: saving || !title.trim() ? "not-allowed" : "pointer",
              fontFamily: MA.FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              boxShadow: !title.trim() ? "none" : "0 6px 18px rgba(123,63,244,0.32)",
            }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : edit ? "Save changes" : "Add area"}
          </button>
        </div>
      </div>
    </div>
  );
}