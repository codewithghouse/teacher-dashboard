import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  addDoc, serverTimestamp, updateDoc, doc,
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:   "#08090C",
  bg:     "#F5F6F9",
  white:  "#ffffff",
  ink1:   "#08090C",
  ink2:   "#42475A",
  ink3:   "#8C92A4",
  s1:     "#F5F6F9",
  s2:     "#ECEEF4",
  bdr:    "#E2E5EE",
  blue:   "#3B5BDB",
  blBg:   "#EDF2FF",
  blBdr:  "#BAC8FF",
  pur:    "#6741D9",
  plBg:   "#F3F0FF",
  grn:    "#087F5B",
  grn2:   "#2F9E44",
  glBg:   "#EBFBEE",
  red:    "#C92A2A",
  amb:    "#C87014",
  chatBg: "#EEF0F7",
};

// ── Icon button helper ────────────────────────────────────────────────────────
const IcoBtn = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <div
    onClick={onClick}
    style={{
      width: 30, height: 30, borderRadius: 9,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.07)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", flexShrink: 0,
    }}
  >
    <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </div>
);

// ── Principal school icon ─────────────────────────────────────────────────────
const SchoolIco = ({ size = 20, color = T.blBdr }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 16V10.5L10 5l8 5.5V16" /><rect x="7.5" y="11" width="5" height="5" rx="1" /><circle cx="10" cy="9" r="2" />
  </svg>
);

// ── Quick replies ─────────────────────────────────────────────────────────────
const QUICK_REPLIES = ["Yes sir ✓", "Will do", "On my way", "Noted", "Please give details"];

