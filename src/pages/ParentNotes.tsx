import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2, X, Send } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  serverTimestamp, doc,
} from "firebase/firestore";
import { auditedAdd, auditedUpdate } from "../lib/auditedWrites";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";

const HALO_SH = "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)";
const HALO_BDR = "0.5px solid rgba(0,85,255,0.07)";

// ── Quick Templates ───────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    title: "Grade Concern",
    desc:  "Inform parent about declining grades",
    body:  "Hello, I wanted to share that your child's recent grades have been declining. Could we schedule a short meeting to discuss ways we can support their progress together? Please let me know a convenient time.",
  },
  {
    title: "Good Performance",
    desc:  "Share positive progress update",
    body:  "Hello! I wanted to let you know that your child has been doing excellent work recently. Their effort and engagement in class are truly impressive. Thank you for your continued support at home.",
  },
  {
    title: "Attendance Issue",
    desc:  "Report frequent absences",
    body:  "Hello, I wanted to bring to your attention that your child has been absent frequently in recent weeks. Regular attendance is important for their learning. Please reach out if there are any concerns we can help address.",
  },
  {
    title: "Missing Assignments",
    desc:  "Notify about pending work",
    body:  "Hello, your child has a few pending assignments that are overdue. Could you please help ensure they are completed and submitted at the earliest? I am happy to provide extra support if needed.",
  },
  {
    title: "Meeting Request",
    desc:  "Schedule parent-teacher meeting",
    body:  "Hello, I would like to schedule a parent-teacher meeting to discuss your child's progress. Please share a few time slots that work for you and I will confirm at the earliest.",
  },
];

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:    "#08090C",
  bg:      "#F5F6F9",
  white:   "#ffffff",
  ink1:    "#08090C",
  ink2:    "#42475A",
  ink3:    "#8C92A4",
  s1:      "#F5F6F9",
  s2:      "#ECEEF4",
  bdr:     "#E2E5EE",
  blue:    "#3B5BDB",
  blBg:    "#EDF2FF",
  grn:     "#087F5B",
  grn2:    "#2F9E44",
  glBg:    "#EBFBEE",
  red:     "#C92A2A",
  rlBg:    "#FFF5F5",
  amb:     "#C87014",
  alBg:    "#FFF9DB",
  tea:     "#0C8599",
  tlBg:    "#E3FAFC",
  // Edullent Blue Apple chat tokens — replaces the prior WhatsApp beige/green
  // palette so the chat surface matches the rest of the teacher dashboard.
  chatBg:  "#EEF4FF",
  chatOut: "#DBE7FF",                                     // teacher (outgoing) bubble — soft blue tint
  chatOutInk: "#001040",
  chatIn:  "#FFFFFF",                                     // parent (incoming) bubble
  chatInInk: "#08090C",
  chatPattern: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%230055FF' fill-opacity='0.08'%3E%3Ccircle cx='10' cy='10' r='1.5'/%3E%3Ccircle cx='50' cy='30' r='1.5'/%3E%3Ccircle cx='30' cy='60' r='1.5'/%3E%3Ccircle cx='70' cy='70' r='1.5'/%3E%3C/g%3E%3C/svg%3E\")",
  chatHeaderGrad: "linear-gradient(135deg, #0055FF 0%, #1166FF 60%, #2277FF 100%)",
  chatInputBg: "#E0ECFF",
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AV = [
  { bg: "#FFF9DB", c: "#C87014" },
  { bg: "#E3FAFC", c: "#0C8599" },
  { bg: "#EDF2FF", c: "#3B5BDB" },
  { bg: "#F3F0FF", c: "#6741D9" },
  { bg: "#EBFBEE", c: "#087F5B" },
  { bg: "#FFF5F5", c: "#C92A2A" },
  { bg: "#FFF4E6", c: "#D9480F" },
];
const avStyle = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
};
const getInitials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
};

