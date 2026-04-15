import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, addDoc,
  serverTimestamp, getDocs, writeBatch, updateDoc, doc,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

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
  amb:     "#C87014",
  alBg:    "#FFF9DB",
  tea:     "#0C8599",
  tlBg:    "#E3FAFC",
  chatBg:  "#F0F2F8",
  chatOut: "#3B5BDB",
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
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [allNotes, setAllNotes]               = useState<any[]>([]);
  const [roster, setRoster]                   = useState<any[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [searchQuery, setSearchQuery]         = useState("");
  const [messageContent, setMessageContent]   = useState("");
  const chatEndRef  = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id) return;

    const q1 = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsub1 = onSnapshot(q1, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const map = new Map();
      docs.forEach((d: any) => {
        const key = (d.studentId || d.studentEmail || d.id).toLowerCase();
        if (!map.has(key)) map.set(key, d);
      });
      setRoster(Array.from(map.values()));
    });

    const q2 = query(collection(db, "parent_notes"), where("teacherId", "==", teacherData.id));
    const unsub2 = onSnapshot(q2, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setAllNotes(data);
      setLoading(false);
    });

    return () => { unsub1(); unsub2(); };
  }, [teacherData?.id]);

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
        updateDoc(doc(db, "parent_notes", n.id), { read: true }).catch(() => {});
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
      await addDoc(collection(db, "parent_notes"), {
        teacherId:    teacherData?.id   || "",
        teacherName:  teacherData?.name || "Teacher",
        studentId:    selectedStudent.studentId    || "",
        studentEmail: selectedStudent.studentEmail?.toLowerCase() || "",
        studentName:  selectedStudent.studentName  || "",
        parentName:   `Parent of ${selectedStudent.studentName}`,
        content, from: "teacher", status: "Sent",
        createdAt: serverTimestamp(),
      });
    } catch { toast.error("Failed to send."); setMessageContent(content); }
  };

  const handleClearChat = async () => {
    if (!selectedStudent || !confirm(`Clear chat for ${selectedStudent.studentName}?`)) return;
    try {
      const sId = selectedStudent.studentId;
      const q   = query(collection(db, "parent_notes"), where("teacherId", "==", teacherData?.id), where("studentId", "==", sId));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast.success("Chat cleared!");
    } catch { toast.error("Error clearing chat."); }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const lastParentMsg = useMemo(() => {
    return studentMessages.filter(m => m.from === "parent").reverse()[0];
  }, [studentMessages]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (selectedStudent) return <ChatView />;
  return <ListView />;

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  function ListView() {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, paddingBottom: 0 }}>

        {/* ── Dark hero ───────────────────────────────────────────────────── */}
        <div
          className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
          style={{ background: T.hero, padding: "0 22px 24px" }}
        >
          <div style={{ paddingTop: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              Communication
            </p>
            <h1 style={{ fontSize: 26, fontWeight: 500, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1.1, marginBottom: 6 }}>
              Parent<br />messages
            </h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
              Stay connected with student parents.
            </p>

            {/* Chips */}
            <div style={{ display: "flex", gap: 7, marginTop: 16, flexWrap: "wrap" }}>
              <HeroChip icon="msg"    value={stats.total}         label="Messages" />
              <HeroChip icon="check"  value={stats.parentReplies} label="Replies" />
              <HeroChip icon="person" value={stats.students}      label="Parents" />
            </div>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>

          {/* 3-stat row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <StatCard label="Messages" value={stats.total}         color={T.blue} icon="msg" />
            <StatCard label="Replies"  value={stats.parentReplies} color={T.amb}  icon="mail" />
            <StatCard label="Students" value={stats.students}      color={T.grn}  icon="person" />
          </div>

          {/* Search */}
          <div style={{ position: "relative" }}>
            <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4" /><line x1="9" y1="9" x2="12.5" y2="12.5" />
            </svg>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search students or messages..."
              style={{
                width: "100%", padding: "10px 10px 10px 28px",
                borderRadius: 11, border: `1px solid ${T.bdr}`,
                background: T.white, fontSize: 12, color: T.ink1,
                fontFamily: "inherit", outline: "none",
              }}
            />
          </div>

          {/* Section label */}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5,9.5 L12.5,9.5 L10.5,6.5 L12.5,3.5 L1.5,3.5 L3.5,6.5 Z" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: T.ink1 }}>Parent communication</span>
          </div>

          {/* Conversation list */}
          <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 17, overflow: "hidden" }}>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 style={{ width: 24, height: 24, color: T.ink3 }} className="animate-spin" />
              </div>
            ) : filteredRoster.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "40px 0" }}>No students found</p>
            ) : (
              <>
                {filteredRoster.map((s, idx) => {
                  const key     = (s.studentId || s.studentEmail)?.toLowerCase();
                  const last    = lastMessages.get(key);
                  const unread  = unreadCounts.get(key) || 0;
                  const has     = !!last;
                  const av      = avStyle(s.studentName || "S");
                  const clsName = s.className || s.assignedClass || "";

                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedStudent(s)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 13px",
                        borderBottom: idx < filteredRoster.length - 1 ? `1px solid ${T.s2}` : "none",
                        background: unread > 0 ? T.blBg : "transparent",
                        cursor: "pointer",
                        transition: "background 80ms",
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 38, height: 38, borderRadius: 11,
                        background: av.bg, color: av.c,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 500, flexShrink: 0, position: "relative",
                      }}>
                        {getInitials(s.studentName || "S")}
                        {unread > 0 && (
                          <div style={{
                            position: "absolute", top: -3, right: -3,
                            width: 10, height: 10, borderRadius: "50%",
                            background: T.red, border: `2px solid ${T.white}`,
                          }} />
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>{s.studentName}</p>
                        <div style={{
                          fontSize: 11, color: T.ink3, marginTop: 2,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          display: "flex", alignItems: "center", gap: 4,
                          fontStyle: !has ? "italic" : "normal",
                        }}>
                          {has && last.from === "parent" && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M1,7 L9,7 L7.5,4.5 L9,2 L1,2 L2.5,4.5 Z" />
                            </svg>
                          )}
                          {has && last.from === "teacher" && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <polyline points="1,5.5 3.5,8 7,3" /><polyline points="3,5.5 5.5,8 9,3" />
                            </svg>
                          )}
                          {has ? last.content : "No messages yet"}
                        </div>
                      </div>

                      {/* Right side */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                        {has && <span style={{ fontSize: 10, color: T.ink3 }}>{fmtTime(last.createdAt)}</span>}
                        {unread > 0 ? (
                          <span style={{ padding: "2px 7px", borderRadius: 20, background: T.red, color: "#fff", fontSize: 10, fontWeight: 500 }}>New</span>
                        ) : !has ? (
                          <span style={{ padding: "2px 7px", borderRadius: 20, background: T.s2, color: T.ink3, fontSize: 10, fontWeight: 500 }}>Tap to start</span>
                        ) : clsName ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: T.ink3 }}>
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 8V5.5L5 3l4 2.5V8" /><rect x="3.5" y="6" width="3" height="2" rx=".4" />
                            </svg>
                            {clsName}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* "No reply" footer */}
                {noReplyCount > 0 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "9px 13px", borderTop: `1px solid ${T.s2}`,
                    background: T.s1,
                  }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="6" r="4.5" /><line x1="6" y1="3.5" x2="6" y2="6.5" />
                      <circle cx="6" cy="8.5" r=".6" fill={T.ink3} stroke="none" />
                    </svg>
                    <span style={{ fontSize: 10, color: T.ink3 }}>
                      {noReplyCount} parent{noReplyCount > 1 ? "s" : ""} haven't received a message yet
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Compose button */}
          <button
            onClick={() => { searchRef.current?.focus(); }}
            style={{
              width: "100%", padding: 12, borderRadius: 12,
              background: T.blue, border: "none", color: "#fff",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            New message to parent
          </button>
        </div>

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
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 -mb-4 sm:-mb-6 md:-mb-8"
        style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 56px)", background: T.chatBg }}
      >
        {/* ── Dark chat header ─────────────────────────────────────────────── */}
        <div style={{ background: T.hero, padding: "12px 22px 18px", flexShrink: 0 }}>
          {/* Back link */}
          <button
            onClick={() => setSelectedStudent(null)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "none", border: "none", cursor: "pointer",
              marginBottom: 10, padding: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.blue} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8,2 3,6.5 8,11" />
            </svg>
            <span style={{ fontSize: 12, color: T.blue }}>All messages</span>
          </button>

          {/* Student row */}
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13,
              background: av.bg, color: av.c,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 500, flexShrink: 0,
              border: "2px solid rgba(255,255,255,0.12)",
            }}>
              {getInitials(selectedStudent.studentName || "S")}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#fff", letterSpacing: "-0.2px", margin: 0 }}>
                {selectedStudent.studentName}
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                {clsName ? `${clsName} · ` : ""}Parent of {selectedStudent.studentName}
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              {/* Phone */}
              <IconBtn>
                <path d="M2,3 C2,3 3,2 5,2.5 L6,4.5 C6,4.5 5.5,5 5,5.5 C5.5,6.5 6.5,7.5 7.5,8 C8,7.5 8.5,7 8.5,7 L10.5,8 C11,10 10,10 10,10 C8,11 2,7 2,3Z" />
              </IconBtn>
              {/* Flag */}
              <IconBtn>
                <polyline points="2,3 11,3 9.5,5 11,7 2,7 4,5" />
              </IconBtn>
              {/* Clear chat */}
              <div
                onClick={handleClearChat}
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.07)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,5 11,5" /><polyline points="9,3 11,5 9,7" />
                  <line x1="5" y1="8" x2="5" y2="11.5" /><polyline points="3,9.5 5,11.5 7,9.5" />
                </svg>
              </div>
            </div>
          </div>

          {/* Online status */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: lastSeen ? "#4CC9A4" : T.ink3 }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {lastSeen ? `Parent active · Last seen ${lastSeen}` : "No parent messages yet"}
            </span>
          </div>
        </div>

        {/* ── Messages ─────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, padding: "14px 12px", overflowY: "auto" }}>
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
                {/* Date chip */}
                <div style={{ textAlign: "center", margin: "10px 0" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 500, color: T.ink3,
                    background: "rgba(142,148,164,0.12)",
                    padding: "4px 10px", borderRadius: 20,
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
                        display: "flex", flexDirection: "column", gap: 4,
                        marginBottom: 14,
                        alignItems: isTeacher ? "flex-end" : "flex-start",
                      }}
                    >
                      {/* Sender label for parent messages */}
                      {!isTeacher && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 8,
                            background: T.s2, display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 10c0 0 1.5-2 5-2s5 2 5 2" /><circle cx="6" cy="5" r="2.5" />
                            </svg>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 500, color: T.ink3 }}>Parent</span>
                        </div>
                      )}

                      {/* Bubble */}
                      <div style={{
                        padding: "9px 12px", borderRadius: 16, maxWidth: "78%",
                        background: isTeacher ? T.chatOut : T.white,
                        border: isTeacher ? "none" : `1px solid ${T.bdr}`,
                        borderBottomRightRadius: isTeacher ? 4 : 16,
                        borderBottomLeftRadius: isTeacher ? 16 : 4,
                      }}>
                        <p style={{ fontSize: 13, lineHeight: 1.45, color: isTeacher ? "#fff" : T.ink1, margin: 0, whiteSpace: "pre-wrap" }}>
                          {n.content}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 9, color: isTeacher ? "rgba(255,255,255,0.6)" : T.ink3 }}>
                            {fmtTime(n.createdAt)}
                          </span>
                          {isTeacher && (
                            <svg width="12" height="9" viewBox="0 0 14 9" fill="none" stroke="#4CC9A4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1,5 4,8 8,2" /><polyline points="5,5 8,8 13,2" />
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

        {/* ── Chat input ───────────────────────────────────────────────────── */}
        <div style={{
          background: T.white, borderTop: `1px solid ${T.bdr}`,
          padding: "10px 12px", display: "flex", alignItems: "center", gap: 8,
          flexShrink: 0, marginBottom: 0,
        }}
        >
          {/* Emoji button */}
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: T.s1, border: `1px solid ${T.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="5.5" />
              <circle cx="4.5" cy="5.5" r=".7" fill={T.ink3} stroke="none" />
              <circle cx="9.5" cy="5.5" r=".7" fill={T.ink3} stroke="none" />
              <path d="M4.5,8.5 C4.5,10 9.5,10 9.5,8.5" />
            </svg>
          </div>

          {/* Text input */}
          <input
            value={messageContent}
            onChange={e => setMessageContent(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
            placeholder="Message parent..."
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 20,
              border: `1px solid ${T.bdr}`, background: T.s1,
              fontSize: 12, color: T.ink1, fontFamily: "inherit", outline: "none",
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!messageContent.trim()}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: messageContent.trim() ? T.blue : T.s2,
              border: "none", display: "flex", alignItems: "center", justifyContent: "center",
              cursor: messageContent.trim() ? "pointer" : "default",
              flexShrink: 0, transition: "background 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={messageContent.trim() ? "#fff" : T.ink3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="6.5" x2="11" y2="6.5" /><polyline points="8,3.5 11,6.5 8,9.5" />
            </svg>
          </button>
        </div>

      </div>
    );
  }
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

const StatCard = ({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) => (
  <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13, padding: "11px 10px" }}>
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

const IconBtn = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    width: 32, height: 32, borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.07)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  }}>
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </div>
);

export default ParentNotes;