// ── Main component ────────────────────────────────────────────────────────────
const PrincipalNotes = () => {
  const { teacherData } = useAuth();
  const [allMessages, setAllMessages]       = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [messageContent, setMessageContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Firebase listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "principal_to_teacher_notes"), where("teacherId", "==", teacherData.id)),
      async snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        data.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
        setAllMessages(data);
        setLoading(false);
        // Auto-mark principal messages as read
        for (const d of snap.docs) {
          const dd = d.data();
          if (dd.read === false && dd.from === "principal") {
            try { await updateDoc(doc(db, "principal_to_teacher_notes", d.id), { read: true }); } catch { /* silent */ }
          }
        }
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  // Scroll to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages]);

  // ── Computed values ─────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:  allMessages.length,
    unread: allMessages.filter(m => m.read === false && m.from === "principal").length,
  }), [allMessages]);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    allMessages.forEach(msg => {
      const label = fmtDate(msg.timestamp);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [allMessages]);

  const principalName = allMessages[0]?.principalName || "Principal";

  const lastPrincipalMsg = useMemo(() => {
    return [...allMessages].reverse().find(m => m.from === "principal");
  }, [allMessages]);

  // ── Send handler ────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!messageContent.trim()) return;
    const content = messageContent.trim();
    setMessageContent("");
    try {
      await addDoc(collection(db, "principal_to_teacher_notes"), {
        principalId:   allMessages[0]?.principalId   || "",
        principalName: allMessages[0]?.principalName || "Principal",
        teacherId:     teacherData?.id   || "",
        teacherName:   teacherData?.name || "",
        className:     teacherData?.assignedClass || teacherData?.className || "",
        message: content, from: "teacher",
        timestamp: serverTimestamp(),
        schoolId: teacherData?.schoolId || "",
        branchId: teacherData?.branchId || "",
        read: false,
      });
    } catch { toast.error("Failed to send."); setMessageContent(content); }
  };

  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const lastSeenStr = lastPrincipalMsg ? `Online · Last seen ${fmtTime(lastPrincipalMsg.timestamp)}` : "Offline";

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg, paddingBottom: 0 }}>

      {/* ═══ DARK HERO + PRINCIPAL CARD ═══════════════════════════════════ */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8"
        style={{ background: T.hero, padding: "0 22px 0" }}
      >
        {/* Hero text */}
        <div style={{ paddingTop: 18 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.28)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
            Admin communication
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1.1, marginBottom: 4 }}>
            Principal<br />notes
          </h1>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>
            Direct channel with school administration.
          </p>

          {/* Stat chips row */}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {/* Messages */}
            <div style={{
              padding: "8px 12px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1,8.5 L11,8.5 L9,5.5 L11,2.5 L1,2.5 L3,5.5 Z" />
              </svg>
              <div>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", display: "block" }}>Messages</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: "#fff", letterSpacing: "-0.3px" }}>{stats.total}</span>
              </div>
            </div>
            {/* Unread */}
            <div style={{
              padding: "8px 12px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="10" height="8" rx="1.5" /><polyline points="1,4.5 6,7 11,4.5" />
              </svg>
              <div>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", display: "block" }}>Unread</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: "#fff", letterSpacing: "-0.3px" }}>{stats.unread}</span>
              </div>
            </div>
            {/* Status */}
            <div style={{
              padding: "8px 12px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5,7 4.5,10 10.5,3" />
              </svg>
              <div>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", display: "block" }}>Status</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "#fff" }}>Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Principal info card (inside dark) ─────────────────────────── */}
        <div style={{
          margin: "18px 0 20px",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16, padding: 13,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          {/* Avatar */}
          <div style={{
            width: 44, height: 44, borderRadius: 13,
            background: "rgba(59,91,219,0.3)",
            border: "1.5px solid rgba(59,91,219,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <SchoolIco />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: "#fff", letterSpacing: "-0.1px", margin: 0 }}>
              {principalName}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>
              School Administration
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4CC9A4" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{lastSeenStr}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            <IcoBtn>
              <path d="M2,3 C2,3 3,2 5,2.5 L6,4.5 C6,4.5 5.5,5 5,5.5 C5.5,6.5 6.5,7.5 7.5,8 C8,7.5 8.5,7 8.5,7 L10.5,8 C11,10 10,10 10,10 C8,11 2,7 2,3Z" />
            </IcoBtn>
            <IcoBtn>
              <circle cx="6.5" cy="3.5" r=".8" fill="rgba(255,255,255,0.65)" stroke="none" />
              <circle cx="6.5" cy="6.5" r=".8" fill="rgba(255,255,255,0.65)" stroke="none" />
              <circle cx="6.5" cy="9.5" r=".8" fill="rgba(255,255,255,0.65)" stroke="none" />
            </IcoBtn>
          </div>
        </div>
      </div>

      {/* ═══ STAT CARDS ══════════════════════════════════════════════════ */}
      <div style={{ display: "flex", gap: 8, padding: "14px 0 0" }}>
        <div style={{ flex: 1, background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13, padding: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1,8.5 L11,8.5 L9,5.5 L11,2.5 L1,2.5 L3,5.5 Z" />
            </svg>
            <span style={{ fontSize: 9, color: T.ink3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Messages</span>
          </div>
          <p style={{ fontSize: 20, fontWeight: 500, color: T.blue, letterSpacing: "-0.5px", margin: 0 }}>{stats.total}</p>
          <p style={{ fontSize: 9, color: T.ink3, marginTop: 2 }}>Total sent & received</p>
        </div>
        <div style={{ flex: 1, background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13, padding: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.grn2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1.5,6.5 4.5,10 10.5,3" />
            </svg>
            <span style={{ fontSize: 9, color: T.ink3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unread</span>
          </div>
          <p style={{ fontSize: 20, fontWeight: 500, color: T.grn2, letterSpacing: "-0.5px", margin: 0 }}>{stats.unread}</p>
          <p style={{ fontSize: 9, color: T.ink3, marginTop: 2 }}>{stats.unread === 0 ? "All messages read" : `${stats.unread} pending`}</p>
        </div>
      </div>

      {/* ═══ ENCRYPTED CHANNEL BANNER ════════════════════════════════════ */}
      <div style={{
        margin: "12px 0 0",
        background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 13,
        padding: "11px 13px",
        display: "flex", alignItems: "center", gap: 9,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: T.blBg,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1,8.5 L11,8.5 L9,5.5 L11,2.5 L1,2.5 L3,5.5 Z" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: T.ink1, margin: 0 }}>Encrypted channel</p>
          <p style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>Messages only visible to you and the principal</p>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.grn2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5,6.5 4.5,10 10.5,3" />
        </svg>
      </div>

      {/* ═══ CHAT AREA ═══════════════════════════════════════════════════ */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8"
        style={{
          background: T.chatBg,
          padding: "6px 12px 10px",
          marginTop: 12,
          minHeight: 280,
        }}
      >
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Loader2 style={{ width: 28, height: 28, color: T.ink3 }} className="animate-spin" />
          </div>
        ) : allMessages.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: "rgba(59,91,219,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <SchoolIco size={24} color={T.blue} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>No messages yet</p>
            <p style={{ fontSize: 11, color: T.ink3, textAlign: "center" }}>
              Messages from your principal will appear here
            </p>
          </div>
        ) : (
          groupedMessages.map(group => (
            <div key={group.date}>
              {/* Date chip */}
              <div style={{ textAlign: "center", margin: "8px 0 12px" }}>
                <span style={{
                  fontSize: 10, fontWeight: 500, color: T.ink3,
                  background: "rgba(142,148,164,0.13)",
                  padding: "4px 11px", borderRadius: 20,
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
                      display: "flex", flexDirection: "column", gap: 3,
                      marginBottom: 12,
                      alignItems: isTeacher ? "flex-end" : "flex-start",
                    }}
                  >
                    {/* Sender label for principal */}
                    {!isTeacher && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 9,
                          background: "rgba(103,65,217,0.12)",
                          border: "1px solid rgba(103,65,217,0.2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.pur} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1.5 10V6.5L6 4l4.5 2.5V10" /><circle cx="6" cy="5.5" r="1.5" />
                          </svg>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 500, color: T.ink3 }}>
                          {principalName}{n.from === "principal" ? " · Principal" : ""}
                        </span>
                      </div>
                    )}

                    {/* Bubble */}
                    <div style={{
                      maxWidth: "80%", padding: "10px 13px", borderRadius: 18,
                      background: isTeacher ? T.blue : T.white,
                      border: isTeacher ? "none" : `0.5px solid ${T.bdr}`,
                      borderBottomRightRadius: isTeacher ? 4 : 18,
                      borderBottomLeftRadius: isTeacher ? 18 : 4,
                    }}>
                      <p style={{
                        fontSize: 13, lineHeight: 1.5, margin: 0,
                        color: isTeacher ? "#fff" : T.ink1,
                        whiteSpace: "pre-wrap",
                      }}>
                        {n.message}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 5 }}>
                        <span style={{ fontSize: 9, color: isTeacher ? "rgba(255,255,255,0.55)" : T.ink3 }}>
                          {fmtTime(n.timestamp)}
                        </span>
                        {isTeacher && (
                          <svg width="13" height="9" viewBox="0 0 14 9" fill="none"
                            stroke={n.read ? "#4CC9A4" : "rgba(255,255,255,0.5)"}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          >
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

      {/* ═══ QUICK REPLY CHIPS ═══════════════════════════════════════════ */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8"
        style={{
          background: T.chatBg,
          padding: "0 12px 10px",
          display: "flex", gap: 7,
          overflowX: "auto",
        }}
      >
        {QUICK_REPLIES.map(qr => (
          <button
            key={qr}
            onClick={() => setMessageContent(qr)}
            style={{
              padding: "6px 12px", borderRadius: 20,
              border: `1px solid ${T.bdr}`, background: T.white,
              fontSize: 11, color: T.ink2,
              whiteSpace: "nowrap", cursor: "pointer",
              flexShrink: 0, fontFamily: "inherit",
            }}
          >
            {qr}
          </button>
        ))}
      </div>

      {/* ═══ CHAT INPUT BAR ══════════════════════════════════════════════ */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8"
        style={{
          background: T.white, borderTop: `1px solid ${T.bdr}`,
          padding: "10px 12px",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        {/* Emoji */}
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

        {/* Input */}
        <input
          value={messageContent}
          onChange={e => setMessageContent(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          placeholder="Reply to principal..."
          style={{
            flex: 1, padding: "9px 13px", borderRadius: 22,
            border: `1px solid ${T.bdr}`, background: T.s1,
            fontSize: 12, color: T.ink1, fontFamily: "inherit", outline: "none",
          }}
        />

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!messageContent.trim()}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: messageContent.trim() ? T.blue : T.s2,
            border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: messageContent.trim() ? "pointer" : "default",
            flexShrink: 0, transition: "background 0.15s",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
            stroke={messageContent.trim() ? "#fff" : T.ink3}
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
          >
            <line x1="2" y1="6.5" x2="11" y2="6.5" /><polyline points="8,3.5 11,6.5 8,9.5" />
          </svg>
        </button>
      </div>

    </div>
  );
};

// ── Date formatter (module-level) ─────────────────────────────────────────────
function fmtDate(ts: any) {
  const d     = ts?.toDate?.() || new Date();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default PrincipalNotes;