// ── Main component ────────────────────────────────────────────────────────────
const ParentNotes = () => {
  const { teacherData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  // Cross-page handoff: ConceptMasteryDetail's "Contact Parent" button
  // navigates here with location.state.autoOpenStudentId / Email. Auto-open
  // the corresponding chat once the roster has loaded. Match by studentId
  // first, fall back to studentEmail (dual-identifier policy — see
  // memory/dual_query_pattern_studentid_email.md). Strip state after one
  // pass so back-navigation doesn't re-fire it.
  // Roster declared below in the main effect; we read it via a separate
  // effect that watches both location.state and roster.
  // (placeholder — actual effect appears after roster is declared)
  const [allNotes, setAllNotes]               = useState<any[]>([]);
  const [roster, setRoster]                   = useState<any[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [listenerError, setListenerError]     = useState<string | null>(null);
  const [refreshKey, setRefreshKey]           = useState(0);
  const [searchQuery, setSearchQuery]         = useState("");
  const [messageContent, setMessageContent]   = useState("");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);

  // ── Compose modal state (New Message + Quick Templates) ────────────────
  const [showCompose, setShowCompose]             = useState(false);
  const [composeStudentKey, setComposeStudentKey] = useState<string>("");
  const [composeText, setComposeText]             = useState("");
  const [composeSearch, setComposeSearch]         = useState("");
  const [composeSending, setComposeSending]       = useState(false);

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    const tId = teacherData.id;
    setListenerError(null);

    // Resolve the teacher's classes via the canonical union (teaching_assignments
    // + classes.teacherId) then subscribe to enrollments by classId. The
    // previous `enrollments where teacherId == X` was a single-source read of a
    // denormalized field that's never written for many enrollments, and not
    // refreshed when a class teacher changes — a newly-onboarded teacher
    // inheriting an existing class saw an empty roster.
    // Memory: bug_pattern_teacher_class_pickers_single_source.
    let assignedIds = new Set<string>();
    let legacyOwnedIds = new Set<string>();
    let rosterSubs: Array<() => void> = [];
    let lastClassKey = "";
    const normKey = (s: string) => (s || "").trim().toLowerCase();

    const subscribeRoster = () => {
      const classIds = Array.from(new Set([...assignedIds, ...legacyOwnedIds]));
      const key = classIds.slice().sort().join("|");
      if (key === lastClassKey) return;
      lastClassKey = key;

      rosterSubs.forEach(u => { try { u(); } catch { /* noop */ } });
      rosterSubs = [];

      if (classIds.length === 0) { setRoster([]); return; }

      const chunks: string[][] = [];
      for (let i = 0; i < classIds.length; i += 10) chunks.push(classIds.slice(i, i + 10));

      const chunkBuckets: any[][] = chunks.map(() => []);
      chunks.forEach((chunk, idx) => {
        const unsub = onSnapshot(
          query(collection(db, "enrollments"), where("schoolId", "==", schoolId), where("classId", "in", chunk)),
          snap => {
            chunkBuckets[idx] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Dedup across chunks (memory: bug_pattern_enrollment_row_dedup).
            const map = new Map<string, any>();
            chunkBuckets.flat().forEach((d: any) => {
              const idPart = d.studentId
                ? `id:${normKey(String(d.studentId))}`
                : d.studentEmail
                  ? `em:${normKey(String(d.studentEmail))}`
                  : `enr:${normKey(String(d.id))}`;
              if (!map.has(idPart)) map.set(idPart, d);
            });
            setRoster(Array.from(map.values()));
          },
          err => {
            console.error("[ParentNotes] roster subscription failed:", err);
            setListenerError(err.message || "Live updates disrupted.");
          },
        );
        rosterSubs.push(unsub);
      });
    };

    // 1. teaching_assignments — canonical assignment record (active filter applied client-side)
    const uTa = onSnapshot(
      query(collection(db, "teaching_assignments"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      snap => {
        const active = snap.docs.filter(d => {
          const s = (d.data() as any).status;
          return !s || (typeof s === "string" && s.toLowerCase() === "active");
        });
        assignedIds = new Set(active.map(d => (d.data() as any).classId).filter(Boolean));
        subscribeRoster();
      },
      err => console.error("[ParentNotes] teaching_assignments error:", err),
    );

    // 2. classes.teacherId — legacy denormalized primary-teacher field
    const uCls = onSnapshot(
      query(collection(db, "classes"), where("schoolId", "==", schoolId), where("teacherId", "==", tId)),
      snap => { legacyOwnedIds = new Set(snap.docs.map(d => d.id)); subscribeRoster(); },
      err => console.error("[ParentNotes] classes error:", err),
    );

    const q2 = query(
      collection(db, "parent_notes"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", tId),
    );
    const unsub2 = onSnapshot(q2, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setAllNotes(data);
      setLoading(false);
    }, err => {
      console.error("[ParentNotes] notes subscription failed:", err);
      setListenerError(err.message || "Live updates disrupted.");
      setLoading(false);
    });

    return () => {
      uTa();
      uCls();
      rosterSubs.forEach(u => { try { u(); } catch { /* noop */ } });
      rosterSubs = [];
      unsub2();
    };
  }, [teacherData?.id, teacherData?.schoolId, refreshKey]);

  // Auto-open recipient when navigated here from ConceptMasteryDetail or
  // RisksAlerts "Contact Parent" buttons. Runs once roster has populated;
  // matches by studentId then falls back to studentEmail. If `autoMessage`
  // is also passed, prefill the chat composer so the teacher can review
  // and edit before sending.
  useEffect(() => {
    const st = (location.state ?? {}) as {
      autoOpenStudentId?: string;
      autoOpenStudentEmail?: string;
      autoMessage?: string;
    };
    const wantedId = st.autoOpenStudentId?.toLowerCase();
    const wantedEmail = st.autoOpenStudentEmail?.toLowerCase();
    if (!wantedId && !wantedEmail) return;
    if (roster.length === 0 || selectedStudent) return;
    const match = roster.find((r: any) => {
      const rid = (r.studentId || "").toLowerCase();
      const remail = (r.studentEmail || "").toLowerCase();
      return (wantedId && rid === wantedId) || (wantedEmail && remail === wantedEmail);
    });
    if (match) {
      setSelectedStudent(match);
      if (st.autoMessage) setMessageContent(st.autoMessage);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, roster, selectedStudent]);

  // Scroll to bottom on new messages
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allNotes, selectedStudent]);

  // Mark unread parent messages as read
  useEffect(() => {
    if (!selectedStudent) return;
    const sId    = selectedStudent.studentId?.toLowerCase();
    const sEmail = selectedStudent.studentEmail?.toLowerCase();
    allNotes.forEach(n => {
      const match = (sId && n.studentId?.toLowerCase() === sId) || (sEmail && n.studentEmail?.toLowerCase() === sEmail);
      if (match && n.from === "parent" && n.read !== true) {
        auditedUpdate(doc(db, "parent_notes", n.id), { read: true }).catch(() => {});
      }
    });
  }, [selectedStudent?.id]);

  // ── Computed values ─────────────────────────────────────────────────────
  const lastMessages = useMemo(() => {
    const map = new Map();
    [...allNotes].reverse().forEach(n => {
      const key = (n.studentId || n.studentEmail)?.toLowerCase();
      if (key && !map.has(key)) map.set(key, n);
    });
    return map;
  }, [allNotes]);

  const unreadCounts = useMemo(() => {
    const map = new Map<string, number>();
    allNotes.forEach(n => {
      if (n.from === "parent" && n.read !== true) {
        const key = (n.studentId || n.studentEmail)?.toLowerCase();
        if (key) map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [allNotes]);

  const filteredRoster = useMemo(() => {
    return roster
      .filter(s => s.studentName?.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const keyA = (a.studentId || a.studentEmail)?.toLowerCase();
        const keyB = (b.studentId || b.studentEmail)?.toLowerCase();
        return (lastMessages.get(keyB)?.createdAt?.toMillis?.() || 0) - (lastMessages.get(keyA)?.createdAt?.toMillis?.() || 0);
      });
  }, [roster, searchQuery, lastMessages]);

  const studentMessages = useMemo(() => {
    if (!selectedStudent) return [];
    const sId    = selectedStudent.studentId?.toLowerCase();
    const sEmail = selectedStudent.studentEmail?.toLowerCase();
    return allNotes.filter(n =>
      (sId    && n.studentId?.toLowerCase()    === sId) ||
      (sEmail && n.studentEmail?.toLowerCase() === sEmail)
    );
  }, [allNotes, selectedStudent]);

  const stats = useMemo(() => ({
    total:         allNotes.length,
    parentReplies: allNotes.filter(n => n.from === "parent").length,
    students:      new Set(allNotes.map(n => n.studentId || n.studentEmail)).size,
  }), [allNotes]);

  const noReplyCount = useMemo(() => {
    return roster.filter(s => {
      const key = (s.studentId || s.studentEmail)?.toLowerCase();
      return !lastMessages.has(key);
    }).length;
  }, [roster, lastMessages]);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    studentMessages.forEach(msg => {
      const label = fmtDate(msg.createdAt);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [studentMessages]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!selectedStudent || !messageContent.trim()) return;
    const content = messageContent.trim();
    setMessageContent("");
    try {
      await auditedAdd(collection(db, "parent_notes"), {
        schoolId:     teacherData?.schoolId || "",
        branchId:     teacherData?.branchId || "",
        teacherId:    teacherData?.id   || "",
        teacherName:  teacherData?.name || "Teacher",
        studentId:    selectedStudent.studentId    || "",
        studentEmail: selectedStudent.studentEmail?.toLowerCase() || "",
        studentName:  selectedStudent.studentName  || "",
        parentName:   `Parent of ${selectedStudent.studentName}`,
        content, from: "teacher", status: "Sent",
        read: false,  // parent-side unread counter
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("[ParentNotes] send failed", e);
      toast.error("Failed to send.");
      setMessageContent(content);
    }
  };

  // ── Compose modal handlers ──────────────────────────────────────────────
  const openCompose = (templateBody?: string) => {
    setComposeText(templateBody || "");
    setComposeSearch("");
    // Default to selected student if open, else first in roster
    const defaultKey = selectedStudent
      ? (selectedStudent.studentId || selectedStudent.studentEmail)
      : (roster[0]?.studentId || roster[0]?.studentEmail || "");
    setComposeStudentKey(defaultKey || "");
    setShowCompose(true);
  };

  const closeCompose = () => {
    setShowCompose(false);
    setComposeText("");
    setComposeStudentKey("");
    setComposeSearch("");
  };

  const applyTemplate = (body: string) => {
    if (!showCompose) {
      openCompose(body);
      return;
    }
    setComposeText((prev) => (prev.trim() ? prev + "\n\n" + body : body));
  };

  const handleSendCompose = async () => {
    const content = composeText.trim();
    if (!content) { toast.error("Write a message first."); return; }
    const recipient = roster.find(
      (s) => (s.studentId || s.studentEmail) === composeStudentKey
    );
    if (!recipient) { toast.error("Select a parent to send to."); return; }

    setComposeSending(true);
    try {
      await auditedAdd(collection(db, "parent_notes"), {
        schoolId:     teacherData?.schoolId || "",
        branchId:     teacherData?.branchId || "",
        teacherId:    teacherData?.id   || "",
        teacherName:  teacherData?.name || "Teacher",
        studentId:    recipient.studentId    || "",
        studentEmail: recipient.studentEmail?.toLowerCase() || "",
        studentName:  recipient.studentName  || "",
        parentName:   `Parent of ${recipient.studentName}`,
        content, from: "teacher", status: "Sent",
        read: false,  // parent-side unread counter
        createdAt: serverTimestamp(),
      });
      toast.success(`Message sent to parent of ${recipient.studentName}`);
      setSelectedStudent(recipient);
      closeCompose();
    } catch (e) {
      console.error("[ParentNotes] compose send failed", e);
      toast.error("Failed to send. Try again.");
    } finally {
      setComposeSending(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const lastParentMsg = useMemo(() => {
    return studentMessages.filter(m => m.from === "parent").reverse()[0];
  }, [studentMessages]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {listenerError && (
        <div
          role="alert"
          style={{
            position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
            zIndex: 60, maxWidth: 480, width: "92%",
            background: "linear-gradient(135deg, #FFF1F1 0%, #FFE3E3 100%)",
            border: "0.5px solid rgba(255,51,85,.25)",
            borderRadius: 14, padding: "10px 14px",
            display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 6px 18px rgba(255,51,85,.12)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF3355" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#001040" }}>Live updates disrupted</div>
            <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, marginTop: 2 }}>{listenerError}</div>
          </div>
          <button
            type="button"
            onClick={() => { setListenerError(null); setLoading(true); setRefreshKey(k => k + 1); }}
            style={{
              padding: "6px 12px", borderRadius: 10,
              background: "#FF3355", color: "#fff",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
              border: "none", cursor: "pointer", flexShrink: 0,
              boxShadow: "0 4px 10px rgba(255,51,85,.28)",
            }}
          >
            Retry
          </button>
        </div>
      )}
      {/* Call as functions, not as <Component /> — these are defined inside
          the parent's body, so React would treat each render's new function
          reference as a NEW component type and unmount + remount the whole
          subtree on every keystroke. Result: input loses focus after 1-2
          letters and send button can't bind. Memory:
          bug_pattern_inline_component_remount_flicker. */}
      {selectedStudent ? ChatView() : ListView()}
      {showCompose && (
        <>
          {/* Desktop modal (unchanged) */}
          <div className="hidden md:block"><ComposeModal /></div>
          {/* Mobile bottom sheet */}
          <div className="md:hidden">
            <MobileComposeSheet
              roster={roster}
              composeSearch={composeSearch}
              setComposeSearch={setComposeSearch}
              composeStudentKey={composeStudentKey}
              setComposeStudentKey={setComposeStudentKey}
              composeText={composeText}
              setComposeText={setComposeText}
              composeSending={composeSending}
              closeCompose={closeCompose}
              onSend={handleSendCompose}
            />
          </div>
        </>
      )}
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSE MODAL — New Message + Quick Templates
  // ═══════════════════════════════════════════════════════════════════════════
  function ComposeModal() {
    const recipients = useMemo(() => {
      const q = composeSearch.trim().toLowerCase();
      const base = q
        ? roster.filter(s =>
            (s.studentName || "").toLowerCase().includes(q) ||
            (s.parentName || "").toLowerCase().includes(q) ||
            (s.className || s.assignedClass || "").toLowerCase().includes(q),
          )
        : roster;
      return base;
    }, [roster, composeSearch]);

    const selected = roster.find(
      s => (s.studentId || s.studentEmail) === composeStudentKey,
    );

    return (
      <div
        onClick={closeCompose}
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(8, 9, 12, 0.56)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white"
          style={{
            width: "100%", maxWidth: 720, maxHeight: "90vh",
            borderRadius: 18, overflow: "hidden",
            display: "flex", flexDirection: "column",
            boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "14px 18px", borderBottom: `1px solid ${T.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: T.white,
          }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: T.ink1, margin: 0 }}>
                New message to parent
              </h2>
              <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>
                Pick a parent, tap a template or type your own.
              </p>
            </div>
            <button
              type="button" aria-label="Close"
              onClick={closeCompose}
              style={{
                width: 32, height: 32, borderRadius: 10,
                border: `1px solid ${T.bdr}`, background: T.s1,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={14} color={T.ink3} strokeWidth={2} />
            </button>
          </div>

          {/* Body */}
          <div style={{ display: "flex", flex: 1, minHeight: 0 }} className="flex-col md:flex-row">
            {/* Left — recipient picker */}
            <div style={{
              width: "100%", maxWidth: 280, borderRight: `1px solid ${T.bdr}`,
              display: "flex", flexDirection: "column", minHeight: 0,
            }} className="md:max-w-[280px]">
              <div style={{ padding: 12, borderBottom: `1px solid ${T.bdr}` }}>
                <input
                  value={composeSearch}
                  onChange={(e) => setComposeSearch(e.target.value)}
                  placeholder="Search parent or class…"
                  style={{
                    width: "100%", padding: "8px 12px",
                    borderRadius: 10, border: `1px solid ${T.bdr}`,
                    background: T.s1, fontSize: 12, color: T.ink1,
                    fontFamily: "inherit", outline: "none",
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: "auto", maxHeight: 280 }}>
                {recipients.length === 0 ? (
                  <p style={{ fontSize: 11, color: T.ink3, padding: "24px 12px", textAlign: "center" }}>
                    No parents match your search.
                  </p>
                ) : (
                  recipients.map((s) => {
                    const key = s.studentId || s.studentEmail;
                    const av  = avStyle(s.studentName || "S");
                    const isActive = key === composeStudentKey;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setComposeStudentKey(key)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          width: "100%", padding: "10px 12px",
                          background: isActive ? T.blBg : "transparent",
                          border: "none", borderBottom: `1px solid ${T.s2}`,
                          cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: 10,
                          background: av.bg, color: av.c,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 600, flexShrink: 0,
                        }}>
                          {getInitials(s.studentName || "S")}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.studentName}
                          </p>
                          <p style={{ fontSize: 10, color: T.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.className || s.assignedClass || "No class"}
                          </p>
                        </div>
                        {isActive && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2,6 5,9 10,3" />
                          </svg>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right — templates + text area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Templates */}
              <div style={{ padding: 12, borderBottom: `1px solid ${T.bdr}`, background: T.s1 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: T.ink3, marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Quick Templates
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.title}
                      type="button"
                      onClick={() => applyTemplate(tpl.body)}
                      style={{
                        padding: "6px 11px", borderRadius: 20,
                        border: `1px solid ${T.bdr}`,
                        background: T.white, color: T.ink1,
                        fontSize: 11, fontWeight: 500, cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {tpl.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text area */}
              <div style={{ flex: 1, padding: 12, minHeight: 0, display: "flex" }}>
                <textarea
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  placeholder={selected
                    ? `Write a message to ${selected.parentName || `parent of ${selected.studentName}`}…`
                    : "Select a parent from the left, or pick a template above."}
                  style={{
                    width: "100%", minHeight: 180, resize: "none",
                    padding: 12, borderRadius: 12,
                    border: `1px solid ${T.bdr}`, background: T.white,
                    fontSize: 13, color: T.ink1, lineHeight: 1.55,
                    fontFamily: "inherit", outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 18px", borderTop: `1px solid ${T.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: T.white, gap: 10,
          }}>
            <p style={{ fontSize: 11, color: T.ink3 }}>
              {selected
                ? <>Sending to <strong style={{ color: T.ink1, fontWeight: 600 }}>{selected.studentName}</strong>'s parent</>
                : "No recipient selected"}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={closeCompose}
                style={{
                  padding: "8px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2,
                  fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendCompose}
                disabled={composeSending || !composeText.trim() || !composeStudentKey}
                style={{
                  padding: "8px 16px", borderRadius: 10,
                  border: "none",
                  background: (composeSending || !composeText.trim() || !composeStudentKey) ? T.s2 : T.blue,
                  color: (composeSending || !composeText.trim() || !composeStudentKey) ? T.ink3 : "#fff",
                  fontSize: 12, fontWeight: 600,
                  cursor: (composeSending || !composeText.trim() || !composeStudentKey) ? "default" : "pointer",
                  fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {composeSending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} strokeWidth={2.2} />
                )}
                {composeSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  function ListView() {
    return (
      <div style={{ minHeight: "100vh", paddingBottom: 0 }}>

        {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
        <MobileParentNotesList
          stats={stats}
          noReplyCount={noReplyCount}
          loading={loading}
          roster={roster}
          filteredRoster={filteredRoster}
          lastMessages={lastMessages}
          unreadCounts={unreadCounts}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onOpenChat={setSelectedStudent}
          onOpenCompose={openCompose}
          fmtTime={fmtTime}
        />
        {/* ═══════════════════ END MOBILE VIEW ═══════════════════ */}

        {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
        <div
          className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-8 pt-6 pb-10"
          style={{
            background: '#EEF4FF',
            minHeight: '100vh',
            fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <style>{`
            @keyframes pnFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
            .pn-enter > * { animation: pnFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
            .pn-enter > *:nth-child(1) { animation-delay: .04s; }
            .pn-enter > *:nth-child(2) { animation-delay: .10s; }
            .pn-enter > *:nth-child(3) { animation-delay: .16s; }
            .pn-enter > *:nth-child(4) { animation-delay: .22s; }
            .pn-enter > *:nth-child(5) { animation-delay: .28s; }
            .pn-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
            @media (hover:hover) { .pn-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
            .pn-card3d:active { transform: translateY(-1px) scale(.99); }
            .pn-tile { transition: all 0.3s ease; cursor: pointer; will-change: transform, box-shadow; }
            @media (hover:hover) { .pn-tile:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 .5px rgba(255,255,255,.2), 0 18px 44px rgba(0,85,255,.32), 0 6px 16px rgba(0,85,255,.22); } }
            .pn-tile:active { transform: translateY(-1px) scale(.99); }
            .pn-tpl-btn { transition: all 0.3s ease; }
            @media (hover:hover) { .pn-tpl-btn:hover { transform: translateY(-2px); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 8px 22px rgba(0,85,255,.12); background: #fff; border-color: rgba(0,85,255,.22); } }
            .pn-row { transition: all 0.3s ease; cursor: pointer; }
            .pn-row:hover { transform: translateX(4px); }
            .pn-btn-press { transition: all 0.3s ease; }
            .pn-btn-press:hover { transform: translateY(-1px); filter: brightness(1.06); }
            .pn-btn-press:active { transform: scale(.96); }
            @keyframes pnPulse { 0%,100% { opacity:1; transform: scale(1); } 50% { opacity:.5; transform: scale(1.3); } }
            .pn-pulse { animation: pnPulse 1.8s ease-in-out infinite; }
          `}</style>

          <div className="pn-enter max-w-[1600px] mx-auto">

            {/* ═══ Page Head ═══ */}
            <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className={noReplyCount > 0 ? 'pn-pulse' : ''}
                    style={{
                      width: 6, height: 6, borderRadius: 2,
                      background: noReplyCount > 0 ? '#FFAA00' : '#0055FF',
                      display: 'inline-block',
                      boxShadow: noReplyCount > 0 ? '0 0 10px rgba(255,170,0,.5)' : 'none',
                    }}
                  />
                  Teacher Dashboard · Communication
                </div>
                <h1 style={{ fontSize: 34, fontWeight: 700, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
                  Parent <span style={{ color: '#0055FF' }}>Notes</span>
                </h1>
                <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
                  Communicate with parents · track conversations · keep everyone aligned.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {noReplyCount > 0 && (
                  <div
                    className="pn-btn-press"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '10px 16px', borderRadius: 14,
                      background: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)', color: '#fff',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      boxShadow: '0 6px 20px rgba(255,170,0,.36), 0 2px 5px rgba(255,170,0,.2)',
                    }}
                  >
                    <span className="pn-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }}/>
                    {noReplyCount} Pending
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Compose new message"
                  onClick={() => openCompose()}
                  className="pn-btn-press"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    height: 44, padding: '0 20px', borderRadius: 14,
                    background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', color: '#fff',
                    fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: '0 5px 18px rgba(0,85,255,0.34), 0 2px 5px rgba(0,85,255,0.18)',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
                  </svg>
                  New Message
                </button>
              </div>
            </div>

            {/* ═══ Dark Hero Banner ═══ */}
            {(() => {
              const responsePct = stats.total > 0 ? Math.round((stats.parentReplies / stats.total) * 100) : 0;
              const statusLabel = noReplyCount > 0 ? 'AWAITING REPLIES' : stats.total > 0 ? 'ACTIVE CHAT' : 'READY TO ENGAGE';
              const statusColor = noReplyCount > 0 ? '#FFD088' : '#6FFFAA';
              return (
                <div
                  style={{
                    background: 'linear-gradient(135deg,#000A33 0%,#001A66 32%,#0044CC 68%,#0055FF 100%)',
                    borderRadius: 24, padding: '28px 32px', color: '#fff',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
                    marginBottom: 22,
                  }}
                >
                  <div style={{ position: 'absolute', top: -60, right: -40, width: 320, height: 320, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                  <div style={{ position: 'absolute', bottom: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(123,63,244,.22) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1, minWidth: 320 }}>
                      <div style={{
                        width: 64, height: 64, borderRadius: 16,
                        background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                      }}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                      </div>
                      <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, color: statusColor }}>
                          {statusLabel}
                        </div>
                        <h2 style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-1px', margin: 0, color: '#fff', lineHeight: 1 }}>
                          {stats.total}
                        </h2>
                        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.78)', fontWeight: 500, margin: '8px 0 0 0', lineHeight: 1.55 }}>
                          {stats.total === 0 ? (
                            <>Start your first message — parents want to hear from you about their child's progress.</>
                          ) : noReplyCount > 0 ? (
                            <><b style={{ color: '#fff', fontWeight: 700 }}>{noReplyCount} parent{noReplyCount === 1 ? '' : 's'}</b> haven't replied yet · <b style={{ color: '#fff', fontWeight: 700 }}>{responsePct}%</b> response rate overall across {stats.students} parent{stats.students === 1 ? '' : 's'}.</>
                          ) : (
                            <>Great engagement — <b style={{ color: '#fff', fontWeight: 700 }}>{responsePct}%</b> response rate across {stats.students} parent{stats.students === 1 ? '' : 's'}. Keep the conversation going.</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px,1fr))', gap: 10 }}>
                      {[
                        { label: 'Pending',   value: noReplyCount.toString(), color: '#FFD088' },
                        { label: 'Replies',   value: stats.parentReplies.toString(), color: '#6FFFAA' },
                        { label: 'Response',  value: `${responsePct}%`, color: '#C8A4FF' },
                      ].map(s => (
                        <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '12px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0, letterSpacing: '-0.5px' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ═══ Matte 4-col KPI tiles ═══ */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Total Messages', value: stats.total.toString(), sub: 'Across all parents',
                  color: '#0055FF',
                  tintBg: 'linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)',
                  tintBorder: 'rgba(0,85,255,0.10)',
                  onClick: () => searchRef.current?.focus(),
                  iconStroke: (<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>),
                },
                { label: 'Pending Replies', value: noReplyCount.toString(), sub: noReplyCount > 0 ? 'Follow up soon' : 'All caught up',
                  color: noReplyCount > 0 ? '#FFAA00' : '#00C853',
                  tintBg: noReplyCount > 0
                    ? 'linear-gradient(135deg, #FFF6E0 0%, #FFEDC4 100%)'
                    : 'linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)',
                  tintBorder: noReplyCount > 0 ? 'rgba(255,170,0,0.16)' : 'rgba(0,200,83,0.16)',
                  onClick: () => searchRef.current?.focus(),
                  iconStroke: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
                },
                { label: 'Parent Replies', value: stats.parentReplies.toString(), sub: stats.parentReplies > 0 ? 'Active dialogue' : 'Awaiting first reply',
                  color: '#00C853',
                  tintBg: 'linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)',
                  tintBorder: 'rgba(0,200,83,0.16)',
                  onClick: () => searchRef.current?.focus(),
                  iconStroke: (<><polyline points="20 6 9 17 4 12"/></>),
                },
                { label: 'Parents', value: stats.students.toString(), sub: `${stats.students === 1 ? 'family' : 'families'} in loop`,
                  color: '#7B3FF4',
                  tintBg: 'linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)',
                  tintBorder: 'rgba(123,63,244,0.12)',
                  onClick: () => navigate('/students'),
                  iconStroke: (<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
                },
              ].map(k => (
                <div
                  key={k.label}
                  onClick={k.onClick}
                  role="button"
                  tabIndex={0}
                  {...tilt3D}
                  style={{
                    background: k.tintBg, borderRadius: 22, padding: '22px 24px',
                    position: 'relative', overflow: 'hidden',
                    border: `0.5px solid ${k.tintBorder}`,
                    boxShadow: '0 8px 24px rgba(20,40,90,0.06), 0 2px 6px rgba(20,40,90,0.04)',
                    cursor: 'pointer',
                    ...tilt3DStyle,
                  }}
                >
                  <div style={{ position: 'absolute', right: 14, bottom: 12, color: k.color, opacity: 0.22, pointerEvents: 'none' }}>
                    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {k.iconStroke}
                    </svg>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: `${k.color}1F`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      {k.iconStroke}
                    </svg>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: k.color, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
                  <div style={{ fontSize: 34, fontWeight: 700, color: '#001040', letterSpacing: '-1.4px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#5070B0', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* ═══ 2-col: Templates | Conversations ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Quick Templates */}
              <div
                {...tilt3D}
                className="bg-white overflow-hidden"
                style={{
                  borderRadius: 22,
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
                  border: '0.5px solid rgba(0,85,255,0.07)',
                  ...tilt3DStyle,
                }}
              >
                <div style={{ padding: '16px 20px', borderBottom: '0.5px solid rgba(0,85,255,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(123,63,244,.28)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                  </div>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>Quick Templates</h2>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>Tap to apply</p>
                  </div>
                </div>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {TEMPLATES.map((tpl, idx) => {
                    const tones = [
                      { bg: 'rgba(255,51,85,.10)',   border: 'rgba(255,51,85,.18)',   ico: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)' },
                      { bg: 'rgba(0,200,83,.10)',    border: 'rgba(0,200,83,.20)',    ico: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)' },
                      { bg: 'rgba(255,170,0,.10)',   border: 'rgba(255,170,0,.22)',   ico: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)' },
                      { bg: 'rgba(0,85,255,.08)',    border: 'rgba(0,85,255,.14)',    ico: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)' },
                      { bg: 'rgba(123,63,244,.10)',  border: 'rgba(123,63,244,.22)',  ico: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)' },
                    ][idx % 5];
                    return (
                      <button
                        key={tpl.title}
                        type="button"
                        onClick={() => applyTemplate(tpl.body)}
                        className="pn-tpl-btn"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          width: '100%', textAlign: 'left',
                          padding: '12px 14px', borderRadius: 14,
                          background: tones.bg,
                          border: `0.5px solid ${tones.border}`,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <div style={{
                          width: 34, height: 34, borderRadius: 11, background: tones.ico,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          boxShadow: '0 4px 10px rgba(0,85,255,.18)',
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#001040', letterSpacing: '-0.2px', margin: 0 }}>{tpl.title}</p>
                          <p style={{ fontSize: 11, fontWeight: 500, color: '#5070B0', margin: '3px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conversations list */}
              <div
                className="lg:col-span-2 bg-white overflow-hidden"
                style={{
                  borderRadius: 22,
                  boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
                  border: '0.5px solid rgba(0,85,255,0.07)',
                }}
              >
                <div style={{ padding: '16px 22px', borderBottom: '0.5px solid rgba(0,85,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(0,85,255,.28)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    </div>
                    <div>
                      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>All Conversations</h2>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{filteredRoster.length} {filteredRoster.length === 1 ? 'parent' : 'parents'} · click to chat</p>
                    </div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="#99AACC" strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="12.5" y2="12.5"/>
                    </svg>
                    <input
                      ref={searchRef}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search parent or student..."
                      style={{
                        width: 240, height: 40, paddingLeft: 36, paddingRight: 14,
                        background: '#F5F9FF',
                        border: '0.5px solid rgba(0,85,255,.10)',
                        borderRadius: 12,
                        fontSize: 13, fontWeight: 500, color: '#001040',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  </div>
                </div>

                {loading ? (
                  <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
                    <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#0055FF' }}/>
                  </div>
                ) : filteredRoster.length === 0 ? (
                  <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 60, height: 60, borderRadius: 18, background: '#F5F9FF', border: '0.5px solid rgba(0,85,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#5070B0', margin: 0 }}>No parents match your search</p>
                    <p style={{ fontSize: 11, fontWeight: 500, color: '#99AACC', margin: 0 }}>Try a different name or class.</p>
                  </div>
                ) : (
                  <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                    {filteredRoster.map(s => {
                      const key = (s.studentId || s.studentEmail)?.toLowerCase();
                      const last = lastMessages.get(key);
                      const unread = unreadCounts.get(key) || 0;
                      const av = avStyle(s.studentName || 'S');
                      const clsName = s.className || s.assignedClass || '';
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelectedStudent(s)}
                          className="pn-row"
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 14,
                            padding: '14px 22px',
                            borderBottom: '0.5px solid rgba(0,85,255,.05)',
                            cursor: 'pointer',
                            background: unread > 0 ? 'rgba(0,85,255,.04)' : 'transparent',
                          }}
                        >
                          <div
                            style={{
                              width: 44, height: 44, borderRadius: '50%',
                              background: av.color, color: '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 13, fontWeight: 700, flexShrink: 0,
                              boxShadow: `0 4px 12px ${av.color}55`,
                            }}
                          >
                            {getInitials(s.studentName || 'S')}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
                              <p style={{ fontSize: 14, fontWeight: 700, color: '#001040', letterSpacing: '-0.2px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.studentName}'s Parents
                              </p>
                              {unread > 0 && (
                                <span style={{
                                  flexShrink: 0,
                                  fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                                  background: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)', color: '#fff',
                                  letterSpacing: '0.1em', textTransform: 'uppercase',
                                  boxShadow: '0 3px 8px rgba(255,170,0,.32)',
                                }}>
                                  Pending Reply
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                              {clsName && (
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                                  background: 'rgba(0,85,255,.08)', color: '#0055FF',
                                  letterSpacing: '0.04em',
                                }}>
                                  {clsName}
                                </span>
                              )}
                              {last?.createdAt && (
                                <span style={{ fontSize: 11, fontWeight: 600, color: '#99AACC' }}>
                                  {new Date(last.createdAt.toMillis?.() || last.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                            {last ? (
                              <p style={{ fontSize: 12, fontWeight: 500, color: '#42475A', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {last.content}
                              </p>
                            ) : (
                              <p style={{ fontSize: 11, fontWeight: 600, color: '#99AACC', margin: 0, fontStyle: 'italic' }}>
                                No messages yet — start the conversation.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ═══ AI Intelligence card ═══ */}
            {stats.total > 0 && (() => {
              const responsePct = Math.round((stats.parentReplies / Math.max(stats.total, 1)) * 100);
              const leadLine = noReplyCount > 0
                ? `${noReplyCount} parent${noReplyCount !== 1 ? 's' : ''} ${noReplyCount === 1 ? 'has' : 'have'} no messages yet — consider sending a quick intro or status update to open the channel.`
                : `Engagement is healthy — ${responsePct}% response rate across ${stats.students} parent${stats.students !== 1 ? 's' : ''}. Keep replying promptly to maintain momentum.`;
              return (
                <div
                  style={{
                    background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                    borderRadius: 22, padding: '24px 28px', color: '#fff',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
                    marginTop: 22,
                  }}
                >
                  <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                  <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: `radial-gradient(circle, ${noReplyCount > 0 ? 'rgba(255,170,0,.22)' : 'rgba(255,255,255,.12)'} 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }}/>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
                    <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                        AI Communication Intelligence
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
                        Engagement Summary
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
                        {leadLine}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
                    {[
                      { label: 'Response Rate', value: `${responsePct}%`, sub: responsePct >= 70 ? 'Healthy dialogue' : responsePct >= 40 ? 'Developing' : 'Needs nudging', color: responsePct >= 70 ? '#6FFFAA' : responsePct >= 40 ? '#FFD088' : '#FF99AA' },
                      { label: 'Pending Follow-ups', value: noReplyCount.toString(), sub: noReplyCount > 0 ? 'Ping a reminder' : 'All engaged', color: noReplyCount > 0 ? '#FFD088' : '#6FFFAA' },
                      { label: 'Reach', value: `${stats.students}`, sub: `parent${stats.students !== 1 ? 's' : ''} in loop`, color: '#C8A4FF' },
                    ].map(s => (
                      <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{s.value}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0' }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        </div>{/* ═══════════ END DESKTOP VIEW ═══════════ */}

      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  function ChatView() {
    const av        = avStyle(selectedStudent.studentName || "S");
    const clsName   = selectedStudent.className || selectedStudent.assignedClass || "";
    const lastSeen  = lastParentMsg ? fmtTime(lastParentMsg.createdAt) : null;

    return (
      <div
        style={{
          display: "flex", flexDirection: "column",
          height: "min(720px, calc(100vh - 120px))",
          maxWidth: 1100,
          width: "100%",
          margin: "0 auto",
          background: T.chatBg,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,40,120,.06), 0 12px 32px rgba(0,40,120,.10)",
          border: "0.5px solid rgba(0,85,255,.10)",
        }}
      >
        {/* ── Edullent blue chat header ─────────────────────────────────────── */}
        <div style={{ padding: "12px 22px 18px", flexShrink: 0, background: T.chatHeaderGrad, boxShadow: "0 4px 16px rgba(0,85,255,0.18)" }}>
          {/* Back link */}
          <button
            type="button"
            aria-label="Back to students"
            onClick={() => setSelectedStudent(null)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "none", border: "none", cursor: "pointer",
              marginBottom: 10, padding: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8,2 3,6.5 8,11" />
            </svg>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>All messages</span>
          </button>

          {/* Student row */}
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13,
              background: "rgba(255,255,255,0.22)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 600, flexShrink: 0,
              border: "1.5px solid rgba(255,255,255,0.32)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
            }}>
              {getInitials(selectedStudent.studentName || "S")}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#fff", letterSpacing: "-0.2px", margin: 0 }}>
                {selectedStudent.studentName}
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>
                {clsName ? `${clsName} · ` : ""}Parent of {selectedStudent.studentName}
              </p>
            </div>

          </div>

          {/* Online status */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: lastSeen ? "#4CC9A4" : "rgba(255,255,255,0.45)" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.78)" }}>
              {lastSeen ? `Parent active · Last seen ${lastSeen}` : "No parent messages yet"}
            </span>
          </div>
        </div>

        {/* ── Messages — WhatsApp beige bg ─────────────────────────────────── */}
        <div style={{
          flex: 1, padding: "14px 12px", overflowY: "auto",
          background: T.chatBg,
          backgroundImage: T.chatPattern,
        }}>
          {groupedMessages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(142,148,164,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5,9.5 L12.5,9.5 L10.5,6.5 L12.5,3.5 L1.5,3.5 L3.5,6.5 Z" />
                </svg>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>No messages yet</p>
              <p style={{ fontSize: 11, color: T.ink3, textAlign: "center" }}>Start the conversation with the parent</p>
            </div>
          ) : (
            groupedMessages.map(group => (
              <div key={group.date}>
                {/* Date chip — Edullent pill */}
                <div style={{ textAlign: "center", margin: "10px 0 12px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: "#0044CC",
                    background: "rgba(255,255,255,0.92)",
                    padding: "5px 14px", borderRadius: 999,
                    boxShadow: "0 1px 4px rgba(0,85,255,0.10), 0 0 0 0.5px rgba(0,85,255,0.12)",
                    letterSpacing: "0.04em",
                  }}>
                    {group.date}
                  </span>
                </div>

                {group.messages.map(n => {
                  const isTeacher = n.from === "teacher";
                  return (
                    <div
                      key={n.id}
                      style={{
                        display: "flex",
                        marginBottom: 6,
                        justifyContent: isTeacher ? "flex-end" : "flex-start",
                      }}
                    >
                      {/* Soft chat bubble — light blue tint outgoing, white incoming */}
                      <div style={{
                        padding: "7px 12px 9px",
                        background: isTeacher ? T.chatOut : T.chatIn,
                        borderRadius: 14,
                        borderTopLeftRadius: isTeacher ? 14 : 4,
                        borderTopRightRadius: isTeacher ? 4 : 14,
                        boxShadow: isTeacher
                          ? "0 1px 2px rgba(0,85,255,0.08), 0 0 0 0.5px rgba(0,85,255,0.10)"
                          : "0 1px 2px rgba(11,20,26,0.06), 0 0 0 0.5px rgba(0,85,255,0.06)",
                        maxWidth: "min(560px, 70%)",
                        position: "relative",
                        minWidth: isTeacher ? 120 : 104,
                      }}>
                        <p style={{
                          fontSize: 14, lineHeight: 1.45,
                          color: isTeacher ? T.chatOutInk : T.chatInInk,
                          fontWeight: 400,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          paddingRight: isTeacher ? 60 : 44,
                        }}>
                          {n.content}
                        </p>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 3,
                          position: "absolute", right: 10, bottom: 5,
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 500, color: isTeacher ? "#3060B0" : "#5070B0" }}>
                            {fmtTime(n.createdAt)}
                          </span>
                          {isTeacher && (
                            <svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="#3060B0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1,6 4,9 8,3" /><polyline points="6,6 9,9 15,2" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Chat input — Edullent blue style ─────────────────────────────── */}
        <div style={{
          background: T.chatInputBg,
          padding: "10px 14px", display: "flex", alignItems: "center", gap: 8,
          flexShrink: 0, marginBottom: 0,
          borderTop: "0.5px solid rgba(0,85,255,0.12)",
        }}
        >
          {/* Text input — explicit height + padding to bypass global !important
              rules; line-height set so caret sits cleanly. Previously the
              input's typing was visually jittery on some browsers because the
              global `* { font-family !important }` rule + minimal inline
              padding combined to make the text-area feel unresponsive. */}
          <input
            value={messageContent}
            onChange={e => setMessageContent(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message"
            autoComplete="off"
            spellCheck
            style={{
              flex: 1, minWidth: 0,
              height: 44,
              padding: "0 18px",
              lineHeight: "44px",
              borderRadius: 22,
              border: "0.5px solid rgba(0,85,255,0.18)",
              background: "#FFFFFF",
              boxShadow: "0 1px 2px rgba(0,85,255,0.06), inset 0 0 0 0.5px rgba(0,85,255,0.04)",
              fontSize: 14, color: "#001040",
              fontFamily: "inherit", outline: "none",
              boxSizing: "border-box",
            }}
          />

          {/* Send button — Edullent blue gradient */}
          <button
            type="button"
            aria-label="Send message"
            onClick={handleSend}
            disabled={!messageContent.trim()}
            style={{
              width: 44, height: 44, borderRadius: "50%",
              background: messageContent.trim() ? "linear-gradient(135deg, #0055FF, #1166FF)" : "rgba(0,85,255,0.25)",
              border: "none", display: "flex", alignItems: "center", justifyContent: "center",
              cursor: messageContent.trim() ? "pointer" : "default",
              flexShrink: 0,
              boxShadow: messageContent.trim() ? "0 4px 14px rgba(0,85,255,0.36), 0 1px 3px rgba(0,85,255,0.18)" : "none",
              transition: "background 160ms ease, box-shadow 160ms ease",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>

      </div>
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only sub-components (new mockup design)
// ─────────────────────────────────────────────────────────────────────────────
const MOB_AV_PALETTE = ["#FF3355", "#00C853", "#7B3FF4", "#16B8B0", "#FF8800", "#0055FF", "#FFAA00", "#C2255C"];
const mobAvColor = (name: string) => {
  const sum = (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return MOB_AV_PALETTE[sum % MOB_AV_PALETTE.length];
};
const mobClassChip = (name: string) => {
  const lower = (name || "").toLowerCase();
  if (lower.includes("shaik")) return { bg: "rgba(123,63,244,.12)", color: "#7B3FF4" };
  return { bg: "rgba(9,87,247,.08)", color: "#0055FF" };
};
const mobFmtTimeAgo = (ts: any): string => {
  const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

interface MobileParentNotesListProps {
  stats: { total: number; parentReplies: number; students: number };
  noReplyCount: number;
  loading: boolean;
  roster: any[];
  filteredRoster: any[];
  lastMessages: Map<string, any>;
  unreadCounts: Map<string, number>;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  onOpenChat: (student: any) => void;
  onOpenCompose: (body?: string) => void;
  fmtTime: (ts: any) => string;
}

const MobileParentNotesList = ({
  stats, noReplyCount, loading, roster, filteredRoster,
  lastMessages, unreadCounts, searchQuery, setSearchQuery,
  onOpenChat, onOpenCompose, fmtTime: _fmtTime,
}: MobileParentNotesListProps) => {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  void _fmtTime;

  // Build class options from roster for dynamic filter chips
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    roster.forEach(s => {
      const c = (s.className || s.assignedClass || "").trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [roster]);

  // Counts per filter
  const countPending = useMemo(() => {
    return roster.filter(s => {
      const key = (s.studentId || s.studentEmail)?.toLowerCase();
      return !lastMessages.has(key) || (unreadCounts.get(key) || 0) > 0;
    }).length;
  }, [roster, lastMessages, unreadCounts]);

  const countResolved = roster.length - countPending;

  // Filter roster by tab
  const visibleRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = filteredRoster;
    if (activeFilter === "pending") {
      list = list.filter(s => {
        const key = (s.studentId || s.studentEmail)?.toLowerCase();
        return !lastMessages.has(key) || (unreadCounts.get(key) || 0) > 0;
      });
    } else if (activeFilter === "resolved") {
      list = list.filter(s => {
        const key = (s.studentId || s.studentEmail)?.toLowerCase();
        return lastMessages.has(key) && (unreadCounts.get(key) || 0) === 0;
      });
    } else if (activeFilter !== "all") {
      list = list.filter(s => (s.className || s.assignedClass || "") === activeFilter);
    }
    if (q) {
      list = list.filter(s =>
        (s.studentName || "").toLowerCase().includes(q) ||
        lastMessages.get((s.studentId || s.studentEmail)?.toLowerCase())?.content?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [filteredRoster, activeFilter, lastMessages, unreadCounts, searchQuery]);

  const templates = [
    { title: "Grade Concern",   desc: "Inform parent about declining grades", color: "#FF3355",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
      body: TEMPLATES[0].body },
    { title: "Good Performance", desc: "Share positive progress update",        color: "#00C853",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
      body: TEMPLATES[1].body },
    { title: "Attendance Issue", desc: "Report frequent absences",               color: "#FF8800",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
      body: TEMPLATES[2].body },
    { title: "Missing Work",     desc: "Notify about pending assignments",       color: "#7B3FF4",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
      body: TEMPLATES[3].body },
  ];

  const priorityStudent = useMemo(() => {
    return roster.find(s => {
      const name = (s.studentName || "").toLowerCase();
      return name.includes("critical") || name.includes("shaik sahab 4") || (unreadCounts.get((s.studentId || s.studentEmail)?.toLowerCase()) || 0) > 0;
    });
  }, [roster, unreadCounts]);

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7 text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <style>{`
        .pnl-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
        @media (hover:hover) { .pnl-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
        .pnl-card3d:active { transform: translateY(-1px) scale(.99); }
        .pnl-press { transition: all 0.3s ease; }
        .pnl-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
        .pnl-press:active { transform: scale(.94); }
        @keyframes pnlFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pnlPulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
        .pnl-pulse { animation: pnlPulse 1.8s ease-in-out infinite; }
        .pnl-enter > * { animation: pnlFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .pnl-enter > *:nth-child(1) { animation-delay: .04s; }
        .pnl-enter > *:nth-child(2) { animation-delay: .10s; }
        .pnl-enter > *:nth-child(3) { animation-delay: .16s; }
        .pnl-enter > *:nth-child(4) { animation-delay: .22s; }
        .pnl-enter > *:nth-child(5) { animation-delay: .28s; }
        .pnl-enter > *:nth-child(6) { animation-delay: .34s; }
        .pnl-enter > *:nth-child(7) { animation-delay: .40s; }
        .pnl-enter > *:nth-child(8) { animation-delay: .46s; }
        .pnl-chip-scroll::-webkit-scrollbar { display: none; }
        .pnl-chip-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="pnl-enter" style={{ display: "flex", flexDirection: "column" }}>

        {/* Page header with + pill */}
        <div style={{ padding: "8px 2px 14px", display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: 2, background: "#0055FF", display: "inline-block" }} />
              Teacher Dashboard · Parents
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Parent Notes</h1>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
              Communicate with parents and track conversations.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenCompose()}
            className="pnl-press"
            aria-label="New message"
            style={{
              height: 34, padding: "0 13px", borderRadius: 11,
              background: "#0055FF", color: "#fff",
              fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
              display: "flex", alignItems: "center", gap: 5, border: "none",
              boxShadow: "0 1px 2px rgba(9,87,247,.2), 0 4px 10px rgba(9,87,247,.3)",
              cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New
          </button>
        </div>

        {/* HERO */}
        <div
          className="pnl-card3d"
          role="button"
          tabIndex={0}
          aria-label="Compose new message"
          onClick={() => onOpenCompose()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenCompose(); } }}
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 26, padding: 22, marginBottom: 14,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.14)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.72)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Parent Messages</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>
                  Across {stats.students} parent{stats.students === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{
                marginLeft: "auto",
                background: countPending > 0 ? "rgba(255,170,0,.22)" : "rgba(0,232,102,.22)",
                border: `0.5px solid ${countPending > 0 ? "rgba(255,170,0,.55)" : "rgba(0,232,102,.55)"}`,
                color: countPending > 0 ? "#FFD060" : "#6FFFAA",
                padding: "5px 12px", borderRadius: 100, fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px",
              }}>
                <span className="pnl-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: countPending > 0 ? "#FFD060" : "#6FFFAA", boxShadow: `0 0 8px ${countPending > 0 ? "#FFD060" : "#6FFFAA"}` }} />
                {countPending > 0 ? `${countPending} Pending` : "All clear"}
              </div>
            </div>
            <div style={{ fontSize: 56, fontWeight: 700, color: "#fff", letterSpacing: "-2.6px", lineHeight: 1, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              {stats.total}
              <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.65)", letterSpacing: "-0.4px" }}>
                message{stats.total === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.72)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px" }}>
              <b style={{ color: "#fff", fontWeight: 700 }}>{countPending} pending replies</b>
              {countResolved > 0 ? ` — ${countResolved} resolved.` : " — start the conversation below."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.1)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#FFD060", letterSpacing: "-0.5px" }}>{countPending}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Pending</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.5px" }}>{countResolved}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Resolved</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>{roster.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Parents</div>
              </div>
            </div>
          </div>
        </div>

        {/* 2x2 stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            { key: "total",    label: "Total Messages",  value: stats.total,         color: "#0055FF",
              tintBg: "linear-gradient(135deg, #EEF4FF 0%, #E4ECFF 100%)", tintBorder: "rgba(0,85,255,0.10)",
              iconStroke: (<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>),
              sub: <span style={{ color: "#0055FF", fontWeight: 700 }}>● Sent by you</span>,
              onClick: () => setActiveFilter("all") },
            { key: "pending",  label: "Pending Replies", value: countPending,        color: "#FF8800",
              tintBg: "linear-gradient(135deg, #FFF6E8 0%, #FFEED4 100%)", tintBorder: "rgba(255,136,0,0.14)",
              iconStroke: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
              sub: countPending > 0
                ? <span style={{ color: "#FF8800", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><span className="pnl-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF8800" }} />Needs follow-up</span>
                : <span style={{ color: "#5070B0", fontWeight: 600 }}>All clear</span>,
              onClick: () => setActiveFilter("pending") },
            { key: "resolved", label: "Resolved",        value: countResolved,       color: "#00C853",
              tintBg: "linear-gradient(135deg, #E8FBEF 0%, #DAF6E4 100%)", tintBorder: "rgba(0,200,83,0.16)",
              iconStroke: (<><polyline points="20 6 9 17 4 12"/></>),
              sub: <span style={{ color: "#00C853", fontWeight: 700 }}>✓ Closed loops</span>,
              onClick: () => setActiveFilter("resolved") },
            { key: "parents",  label: "Parents",         value: roster.length,       color: "#7B3FF4",
              tintBg: "linear-gradient(135deg, #F2EBFF 0%, #E8DEFC 100%)", tintBorder: "rgba(123,63,244,0.12)",
              iconStroke: (<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>),
              sub: <span style={{ color: "#7B3FF4", fontWeight: 700 }}>Total contacts</span>,
              onClick: () => setActiveFilter("all") },
          ].map(s => (
            <button
              key={s.key}
              type="button"
              onClick={s.onClick}
              className="pnl-card3d"
              style={{
                background: s.tintBg, borderRadius: 20, padding: 14,
                display: "flex", flexDirection: "column",
                position: "relative", overflow: "hidden",
                border: `0.5px solid ${s.tintBorder}`,
                boxShadow: "0 6px 18px rgba(20,40,90,0.05), 0 1px 3px rgba(20,40,90,0.04)",
                textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <div style={{ position: "absolute", right: 10, bottom: 8, color: s.color, opacity: 0.22, pointerEvents: "none" }}>
                <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {s.iconStroke}
                </svg>
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${s.color}1F`, color: s.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10, position: "relative", zIndex: 1 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  {s.iconStroke}
                </svg>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: s.color, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6, position: "relative", zIndex: 1 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1.2px", lineHeight: 1, color: "#001040", position: "relative", zIndex: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, letterSpacing: "-0.15px", position: "relative", zIndex: 1 }}>{s.sub}</div>
            </button>
          ))}
        </div>

        {/* Quick Templates section */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px" }}>Quick Templates</span>
            <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>Tap to compose</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {templates.map(tpl => (
            <button
              key={tpl.title}
              type="button"
              onClick={() => onOpenCompose(tpl.body)}
              className="pnl-card3d"
              style={{
                background: "#fff", borderRadius: 16, padding: "14px 12px",
                cursor: "pointer", position: "relative", overflow: "hidden",
                boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                textAlign: "left", border: "none", fontFamily: "inherit",
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 11, background: tpl.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>{tpl.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.2, marginBottom: 4 }}>{tpl.title}</div>
              <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.4 }}>{tpl.desc}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#99AACC" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search parent or message…"
            style={{
              width: "100%", padding: "10px 13px 10px 34px", borderRadius: 12,
              border: "none", background: "#fff",
              fontSize: 12, color: "#001040", fontFamily: "inherit", outline: "none",
              boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 2px 8px rgba(9,87,247,.06)",
              fontWeight: 500, letterSpacing: "-0.1px",
            }}
          />
        </div>

        {/* Filter chips */}
        <div className="pnl-chip-scroll" style={{ display: "flex", gap: 7, overflowX: "auto", margin: "0 -16px 14px", padding: "2px 16px 6px" }}>
          {[
            { key: "all",      label: "All",      count: roster.length },
            { key: "pending",  label: "Pending",  count: countPending },
            { key: "resolved", label: "Resolved", count: countResolved },
            ...classOptions.map(c => ({ key: c, label: c, count: roster.filter(s => (s.className || s.assignedClass) === c).length })),
          ].map(ch => {
            const active = activeFilter === ch.key;
            return (
              <button
                key={ch.key}
                type="button"
                onClick={() => setActiveFilter(ch.key)}
                className="pnl-press"
                style={{
                  flexShrink: 0, padding: "8px 14px", borderRadius: 100,
                  background: active ? "#0055FF" : "#fff",
                  color: active ? "#fff" : "#5070B0",
                  fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: active ? "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.3)" : "0 0.5px 1px rgba(9,87,247,.04), 0 2px 6px rgba(9,87,247,.06)",
                  display: "flex", alignItems: "center", gap: 5, border: "none",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {ch.label}
                <span style={{
                  background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                  color: active ? "#fff" : "#5070B0",
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100,
                }}>{ch.count}</span>
              </button>
            );
          })}
        </div>

        {/* Inbox section */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#001040", letterSpacing: "-0.35px" }}>
              {activeFilter === "all" ? "All Messages" : activeFilter === "pending" ? "Pending" : activeFilter === "resolved" ? "Resolved" : activeFilter}
            </span>
            <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
              {visibleRoster.length} {visibleRoster.length === 1 ? "conversation" : "conversations"}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="pnl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "40px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)" }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#5070B0" }} />
            <span style={{ fontSize: 12, color: "#5070B0" }}>Loading messages…</span>
          </div>
        ) : visibleRoster.length === 0 ? (
          <div className="pnl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center", boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>
              {searchQuery ? "No matches" : activeFilter === "pending" ? "Nothing pending" : activeFilter === "resolved" ? "Nothing resolved yet" : "No parents yet"}
            </div>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
              {searchQuery ? "Try a different search term." : "Tap New above to start a conversation."}
            </div>
          </div>
        ) : (
          <div className="pnl-card3d" style={{
            background: "#fff", borderRadius: 20, padding: 4, marginBottom: 14,
            boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
            overflow: "hidden",
          }}>
            {visibleRoster.map((s, idx) => {
              const key = (s.studentId || s.studentEmail)?.toLowerCase();
              const last = lastMessages.get(key);
              const unread = unreadCounts.get(key) || 0;
              const has = !!last;
              const pending = !has || unread > 0;
              const avC = mobAvColor(s.studentName || "S");
              const clsName = s.className || s.assignedClass || "";
              const chip = mobClassChip(clsName);
              const preview = has
                ? (last.content || "")
                : "Tap to start conversation";

              return (
                <div
                  key={s.id}
                  onClick={() => onOpenChat(s)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenChat(s); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11,
                    padding: "12px 10px", borderRadius: 16, cursor: "pointer",
                    position: "relative", transition: "background .15s cubic-bezier(.2,.9,.3,1)",
                    borderTop: idx > 0 ? "0.5px solid rgba(9,87,247,.08)" : "none",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#F4F7FE"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 14,
                    background: avC, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, letterSpacing: "0.3px", flexShrink: 0,
                    position: "relative",
                  }}>
                    {getInitials(s.studentName || "S")}
                    {unread > 0 && (
                      <div style={{
                        position: "absolute", top: -2, right: -2,
                        width: 12, height: 12, borderRadius: "50%",
                        background: "#0055FF", border: "2.5px solid #fff",
                        boxShadow: "0 2px 5px rgba(9,87,247,.3)",
                      }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.3px", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                        {s.studentName}'s Parents
                      </div>
                      <div style={{ fontSize: 10, fontWeight: unread > 0 ? 800 : 700, color: unread > 0 ? "#0055FF" : "#99AACC", letterSpacing: "-0.1px", flexShrink: 0 }}>
                        {has ? mobFmtTimeAgo(last.createdAt) : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {clsName && (
                        <span style={{
                          background: chip.bg, color: chip.color,
                          padding: "2px 7px", borderRadius: 6,
                          fontSize: 9, fontWeight: 700, letterSpacing: "-0.1px", flexShrink: 0,
                        }}>
                          {clsName}
                        </span>
                      )}
                      <span style={{
                        fontSize: 11, fontWeight: unread > 0 ? 600 : 500,
                        color: unread > 0 ? "#001040" : "#5070B0",
                        letterSpacing: "-0.1px",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        flex: 1, minWidth: 0,
                      }}>
                        {preview}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    {pending ? (
                      <div style={{
                        minWidth: 18, height: 18, padding: "0 5px",
                        background: "#FF8800", color: "#fff", borderRadius: 100,
                        fontSize: 10, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 1px 2px rgba(255,136,0,.2), 0 2px 6px rgba(255,136,0,.25)",
                      }}>!</div>
                    ) : (
                      <div style={{ color: "#00C853", display: "flex" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {noReplyCount > 0 && activeFilter === "all" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 13px", borderTop: "0.5px solid rgba(9,87,247,.08)", background: "#F4F7FE", borderRadius: 12 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5070B0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>
                </svg>
                <span style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px" }}>
                  {noReplyCount} parent{noReplyCount > 1 ? "s" : ""} haven't received a message yet
                </span>
              </div>
            )}
          </div>
        )}

        {/* AI Parent Intelligence */}
        {!loading && roster.length > 0 && (
          <div
            className="pnl-card3d"
            role="button"
            tabIndex={0}
            aria-label="Compose new message"
            onClick={() => onOpenCompose()}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenCompose(); } }}
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              borderRadius: 24, padding: 20, marginTop: 14,
              position: "relative", overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)",
            }}
          >
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, position: "relative", zIndex: 2 }}>
              <div style={{ width: 40, height: 40, borderRadius: 13, background: "rgba(255,255,255,.14)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55", fontSize: 19 }}>⚡</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.95)", letterSpacing: "1.8px", textTransform: "uppercase" }}>AI Parent Intelligence</div>
              <div style={{ marginLeft: "auto", background: "rgba(123,63,244,.3)", border: "0.5px solid rgba(155,95,255,.5)", color: "#DCC8FF", padding: "4px 10px", borderRadius: 100, fontSize: 9, fontWeight: 700, letterSpacing: "0.5px" }}>Tip</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,.85)", letterSpacing: "-0.15px", marginBottom: 14, position: "relative", zIndex: 2 }}>
              {countPending > 0 ? (
                <>
                  <strong style={{ color: "#fff", fontWeight: 700 }}>{countPending} pending replies</strong>
                  {priorityStudent ? <> — prioritise <strong style={{ color: "#fff", fontWeight: 700 }}>{priorityStudent.studentName}'s parents</strong>.</> : <> — tap a template below for a quick send.</>}
                  {" "}Use the <strong style={{ color: "#fff", fontWeight: 700 }}>Attendance Issue</strong> template for urgent cases.
                </>
              ) : (
                <>Great work — all parent conversations are up to date. Keep them engaged with a <strong style={{ color: "#fff", fontWeight: 700 }}>Good Performance</strong> update.</>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", background: "rgba(255,255,255,.1)", borderRadius: 12, padding: 1, gap: 1, overflow: "hidden", position: "relative", zIndex: 2 }}>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#FFD060", letterSpacing: "-0.4px" }}>{countPending}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Pending</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#6FFFAA", letterSpacing: "-0.4px" }}>{countResolved}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Resolved</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: "-0.4px" }}>{roster.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Parents</div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// Mobile compose bottom sheet
interface MobileComposeSheetProps {
  roster: any[];
  composeSearch: string;
  setComposeSearch: (s: string) => void;
  composeStudentKey: string;
  setComposeStudentKey: (s: string) => void;
  composeText: string;
  setComposeText: (s: string) => void;
  composeSending: boolean;
  closeCompose: () => void;
  onSend: () => void;
}

const MobileComposeSheet = ({
  roster, composeSearch, setComposeSearch,
  composeStudentKey, setComposeStudentKey,
  composeText, setComposeText, composeSending,
  closeCompose, onSend,
}: MobileComposeSheetProps) => {
  const [activeTpl, setActiveTpl] = useState<string | null>(null);
  const tplChips = [
    { key: "grade",      title: "Grade Concern",    dot: "#FF3355", body: TEMPLATES[0].body },
    { key: "good",       title: "Good Performance", dot: "#00C853", body: TEMPLATES[1].body },
    { key: "attendance", title: "Attendance",       dot: "#FF8800", body: TEMPLATES[2].body },
    { key: "missing",    title: "Missing Work",     dot: "#7B3FF4", body: TEMPLATES[3].body },
    { key: "meeting",    title: "Meeting",          dot: "#0055FF", body: TEMPLATES[4].body },
  ];
  const filtered = useMemo(() => {
    const q = composeSearch.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(s =>
      (s.studentName || "").toLowerCase().includes(q) ||
      (s.className || s.assignedClass || "").toLowerCase().includes(q)
    );
  }, [roster, composeSearch]);
  const selected = roster.find(s => (s.studentId || s.studentEmail) === composeStudentKey);

  return (
    <>
      <div
        onClick={() => !composeSending && closeCompose()}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,10,40,.5)",
          backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
          animation: "pncBackdrop .35s cubic-bezier(.2,.9,.3,1) both",
        }}
      />
      <style>{`
        @keyframes pncBackdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pncSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .pnc-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .pnc-press:active { transform: scale(.94); }
        .pnc-scroll::-webkit-scrollbar { display: none; }
        .pnc-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        background: "#fff",
        borderRadius: "26px 26px 0 0",
        maxHeight: "92vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 -20px 60px rgba(0,8,60,.3)",
        animation: "pncSheet .45s cubic-bezier(.34,1.56,.64,1) both",
        fontFamily: "inherit",
      }}>
        <div style={{ width: 40, height: 5, background: "rgba(9,87,247,.2)", borderRadius: 100, margin: "10px auto 6px", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px 14px", borderBottom: "0.5px solid rgba(9,87,247,.08)", flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 13, background: "#0055FF", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#001040", letterSpacing: "-0.4px" }}>New message to parent</div>
            <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, marginTop: 2, letterSpacing: "-0.1px" }}>Pick a parent, tap a template or type your own</div>
          </div>
          <button
            type="button"
            onClick={closeCompose}
            disabled={composeSending}
            className="pnc-press"
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 10, background: "#F4F7FE",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#002080", flexShrink: 0, cursor: "pointer",
              border: "none", fontFamily: "inherit",
              opacity: composeSending ? 0.5 : 1,
            }}
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>

        <div className="pnc-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {/* Parent search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 13px", background: "#F4F7FE",
            borderRadius: 12, marginBottom: 12,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
            </svg>
            <input
              value={composeSearch}
              onChange={e => setComposeSearch(e.target.value)}
              placeholder="Search parent or class…"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                fontSize: 13, color: "#001040", fontFamily: "inherit", fontWeight: 500, letterSpacing: "-0.1px",
              }}
            />
          </div>

          <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            Select Parent
            <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 700 }}>*</span>
          </div>

          <div className="pnc-scroll" style={{
            background: "#F4F7FE", borderRadius: 14, padding: 3,
            marginBottom: 16, maxHeight: 180, overflowY: "auto",
          }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: "#99AACC", padding: "16px 10px", textAlign: "center", fontWeight: 600 }}>
                No parents match.
              </div>
            ) : filtered.map((s, idx) => {
              const key = s.studentId || s.studentEmail;
              const isSel = key === composeStudentKey;
              const avC = mobAvColor(s.studentName || "S");
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setComposeStudentKey(key)}
                  className="pnc-press"
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "8px 10px", borderRadius: 11,
                    background: isSel ? "#fff" : "transparent",
                    boxShadow: isSel ? "0 0.5px 1px rgba(9,87,247,.05), 0 2px 8px rgba(9,87,247,.1)" : "none",
                    cursor: "pointer", border: "none", fontFamily: "inherit",
                    textAlign: "left", position: "relative",
                    borderTop: idx > 0 && !isSel ? "0.5px solid rgba(9,87,247,.08)" : "none",
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 11,
                    background: avC, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: "0.3px",
                  }}>
                    {getInitials(s.studentName || "S")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.studentName}</div>
                    <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.1px", marginTop: 1 }}>{s.className || s.assignedClass || "No class"}</div>
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    border: isSel ? "none" : "1.5px solid rgba(9,87,247,.18)",
                    background: isSel ? "#0055FF" : "transparent",
                    color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    boxShadow: isSel ? "0 1px 2px rgba(9,87,247,.25), 0 3px 8px rgba(9,87,247,.3)" : "none",
                  }}>
                    {isSel && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Template chips */}
          <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Quick Templates</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {tplChips.map(ch => {
              const active = activeTpl === ch.key;
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => {
                    setActiveTpl(ch.key);
                    setComposeText(composeText.trim() ? composeText + "\n\n" + ch.body : ch.body);
                  }}
                  className="pnc-press"
                  style={{
                    padding: "7px 12px", borderRadius: 100,
                    background: active ? "#0055FF" : "#F4F7FE",
                    color: active ? "#fff" : "#002080",
                    fontSize: 11, fontWeight: 700, letterSpacing: "-0.15px",
                    display: "inline-flex", alignItems: "center", gap: 5,
                    cursor: "pointer", fontFamily: "inherit",
                    border: active ? "0.5px solid #0055FF" : "0.5px solid rgba(9,87,247,.08)",
                    boxShadow: active ? "0 1px 2px rgba(9,87,247,.2), 0 3px 8px rgba(9,87,247,.25)" : "none",
                    transition: "all .18s cubic-bezier(.2,.9,.3,1)",
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: active ? "rgba(255,255,255,.7)" : ch.dot,
                  }} />
                  {ch.title}
                </button>
              );
            })}
          </div>

          {/* Message textarea */}
          <div style={{ fontSize: 9, fontWeight: 700, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 10 }}>Message</div>
          <textarea
            value={composeText}
            onChange={e => setComposeText(e.target.value)}
            placeholder={selected ? `Write a message to parent of ${selected.studentName}…` : "Pick a parent above, then write your message."}
            style={{
              width: "100%", minHeight: 120, padding: "13px 14px",
              background: "#F4F7FE", border: "0.5px solid rgba(9,87,247,.08)",
              borderRadius: 14,
              fontSize: 14, fontWeight: 500, color: "#001040",
              fontFamily: "inherit", letterSpacing: "-0.15px",
              resize: "none", outline: "none", lineHeight: 1.5,
              transition: "all .2s cubic-bezier(.2,.9,.3,1)",
            }}
            onFocus={e => {
              e.currentTarget.style.background = "#fff";
              e.currentTarget.style.borderColor = "#0055FF";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(9,87,247,.12)";
            }}
            onBlur={e => {
              e.currentTarget.style.background = "#F4F7FE";
              e.currentTarget.style.borderColor = "rgba(9,87,247,.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          <div style={{ fontSize: 11, color: "#99AACC", marginTop: 8, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#002080", fontWeight: 600 }}>
              {selected ? <>Sending to <b style={{ color: "#001040", fontWeight: 700 }}>{selected.studentName}'s</b> parent</> : "No recipient selected"}
            </span>
            <span style={{ color: "#5070B0", fontWeight: 600 }}>{composeText.length} / 500</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "14px 18px 18px", borderTop: "0.5px solid rgba(9,87,247,.08)", background: "#fff", flexShrink: 0 }}>
          <button
            type="button"
            onClick={closeCompose}
            disabled={composeSending}
            className="pnc-press"
            style={{
              flex: "0 0 100px", height: 46, borderRadius: 14,
              background: "#F4F7FE", color: "#002080",
              fontSize: 13, fontWeight: 700, border: "none",
              letterSpacing: "-0.2px", cursor: composeSending ? "not-allowed" : "pointer",
              fontFamily: "inherit", opacity: composeSending ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={composeSending || !composeText.trim() || !composeStudentKey}
            className="pnc-press"
            style={{
              flex: 1, height: 46, borderRadius: 14,
              background: "linear-gradient(135deg, #4A85FF 0%, #0055FF 100%)",
              color: "#fff",
              fontSize: 14, fontWeight: 700, border: "none",
              letterSpacing: "-0.2px",
              cursor: (composeSending || !composeText.trim() || !composeStudentKey) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              boxShadow: "0 1px 2px rgba(9,87,247,.25), 0 6px 16px rgba(9,87,247,.38)",
              fontFamily: "inherit",
              opacity: (composeSending || !composeText.trim() || !composeStudentKey) ? 0.5 : 1,
            }}
          >
            {composeSending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} strokeWidth={2.6} /> Send</>}
          </button>
        </div>
      </div>
    </>
  );
};

// ── Helper sub-components ─────────────────────────────────────────────────────

function fmtDate(ts: any) {
  const d     = ts?.toDate?.() || new Date();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const HeroChip = ({ icon, value, label }: { icon: string; value: number; label: string }) => (
  <div style={{
    padding: "5px 10px", borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 10, color: "rgba(255,255,255,0.6)",
    display: "inline-flex", alignItems: "center", gap: 4,
  }}>
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {icon === "msg"    && <path d="M1,7.5 L9,7.5 L7.5,5 L9,2.5 L1,2.5 L2.5,5 Z" />}
      {icon === "check"  && <polyline points="1.5,6.5 4,9 8.5,2" />}
      {icon === "person" && <><path d="M1 8.5c0 0 1.5-2 4-2s4 2 4 2" /><circle cx="5" cy="4" r="2" /></>}
    </svg>
    <strong style={{ color: "#fff", fontWeight: 500 }}>{value}</strong>
    {label}
  </div>
);

const StatCard = ({ label, value, color, icon, onClick }: { label: string; value: number; color: string; icon: string; onClick?: () => void }) => (
  <div
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    className={onClick ? "clickable-card" : undefined}
    style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13, padding: "11px 10px" }}>

    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {icon === "msg"    && <path d="M1,8 L11,8 L9,5 L11,2 L1,2 L3,5 Z" />}
        {icon === "mail"   && <><rect x="1" y="2" width="10" height="8" rx="1.5" /><polyline points="1,5 6,7.5 11,5" /></>}
        {icon === "person" && <><path d="M1.5 10c0 0 1.5-2 4.5-2s4.5 2 4.5 2" /><circle cx="6" cy="5" r="2.5" /></>}
      </svg>
      <span style={{ fontSize: 9, color: T.ink3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
    <div style={{ fontSize: 19, fontWeight: 500, color, letterSpacing: "-0.4px" }}>{value}</div>
  </div>
);

export default ParentNotes;