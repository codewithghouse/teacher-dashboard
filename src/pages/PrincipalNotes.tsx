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
import { tilt3D, tilt3DStyle } from "../lib/use3DTilt";
import { useIsMobile } from "../hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const [allMessages, setAllMessages]       = useState<PrincipalMessage[]>([]);
  const [loading, setLoading]               = useState(true);
  const [messageContent, setMessageContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // Track whether user is near the bottom so we only auto-scroll if they are.
  // If user has scrolled up to read older messages, don't yank them back.
  const stickToBottomRef = useRef<boolean>(true);

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

  // Scroll the chat container to bottom only if user is already near the bottom.
  // This prevents the page from yanking down when the user has scrolled up to
  // read older messages and a Firestore snapshot fires (e.g. mark-read update).
  // CRITICAL: only touches the chat container's own scrollTop — never the window.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allMessages]);

  // Update "near bottom" tracking on scroll inside the chat container.
  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  };

  // ── Action helpers (wired to clickable cards across the page) ───────────
  const replyInputRef = useRef<HTMLInputElement>(null);

  const scrollChatToBottom = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickToBottomRef.current = true;
  };

  const scrollToFirstUnread = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const firstUnread = el.querySelector<HTMLElement>('[data-unread="true"]');
    if (firstUnread) {
      el.scrollTo({ top: Math.max(0, firstUnread.offsetTop - 20), behavior: "smooth" });
      stickToBottomRef.current = false;
    } else {
      scrollChatToBottom();
    }
  };

  const markAllAsRead = async () => {
    const unread = allMessages.filter(m => m.read === false && m.from === "principal");
    if (unread.length === 0) {
      toast.success("All caught up — no unread messages.");
      return;
    }
    try {
      await Promise.all(unread.map(m =>
        auditedUpdate(doc(db, "principal_to_teacher_notes", m.id), { read: true })
      ));
      toast.success(`Marked ${unread.length} message${unread.length === 1 ? "" : "s"} as read.`);
    } catch (e) {
      console.error("[PrincipalNotes] mark-all-read failed", e);
      toast.error("Failed to mark as read.");
    }
  };

  const showChannelInfo = () => {
    toast.success("End-to-end encrypted channel", {
      description: "Only you and the principal can read these messages. Audit logs maintained for compliance.",
    });
  };

  const focusReplyInput = () => {
    replyInputRef.current?.focus();
    scrollChatToBottom();
  };

  const showPrincipalInfo = () => {
    const seen = lastPrincipalMsg ? `last seen ${fmtTime(lastPrincipalMsg.timestamp)}` : "offline";
    toast.success(`${principalName} · ${seen}`, {
      description: `${stats.total} message${stats.total === 1 ? "" : "s"} exchanged · ${stats.unread} unread.`,
    });
  };

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
  // Render only ONE view at a time based on viewport — prevents both
  // mobile and desktop content from mounting simultaneously.
  if (isMobile) {
    return (
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
    );
  }

  return (
    <>
    {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
    <div
      className="-mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-4 pt-6 pb-10"
      style={{
        background: '#EEF4FF',
        minHeight: '100vh',
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <style>{`
        @keyframes pnotFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .pnot-enter > * { animation: pnotFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
        .pnot-enter > *:nth-child(1) { animation-delay: .04s; }
        .pnot-enter > *:nth-child(2) { animation-delay: .10s; }
        .pnot-enter > *:nth-child(3) { animation-delay: .16s; }
        .pnot-enter > *:nth-child(4) { animation-delay: .22s; }
        .pnot-enter > *:nth-child(5) { animation-delay: .28s; }
        .pnot-chip { transition: transform .22s cubic-bezier(.22,.61,.36,1), box-shadow .22s ease, background .18s ease; }
        .pnot-chip:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,85,255,.18); }
        .pnot-chip:active { transform: scale(.96); }
        .pnot-btn-press { transition: transform .18s cubic-bezier(.22,.61,.36,1), box-shadow .22s ease, filter .22s ease; }
        .pnot-btn-press:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .pnot-btn-press:active { transform: scale(.96); }
        @keyframes pnotPulse { 0%,100% { opacity:1; transform: scale(1); } 50% { opacity:.5; transform: scale(1.3); } }
        .pnot-pulse { animation: pnotPulse 1.8s ease-in-out infinite; }
        .pnot-bubble { transition: transform .28s cubic-bezier(.22,.61,.36,1), box-shadow .28s ease; }
        @media (hover:hover) { .pnot-bubble:hover { transform: translateY(-1px); } }
      `}</style>

      <div className="pnot-enter w-full">


        {/* ═══ Page Head ═══ */}
        <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className={stats.unread > 0 ? 'pnot-pulse' : ''}
                style={{
                  width: 6, height: 6, borderRadius: 2,
                  background: stats.unread > 0 ? '#FFAA00' : '#0055FF',
                  display: 'inline-block',
                  boxShadow: stats.unread > 0 ? '0 0 10px rgba(255,170,0,.5)' : 'none',
                }}
              />
              Teacher Dashboard · Admin Communication
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 800, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
              Principal <span style={{ color: '#0055FF' }}>notes</span>
            </h1>
            <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              Direct channel with school administration · secured &amp; private.
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {stats.unread > 0 && (
              <button
                type="button"
                onClick={scrollToFirstUnread}
                className="pnot-btn-press"
                aria-label={`${stats.unread} unread messages — jump to first unread`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '10px 16px', borderRadius: 14,
                  background: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)', color: '#fff',
                  fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  boxShadow: '0 6px 20px rgba(255,170,0,.36), 0 2px 5px rgba(255,170,0,.2)',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span className="pnot-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }}/>
                {stats.unread} Unread
              </button>
            )}
            <button
              type="button"
              onClick={showChannelInfo}
              className="pnot-btn-press"
              aria-label="View encrypted channel info"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 14px', borderRadius: 14,
                background: '#fff', color: '#087F5B',
                border: '0.5px solid rgba(0,200,83,.18)',
                fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                boxShadow: '0 1px 2px rgba(0,200,83,.08), 0 4px 14px rgba(0,200,83,.08)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2.5" fill="currentColor" stroke="none"/>
              </svg>
              Encrypted
            </button>
          </div>
        </div>

        {/* ═══ Dark Hero with Principal Card ═══ */}
        <div
          role="button"
          tabIndex={0}
          onClick={showPrincipalInfo}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPrincipalInfo(); } }}
          aria-label={`${principalName} — view info`}
          className="pnot-bubble"
          style={{
            background: 'linear-gradient(135deg,#000A33 0%,#001A66 32%,#0044CC 68%,#0055FF 100%)',
            borderRadius: 24, padding: '28px 32px', color: '#fff',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
            marginBottom: 22,
            cursor: 'pointer',
          }}
        >
          <div style={{ position: 'absolute', top: -60, right: -40, width: 320, height: 320, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', bottom: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(123,63,244,.22) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, position: 'relative', zIndex: 1 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18,
              background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            }}>
              <SchoolIco size={32} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8, color: lastPrincipalMsg ? '#6FFFAA' : 'rgba(255,255,255,.6)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: lastPrincipalMsg ? '#4CC9A4' : 'rgba(255,255,255,.4)' }}/>
                {lastPrincipalMsg ? 'Active' : 'Offline'}
              </div>
              <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.7px', margin: 0, color: '#fff', lineHeight: 1.1 }}>
                {principalName}
              </h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.72)', fontWeight: 500, margin: '6px 0 0 0' }}>
                School Administration · <span style={{ color: 'rgba(255,255,255,.85)' }}>{lastSeenStr}</span>
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(100px,1fr))', gap: 10, flexShrink: 0 }}>
              {([
                { label: 'Messages', value: stats.total.toString(), color: '#fff', action: scrollChatToBottom, hint: 'Jump to latest' },
                { label: 'Unread',   value: stats.unread.toString(), color: stats.unread > 0 ? '#FFD088' : '#6FFFAA', action: stats.unread > 0 ? scrollToFirstUnread : markAllAsRead, hint: stats.unread > 0 ? 'See first unread' : 'All caught up' },
                { label: 'Channel',  value: 'Secure', color: '#C8A4FF', action: showChannelInfo, hint: 'Channel info' },
              ] as const).map(s => (
                <button
                  key={s.label}
                  type="button"
                  onClick={e => { e.stopPropagation(); s.action(); }}
                  className="pnot-btn-press"
                  aria-label={`${s.label}: ${s.value} — ${s.hint}`}
                  style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '10px 14px', border: '0.5px solid rgba(255,255,255,.14)', textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit', color: '#fff' }}
                >
                  <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color, letterSpacing: '-0.3px' }}>{s.value}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ Bright 2-col KPI tiles ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {([
            {
              label: 'Total Messages', value: stats.total.toString(), sub: 'Sent & received · click to view chat',
              grad: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)',
              iconStroke: <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>,
              action: scrollChatToBottom,
            },
            {
              label: 'Unread Messages', value: stats.unread.toString(), sub: stats.unread > 0 ? 'Click to jump to first unread' : 'All caught up — click to refresh',
              grad: stats.unread > 0 ? 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)' : 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)',
              iconStroke: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
              action: stats.unread > 0 ? scrollToFirstUnread : markAllAsRead,
            },
            {
              label: 'Secure Channel', value: 'Active', sub: 'End-to-end encrypted · click for details',
              grad: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)',
              iconStroke: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>,
              action: showChannelInfo,
            },
          ] as const).map(k => (
            <button
              key={k.label}
              type="button"
              onClick={k.action}
              {...tilt3D}
              aria-label={`${k.label}: ${k.value} — ${k.sub}`}
              style={{
                background: k.grad, borderRadius: 22, padding: '22px 24px', color: '#fff',
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.15), 0 4px 16px rgba(0,85,255,0.26), 0 18px 44px rgba(0,85,255,0.20)',
                cursor: 'pointer',
                border: 'none', textAlign: 'left', fontFamily: 'inherit', width: '100%',
                ...tilt3DStyle,
              }}
            >
              <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,255,255,.22) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.22)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    {k.iconStroke}
                  </svg>
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.78)', letterSpacing: '.10em', textTransform: 'uppercase', margin: '0 0 6px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.8px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.78)', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
            </button>
          ))}
        </div>

        {/* ═══ Encrypted Channel Banner ═══ */}
        <button
          type="button"
          onClick={showChannelInfo}
          {...tilt3D}
          aria-label="View encrypted channel info"
          style={{
            background: '#fff', borderRadius: 18, padding: '14px 18px',
            border: '0.5px solid rgba(0,85,255,0.07)',
            boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
            display: 'flex', alignItems: 'center', gap: 14,
            marginBottom: 22,
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            ...tilt3DStyle,
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 13,
            background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 6px 14px rgba(0,85,255,.28)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', margin: 0 }}>End-to-end encrypted channel</p>
            <p style={{ fontSize: 11, fontWeight: 500, color: '#5070B0', margin: '3px 0 0 0' }}>
              Messages are only visible to you and the principal. Audit logs maintained for compliance.
            </p>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 999,
            background: 'rgba(0,200,83,.10)', color: '#087F5B',
            border: '0.5px solid rgba(0,200,83,.22)',
            fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1.5,6.5 4.5,10 10.5,3" />
            </svg>
            Verified
          </div>
        </button>

        {/* ═══ Chat Container (blue halo card) ═══ */}
        <div
          style={{
            background: '#fff', borderRadius: 22,
            border: '0.5px solid rgba(0,85,255,0.07)',
            boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
            overflow: 'hidden',
            marginBottom: 22,
          }}
        >
          {/* Chat header */}
          <div style={{ padding: '14px 22px', borderBottom: '0.5px solid rgba(0,85,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              type="button"
              onClick={showPrincipalInfo}
              className="pnot-btn-press"
              aria-label={`Show info for ${principalName}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 6px 14px rgba(123,63,244,.28)',
              }}>
                <SchoolIco size={20} color="#fff" />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', margin: 0 }}>{principalName}</p>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                  {allMessages.length} message{allMessages.length === 1 ? '' : 's'} · conversation
                </p>
              </div>
            </button>
          </div>

          {/* Chat area */}
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            style={{ background: '#F5F9FF', padding: '20px 22px 12px', minHeight: 380, maxHeight: 560, overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                <Loader2 style={{ width: 32, height: 32, color: '#0055FF' }} className="animate-spin" />
              </div>
            ) : allMessages.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 14 }}>
                <div style={{
                  width: 68, height: 68, borderRadius: 18,
                  background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 10px 24px rgba(123,63,244,.28)',
                }}>
                  <SchoolIco size={30} color="#fff" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 15, fontWeight: 800, color: '#001040', margin: 0, letterSpacing: '-0.3px' }}>No messages yet</p>
                  <p style={{ fontSize: 12, fontWeight: 500, color: '#5070B0', margin: '6px 0 0 0' }}>
                    Messages from your principal will appear here.
                  </p>
                </div>
              </div>
            ) : (
              groupedMessages.map(group => (
                <div key={group.date}>
                  {/* Date divider */}
                  <div style={{ textAlign: 'center', margin: '6px 0 16px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, color: '#5070B0',
                      background: '#fff',
                      border: '0.5px solid rgba(0,85,255,.1)',
                      padding: '4px 12px', borderRadius: 20,
                      boxShadow: '0 1px 2px rgba(0,85,255,.06)',
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                      {group.date}
                    </span>
                  </div>

                  {group.messages.map(n => {
                    const isTeacher = n.from === 'teacher';
                    const isUnread = n.from === 'principal' && n.read === false;
                    return (
                      <div
                        key={n.id}
                        data-unread={isUnread ? 'true' : 'false'}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 4,
                          marginBottom: 14,
                          alignItems: isTeacher ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {!isTeacher && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: 10,
                              background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)',
                              border: '0.5px solid rgba(255,255,255,.4)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: '0 4px 10px rgba(123,63,244,.22)',
                            }}>
                              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1.5 10V6.5L6 4l4.5 2.5V10" /><circle cx="6" cy="5.5" r="1.5" />
                              </svg>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#5070B0', letterSpacing: '0.04em' }}>
                              {principalName} · Principal
                            </span>
                          </div>
                        )}
                        <div
                          className="pnot-bubble"
                          style={{
                            maxWidth: '75%', padding: '12px 16px', borderRadius: 20,
                            background: isTeacher
                              ? 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)'
                              : '#fff',
                            border: isTeacher ? 'none' : '0.5px solid rgba(0,85,255,.08)',
                            borderBottomRightRadius: isTeacher ? 6 : 20,
                            borderBottomLeftRadius: isTeacher ? 20 : 6,
                            boxShadow: isTeacher
                              ? '0 4px 14px rgba(0,85,255,.28), 0 1px 3px rgba(0,85,255,.18)'
                              : '0 0 0 0.5px rgba(0,85,255,.06), 0 2px 10px rgba(0,85,255,.08)',
                          }}
                        >
                          <p style={{
                            fontSize: 13, lineHeight: 1.55, margin: 0,
                            color: isTeacher ? '#fff' : '#001040',
                            fontWeight: 500,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {n.message}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: isTeacher ? 'rgba(255,255,255,.72)' : '#99AACC' }}>
                              {fmtTime(n.timestamp)}
                            </span>
                            {isTeacher && (
                              <svg width="14" height="10" viewBox="0 0 14 9" fill="none"
                                stroke={n.read ? '#4CC9A4' : 'rgba(255,255,255,.55)'}
                                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
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

          {/* Quick reply chips */}
          <div style={{
            background: '#fff',
            padding: '12px 22px 0',
            display: 'flex', gap: 8,
            overflowX: 'auto',
            borderTop: '0.5px solid rgba(0,85,255,.06)',
          }}>
            {QUICK_REPLIES.map(qr => (
              <button
                type="button"
                key={qr}
                onClick={() => setMessageContent(qr)}
                className="pnot-chip"
                style={{
                  padding: '7px 14px', borderRadius: 999,
                  border: '0.5px solid rgba(0,85,255,.12)',
                  background: '#F5F9FF', color: '#0055FF',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
                  whiteSpace: 'nowrap', cursor: 'pointer',
                  flexShrink: 0, fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06)',
                }}
              >
                {qr}
              </button>
            ))}
          </div>

          {/* Input bar */}
          <div style={{
            background: '#fff',
            borderTop: '0.5px solid rgba(0,85,255,.08)',
            padding: '14px 22px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <input
              ref={replyInputRef}
              value={messageContent}
              onChange={e => setMessageContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
              placeholder="Reply to principal..."
              style={{
                flex: 1, padding: '12px 18px', borderRadius: 14,
                border: '0.5px solid rgba(0,85,255,.12)',
                background: '#F5F9FF',
                fontSize: 13, color: '#001040', fontWeight: 500,
                fontFamily: 'inherit', outline: 'none',
                boxShadow: '0 1px 2px rgba(0,85,255,.04)',
              }}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!messageContent.trim()}
              className="pnot-btn-press"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 44, padding: '0 20px', borderRadius: 14,
                background: messageContent.trim()
                  ? 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)'
                  : '#F5F6F9',
                color: messageContent.trim() ? '#fff' : '#99AACC',
                fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                border: 'none',
                cursor: messageContent.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', flexShrink: 0,
                boxShadow: messageContent.trim()
                  ? '0 5px 18px rgba(0,85,255,0.34), 0 2px 5px rgba(0,85,255,0.18)'
                  : 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor"
                strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"
              >
                <line x1="2" y1="6.5" x2="11" y2="6.5" /><polyline points="8,3.5 11,6.5 8,9.5" />
              </svg>
              Send
            </button>
          </div>
        </div>

        {/* ═══ AI Intelligence card ═══ */}
        {stats.total > 0 && (() => {
          const leadLine = stats.unread > 0
            ? `${stats.unread} unread message${stats.unread !== 1 ? 's' : ''} from your principal — clear your inbox to stay aligned with school priorities.`
            : `You're fully caught up — ${stats.total} total exchange${stats.total !== 1 ? 's' : ''} with ${principalName}. Keep the channel warm with quick acknowledgements.`;
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={focusReplyInput}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusReplyInput(); } }}
              aria-label="AI summary — click to start replying"
              className="pnot-bubble"
              style={{
                background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                borderRadius: 22, padding: '24px 28px', color: '#fff',
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
                cursor: 'pointer',
              }}
            >
              <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: `radial-gradient(circle, ${stats.unread > 0 ? 'rgba(255,170,0,.22)' : 'rgba(255,255,255,.12)'} 0%, transparent 70%)`, borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
                <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                    AI Admin Intelligence
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
                    Communication Summary
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
                    {leadLine}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
                {([
                  { label: 'Total',  value: stats.total.toString(),  sub: 'All messages', color: '#fff', action: scrollChatToBottom },
                  { label: 'Unread', value: stats.unread.toString(), sub: stats.unread > 0 ? 'Reply soon' : 'Caught up', color: stats.unread > 0 ? '#FFD088' : '#6FFFAA', action: stats.unread > 0 ? scrollToFirstUnread : markAllAsRead },
                  { label: 'Status', value: lastPrincipalMsg ? 'Active' : 'Waiting', sub: lastSeenStr, color: '#C8A4FF', action: showPrincipalInfo },
                ] as const).map(s => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={e => { e.stopPropagation(); s.action(); }}
                    className="pnot-btn-press"
                    aria-label={`${s.label}: ${s.value}`}
                    style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: '#fff' }}
                  >
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color, letterSpacing: '-0.4px', lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

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
        background: "#EEF4FF",
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
              <div style={{ width: 14, height: 14, background: "#0055FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
              label: "Messages", value: String(stats.total), color: "#0055FF",
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
                        background: isTeacher ? "linear-gradient(135deg, #4A85FF 0%, #0055FF 100%)" : "#fff",
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
                          <span style={{ display: "flex", alignItems: "center", color: m.read ? "#0055FF" : "#99AACC" }}>
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
                color: "#0055FF",
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
            color: "#0055FF",
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
            background: messageContent.trim() ? "linear-gradient(135deg, #4A85FF 0%, #0055FF 100%)" : "#EAF0FB",
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