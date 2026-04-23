import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot,
  serverTimestamp, doc,
} from "firebase/firestore";
import { auditedAdd, auditedUpdate } from "../lib/auditedWrites";
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

interface PrincipalMessage {
  id: string;
  from?: "principal" | "teacher";
  principalId?: string;
  principalName?: string;
  teacherId?: string;
  message?: string;
  read?: boolean;
  timestamp?: { toDate?: () => Date; toMillis?: () => number };
}

// ── Main component ────────────────────────────────────────────────────────────
const PrincipalNotes = () => {
  const { teacherData } = useAuth();
  const [allMessages, setAllMessages]       = useState<PrincipalMessage[]>([]);
  const [loading, setLoading]               = useState(true);
  const [messageContent, setMessageContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Firebase listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    setLoading(true);
    // Scope by schoolId + teacherId for defense in depth.
    const unsub = onSnapshot(
      query(
        collection(db, "principal_to_teacher_notes"),
        where("schoolId", "==", teacherData.schoolId),
        where("teacherId", "==", teacherData.id),
      ),
      async snap => {
        const data = snap.docs.map(d => ({ ...d.data(), id: d.id } as PrincipalMessage));
        data.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
        setAllMessages(data);
        setLoading(false);
        // Auto-mark principal messages as read (fire-and-forget)
        for (const d of snap.docs) {
          const dd = d.data();
          if (dd.read === false && dd.from === "principal") {
            auditedUpdate(doc(db, "principal_to_teacher_notes", d.id), { read: true })
              .catch(e => console.warn("[PrincipalNotes] mark-read failed", e));
          }
        }
      },
      e => console.error("[PrincipalNotes] subscription failed", e),
    );
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Scroll to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages]);

  // ── Computed values ─────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:  allMessages.length,
    unread: allMessages.filter(m => m.read === false && m.from === "principal").length,
  }), [allMessages]);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: PrincipalMessage[] }[] = [];
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
      await auditedAdd(collection(db, "principal_to_teacher_notes"), {
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
    } catch (e) {
      console.error("[PrincipalNotes] send failed", e);
      toast.error("Failed to send.");
      setMessageContent(content);
    }
  };

  const fmtTime = (ts: unknown) =>
    new Date((ts as { toDate?: () => Date })?.toDate?.() || Date.now())
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const lastSeenStr = lastPrincipalMsg ? `Online · Last seen ${fmtTime(lastPrincipalMsg.timestamp)}` : "Offline";

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>

    {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
    <MobilePrincipalChat
      principalName={principalName}
      stats={stats}
      loading={loading}
      groupedMessages={groupedMessages}
      messageContent={messageContent}
      setMessageContent={setMessageContent}
      handleSend={handleSend}
      fmtTime={fmtTime}
      lastPrincipalMsg={lastPrincipalMsg}
    />

    {/* ═══════════════════ DESKTOP VIEW (unchanged) ═══════════════════ */}
    <div className="hidden md:block" style={{ minHeight: "100vh", background: T.bg, paddingBottom: 0 }}>

      {/* ═══ DARK HERO + PRINCIPAL CARD ═══════════════════════════════════ */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#162E93] md:bg-[#08090C]"
        style={{ padding: "0 22px 0" }}
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
          <button type="button"
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
        <button type="button"
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
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile chat view (iMessage-style) — does not touch desktop layout above
// ─────────────────────────────────────────────────────────────────────────────
interface MobilePrincipalChatProps {
  principalName: string;
  stats: { total: number; unread: number };
  loading: boolean;
  groupedMessages: { date: string; messages: PrincipalMessage[] }[];
  messageContent: string;
  setMessageContent: (v: string) => void;
  handleSend: () => void;
  fmtTime: (ts: unknown) => string;
  lastPrincipalMsg: PrincipalMessage | undefined;
}

const MobilePrincipalChat = ({
  principalName, stats, loading, groupedMessages,
  messageContent, setMessageContent, handleSend, fmtTime, lastPrincipalMsg,
}: MobilePrincipalChatProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [groupedMessages]);

  const online = !!lastPrincipalMsg;
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6"
      style={{
        background: "linear-gradient(180deg, #EEF4FF 0%, #E7EEFD 100%)",
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 56px - 88px)",
        minHeight: "calc(100vh - 56px - 88px)",
        fontVariantNumeric: "tabular-nums",
        position: "relative",
      }}
    >
      <style>{`
        @keyframes pnFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pnMsgIn { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes pnPulseOnline { 0%,100% { box-shadow: 0 0 0 0 rgba(0,200,83,.6); } 50% { box-shadow: 0 0 0 5px rgba(0,200,83,0); } }
        @keyframes pnPulseDot { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
        @keyframes pnTyping { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-4px); opacity: 1; } }
        .pn-pulse-online { animation: pnPulseOnline 2.4s ease-in-out infinite; }
        .pn-pulse-dot { animation: pnPulseDot 2s ease-in-out infinite; }
        .pn-msg { animation: pnMsgIn .35s cubic-bezier(.34,1.56,.64,1) both; }
        .pn-enter > * { animation: pnFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .pn-press { transition: transform .15s cubic-bezier(.34,1.56,.64,1); }
        .pn-press:active { transform: scale(.92); }
        .pn-scroll::-webkit-scrollbar { display: none; }
        .pn-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .pn-typing-dot { width: 7px; height: 7px; border-radius: 50%; background: #99AACC; animation: pnTyping 1.4s ease-in-out infinite; }
        .pn-typing-dot:nth-child(2) { animation-delay: .2s; }
        .pn-typing-dot:nth-child(3) { animation-delay: .4s; }
      `}</style>

      {/* Sticky chat header */}
      <div style={{
        background: "rgba(255,255,255,.88)",
        backdropFilter: "saturate(220%) blur(28px)",
        WebkitBackdropFilter: "saturate(220%) blur(28px)",
        padding: "8px 14px 12px",
        borderBottom: "0.5px solid rgba(9,87,247,.1)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        {/* Principal identity block */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 15,
            background: "linear-gradient(140deg, #7B3FF4, #9B5FFF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", flexShrink: 0, position: "relative",
            boxShadow: "0 1px 2px rgba(123,63,244,.2), 0 6px 14px rgba(123,63,244,.3), inset 0 1px 0 rgba(255,255,255,.2)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
            </svg>
            <span className={online ? "pn-pulse-online" : ""} style={{
              position: "absolute", bottom: -2, right: -2,
              width: 14, height: 14, borderRadius: "50%",
              background: online ? "#00C853" : "#99AACC",
              border: "2.5px solid #fff",
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#001040", letterSpacing: "-0.4px", lineHeight: 1.1 }}>{principalName}</div>
              <div style={{ width: 14, height: 14, background: "#0957F7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.15px", display: "flex", alignItems: "center", gap: 5 }}>
              {online && <span className="pn-pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "#00C853", boxShadow: "0 0 6px #00C853" }} />}
              <span>Principal · School Admin</span>
              <span style={{ color: "#99AACC" }}>·</span>
              <span>{online ? "Online" : "Offline"}</span>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 1, marginTop: 12, background: "rgba(9,87,247,.08)",
          borderRadius: 12, padding: 1, overflow: "hidden",
        }}>
          {[
            {
              label: "Messages", value: String(stats.total), color: "#0957F7",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
              valueColor: "#001040",
            },
            {
              label: "Unread", value: String(stats.unread), color: "#00C853",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
              valueColor: stats.unread === 0 ? "#00C853" : "#FF8800",
            },
            {
              label: "Secure", value: "E2E", color: "#7B3FF4",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
              valueColor: "#001040",
            },
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", padding: "9px 6px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <div style={{ width: 22, height: 22, borderRadius: 7, background: s.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.icon}</div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: "#5070B0", letterSpacing: "0.9px", textTransform: "uppercase", lineHeight: 1 }}>{s.label}</div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.3px", marginTop: 2, lineHeight: 1, color: s.valueColor }}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        className="pn-scroll"
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          padding: "12px 14px 16px",
          scrollBehavior: "smooth",
          minHeight: 0,
        }}
      >
        {/* Encrypted banner */}
        <div className="pn-msg" style={{
          background: "rgba(0,200,83,.08)",
          border: "0.5px solid rgba(0,200,83,.22)",
          borderRadius: 14, padding: "10px 12px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ width: 30, height: 30, borderRadius: 10, background: "#00C853", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,200,83,.15), 0 3px 8px rgba(0,200,83,.2)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#001040", letterSpacing: "-0.2px" }}>End-to-end encrypted</div>
            <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, marginTop: 1, letterSpacing: "-0.1px" }}>Only you and the principal can see these messages</div>
          </div>
          <div style={{ width: 22, height: 22, background: "#00C853", borderRadius: "50%", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 0 5px rgba(0,200,83,.1)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Loader2 style={{ width: 28, height: 28, color: "#5070B0" }} className="animate-spin" />
          </div>
        ) : groupedMessages.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 10 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: "linear-gradient(145deg, rgba(123,63,244,.14) 0%, rgba(155,95,255,.08) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#7B3FF4",
              boxShadow: "0 0 0 6px rgba(123,63,244,.05)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px" }}>No messages yet</div>
            <div style={{ fontSize: 11, color: "#5070B0", textAlign: "center", fontWeight: 500, maxWidth: 240 }}>
              Messages from your principal will appear here. Send the first note below.
            </div>
          </div>
        ) : (
          groupedMessages.map(group => (
            <div key={group.date}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", margin: "18px 0 14px" }}>
                <div style={{
                  background: "rgba(9,87,247,.1)", color: "#5070B0",
                  fontSize: 10, fontWeight: 800, padding: "5px 12px", borderRadius: 100,
                  letterSpacing: "0.3px", textTransform: "uppercase",
                }}>
                  {group.date}
                </div>
              </div>
              {group.messages.map((m, idx) => {
                const isTeacher = m.from === "teacher";
                const prevMsg = idx > 0 ? group.messages[idx - 1] : null;
                const showSender = !isTeacher && (!prevMsg || prevMsg.from !== m.from);
                return (
                  <div
                    key={m.id}
                    className="pn-msg"
                    style={{
                      display: "flex",
                      justifyContent: isTeacher ? "flex-end" : "flex-start",
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ maxWidth: "74%", display: "flex", flexDirection: "column" }}>
                      {showSender && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#5070B0", padding: "0 4px", marginBottom: 4, letterSpacing: "-0.1px" }}>
                          {m.principalName || principalName}
                        </div>
                      )}
                      <div style={{
                        background: isTeacher ? "linear-gradient(135deg, #4A85FF 0%, #0957F7 100%)" : "#fff",
                        color: isTeacher ? "#fff" : "#001040",
                        padding: "10px 14px",
                        borderRadius: isTeacher ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        fontSize: 14, fontWeight: 500, lineHeight: 1.4, letterSpacing: "-0.15px",
                        boxShadow: isTeacher
                          ? "0 0.5px 1px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.28)"
                          : "0 0.5px 1px rgba(9,87,247,.04), 0 2px 6px rgba(9,87,247,.06)",
                        wordWrap: "break-word",
                        whiteSpace: "pre-wrap",
                      }}>
                        {m.message}
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "4px 4px 0",
                        fontSize: 9.5, fontWeight: 600, color: "#99AACC",
                        justifyContent: isTeacher ? "flex-end" : "flex-start",
                        letterSpacing: "0.1px",
                      }}>
                        <span>{fmtTime(m.timestamp)}</span>
                        {isTeacher && (
                          <span style={{ display: "flex", alignItems: "center", color: m.read ? "#0957F7" : "#99AACC" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: -5 }}>
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Quick reply chips — toggled by + button */}
      {showQuickReplies && (
        <div
          className="pn-scroll"
          style={{
            display: "flex", gap: 7,
            padding: "8px 14px",
            overflowX: "auto",
            background: "rgba(255,255,255,.7)",
            borderTop: "0.5px solid rgba(9,87,247,.08)",
            animation: "pnFadeUp .3s cubic-bezier(.34,1.56,.64,1) both",
          }}
        >
          {QUICK_REPLIES.map(qr => (
            <button
              key={qr}
              type="button"
              onClick={() => { setMessageContent(qr); setShowQuickReplies(false); }}
              className="pn-press"
              style={{
                padding: "6px 12px", borderRadius: 100,
                background: "#fff",
                color: "#0957F7",
                fontSize: 12, fontWeight: 700, letterSpacing: "-0.1px",
                whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0,
                fontFamily: "inherit",
                border: "0.5px solid rgba(9,87,247,.15)",
                boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 2px 6px rgba(9,87,247,.08)",
              }}
            >
              {qr}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div style={{
        background: "rgba(255,255,255,.94)",
        backdropFilter: "saturate(220%) blur(28px)",
        WebkitBackdropFilter: "saturate(220%) blur(28px)",
        borderTop: "0.5px solid rgba(9,87,247,.1)",
        padding: "10px 12px 12px",
        display: "flex", alignItems: "flex-end", gap: 8,
        position: "sticky", bottom: 0,
      }}>
        <button
          type="button"
          onClick={() => setShowQuickReplies(v => !v)}
          aria-label="Quick replies"
          aria-pressed={showQuickReplies}
          className="pn-press"
          style={{
            width: 34, height: 34, borderRadius: "50%",
            background: showQuickReplies ? "rgba(9,87,247,.15)" : "#F4F7FE",
            color: "#0957F7",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, cursor: "pointer", border: "none",
            marginBottom: 3,
            transform: showQuickReplies ? "rotate(45deg)" : "none",
            transition: "transform .2s cubic-bezier(.34,1.56,.64,1), background .15s",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <div style={{
          flex: 1, background: "#F4F7FE",
          border: "0.5px solid rgba(9,87,247,.1)",
          borderRadius: 20,
          padding: "8px 12px 8px 14px",
          display: "flex", alignItems: "center", gap: 6,
          minHeight: 38,
        }}>
          <input
            value={messageContent}
            onChange={e => setMessageContent(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
            placeholder="Message…"
            style={{
              flex: 1, fontSize: 14, fontWeight: 500, color: "#001040",
              letterSpacing: "-0.2px", border: "none", outline: "none",
              background: "transparent", fontFamily: "inherit", padding: "4px 0",
              minWidth: 0,
            }}
          />
          <button
            type="button"
            aria-label="Emoji"
            className="pn-press"
            onClick={() => setMessageContent(messageContent + " 👍")}
            style={{
              width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
              color: "#99AACC", cursor: "pointer", flexShrink: 0, background: "none", border: "none",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!messageContent.trim()}
          aria-label="Send"
          className="pn-press"
          style={{
            width: 38, height: 38, borderRadius: "50%",
            background: messageContent.trim() ? "linear-gradient(135deg, #4A85FF 0%, #0957F7 100%)" : "#EAF0FB",
            color: messageContent.trim() ? "#fff" : "#99AACC",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, cursor: messageContent.trim() ? "pointer" : "not-allowed",
            border: "none",
            boxShadow: messageContent.trim() ? "0 1px 2px rgba(9,87,247,.2), 0 4px 12px rgba(9,87,247,.3)" : "none",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: -1, marginTop: -1 }}>
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

// ── Date formatter (module-level) ─────────────────────────────────────────────
function fmtDate(ts: unknown) {
  const d     = (ts as { toDate?: () => Date })?.toDate?.() || new Date();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default PrincipalNotes;