import { Bell, LogOut, Menu, MessageSquare, AlertTriangle, X, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { getInitials } from "../lib/initials";

interface HeaderProps {
  onMenuClick?: () => void;
}

// ── Unified notification item shape ─────────────────────────────────────────
type NotifKind = "parent_message" | "principal_message" | "risk";
interface NotifItem {
  id: string;
  kind: NotifKind;
  title: string;
  subtitle: string;
  timestamp: number; // ms epoch
  navigateTo: string;
}

// Resolve a Firestore timestamp-like field to ms epoch.
const tsMs = (v: any): number => {
  if (typeof v === "number") return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
};

// Human-friendly relative time.
const timeAgo = (ms: number): string => {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ms).toLocaleDateString();
};

const TeacherHeader = ({ onMenuClick }: HeaderProps) => {
  const { teacherData, user, logout } = useAuth();
  const navigate = useNavigate();
  const initials = getInitials(teacherData?.name || user?.displayName);

  // ── Notification source listeners ─────────────────────────────────────────
  const [parentMessages, setParentMessages] = useState<any[]>([]);
  const [principalMessages, setPrincipalMessages] = useState<any[]>([]);
  const [activeRisks, setActiveRisks] = useState<any[]>([]);

  // Parent messages — unread, from parent
  useEffect(() => {
    const tId = teacherData?.id;
    const schoolId = teacherData?.schoolId as string | undefined;
    if (!tId || !schoolId) { setParentMessages([]); return; }
    let cancelled = false;
    const q = query(
      collection(db, "parent_notes"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", tId),
      where("from", "==", "parent"),
      where("read", "==", false),
    );
    const unsub = onSnapshot(
      q,
      (snap) => { if (!cancelled) setParentMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      (err) => { if (!cancelled) console.warn("[TeacherHeader] parent_notes:", err); },
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // Principal-to-teacher messages — unread, from principal
  useEffect(() => {
    const tId = teacherData?.id;
    const schoolId = teacherData?.schoolId as string | undefined;
    if (!tId || !schoolId) { setPrincipalMessages([]); return; }
    let cancelled = false;
    const q = query(
      collection(db, "principal_to_teacher_notes"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", tId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        // Filter unread + from-principal client-side; the rules-allowed query
        // pulls all teacher's notes, then we filter for the panel.
        const unread = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(d => d.from === "principal" && d.read !== true);
        setPrincipalMessages(unread);
      },
      (err) => { if (!cancelled) console.warn("[TeacherHeader] principal_to_teacher_notes:", err); },
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // Risks — active (unresolved) for this teacher
  useEffect(() => {
    const tId = teacherData?.id;
    const schoolId = teacherData?.schoolId as string | undefined;
    if (!tId || !schoolId) { setActiveRisks([]); return; }
    let cancelled = false;
    const q = query(
      collection(db, "risks"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", tId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        // Filter unresolved client-side — covers writers that may not stamp
        // `resolved: false` on creation (would otherwise be excluded server-side).
        const open = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(d => d.resolved !== true);
        setActiveRisks(open);
      },
      (err) => { if (!cancelled) console.warn("[TeacherHeader] risks:", err); },
    );
    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId]);

  // ── Unified notifications list (sorted by recency) ────────────────────────
  const notifications = useMemo<NotifItem[]>(() => {
    const items: NotifItem[] = [
      ...parentMessages.map((m: any) => ({
        id: `p_${m.id}`,
        kind: "parent_message" as const,
        title: m.studentName || "Parent Message",
        subtitle: typeof m.content === "string" ? m.content : "New message from parent",
        timestamp: tsMs(m.createdAt) || tsMs(m.timestamp),
        navigateTo: "/parent-notes",
      })),
      ...principalMessages.map((m: any) => ({
        id: `pr_${m.id}`,
        kind: "principal_message" as const,
        title: "Principal Note",
        subtitle: typeof m.content === "string" ? m.content : (typeof m.message === "string" ? m.message : "New message from principal"),
        timestamp: tsMs(m.timestamp) || tsMs(m.createdAt),
        navigateTo: "/principal-notes",
      })),
      ...activeRisks.map((r: any) => ({
        id: `r_${r.id}`,
        kind: "risk" as const,
        title: r.studentName || r.title || "Risk Alert",
        subtitle: r.detail || r.summary || r.reason || r.description || "Open risk for this student",
        timestamp: tsMs(r.updatedAt) || tsMs(r.createdAt) || tsMs(r.timestamp),
        navigateTo: "/risks-alerts",
      })),
    ];
    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  }, [parentMessages, principalMessages, activeRisks]);

  const totalCount = parentMessages.length + principalMessages.length + activeRisks.length;

  // ── Panel state + outside-click close ─────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  // Esc key closes the panel
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanelOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  return (
    <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 sticky top-0 z-50">
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          type="button"
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-slate-500" />
        </button>

        <img
          src="/edullent-icon.png"
          alt="Edullent"
          className="w-9 h-9 rounded-lg object-contain shrink-0"
          draggable={false}
        />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-[#1e3272] uppercase leading-tight truncate max-w-[120px] sm:max-w-none">
            {teacherData?.schoolName || "EDULLENT"}
          </span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">
            {teacherData?.subject || "Teacher"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        <div className="relative" ref={panelRef}>
          <button
            type="button"
            onClick={() => setPanelOpen(p => !p)}
            className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
            aria-label={totalCount > 0 ? `${totalCount} new notification${totalCount === 1 ? "" : "s"}` : "Notifications"}
            aria-expanded={panelOpen}
            aria-haspopup="true"
          >
            <Bell className="w-5 h-5 text-slate-500" />
            {totalCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[4px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center"
                style={{ border: "2px solid white" }}
                aria-hidden="true"
              >
                {totalCount > 9 ? "9+" : totalCount}
              </span>
            )}
          </button>

          {/* Unified notification popup */}
          {panelOpen && (
            <div
              className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-[380px] max-w-[420px] rounded-2xl overflow-hidden bg-white"
              style={{
                border: "0.5px solid rgba(0,85,255,0.12)",
                boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.10), 0 18px 44px rgba(0,85,255,0.18)",
                zIndex: 60,
              }}
              role="dialog"
              aria-label="Notifications"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100" style={{ background: "#EEF4FF" }}>
                <div>
                  <p className="text-[14px] font-bold text-[#001040] tracking-tight">Notifications</p>
                  <p className="text-[11px] font-medium text-[#5070B0] mt-0.5">
                    {totalCount === 0 ? "All caught up" : `${totalCount} new · messages, alerts & risks`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center bg-white hover:bg-slate-100 transition-colors"
                  style={{ border: "0.5px solid rgba(0,85,255,0.12)" }}
                  aria-label="Close notifications"
                >
                  <X size={13} className="text-slate-500" />
                </button>
              </div>

              {/* List */}
              <div className="max-h-[60vh] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center px-6">
                    <div
                      className="w-14 h-14 rounded-full inline-flex items-center justify-center mb-3"
                      style={{ background: "rgba(0,85,255,0.06)" }}
                    >
                      <Bell className="w-6 h-6 text-[#0055FF]" />
                    </div>
                    <p className="text-[13px] font-bold text-[#001040]">No new notifications</p>
                    <p className="text-[11px] text-[#5070B0] mt-1">Parent messages, principal notes, and student risks will appear here.</p>
                  </div>
                ) : (
                  notifications.map((n, idx) => {
                    const isParent = n.kind === "parent_message";
                    const isPrincipal = n.kind === "principal_message";
                    const isRisk = n.kind === "risk";
                    const Icon = isRisk ? AlertTriangle : isPrincipal ? ShieldAlert : MessageSquare;
                    const iconBg = isRisk ? "linear-gradient(135deg, #FF3355, #DC2626)"
                      : isPrincipal ? "linear-gradient(135deg, #6B21E8, #8B5CF6)"
                      : "linear-gradient(135deg, #0055FF, #1166FF)";
                    const iconShadow = isRisk ? "0 2px 8px rgba(255,51,85,0.28)"
                      : isPrincipal ? "0 2px 8px rgba(107,33,232,0.28)"
                      : "0 2px 8px rgba(0,85,255,0.28)";
                    const chipBg = isRisk ? "rgba(255,51,85,0.10)"
                      : isPrincipal ? "rgba(107,33,232,0.10)"
                      : "rgba(0,85,255,0.10)";
                    const chipColor = isRisk ? "#C92A2A"
                      : isPrincipal ? "#5B1FB6"
                      : "#0055FF";
                    const chipLabel = isRisk ? "Risk" : isPrincipal ? "Principal" : "Parent";
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => { setPanelOpen(false); navigate(n.navigateTo); }}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#F4F7FE] transition-colors ${idx < notifications.length - 1 ? "border-b border-slate-100" : ""}`}
                      >
                        <div
                          className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
                          style={{ background: iconBg, boxShadow: iconShadow }}
                        >
                          <Icon size={15} color="#fff" strokeWidth={2.4} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-[13px] font-bold text-[#001040] truncate">{n.title}</p>
                            <span
                              className="text-[9px] font-bold px-[6px] py-[1px] rounded-full flex-shrink-0"
                              style={{ background: chipBg, color: chipColor, letterSpacing: "0.3px" }}
                            >
                              {chipLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#5070B0] truncate">{n.subtitle}</p>
                          {n.timestamp > 0 && (
                            <p className="text-[10px] text-[#99AACC] mt-0.5">{timeAgo(n.timestamp)}</p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="border-t border-slate-100 bg-white">
                  <button
                    type="button"
                    onClick={() => { setPanelOpen(false); navigate("/risks-alerts"); }}
                    className="w-full px-4 py-3 text-[12px] font-bold text-[#0055FF] hover:bg-[#EEF4FF] transition-colors"
                  >
                    View all notifications ›
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-8 w-[1px] bg-slate-200 mx-1 hidden sm:block" />
        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-bold text-slate-900 leading-none">
              {teacherData?.name || user?.displayName || "Teacher"}
            </span>
            <span className="text-[10px] font-medium text-slate-500 uppercase">
              {teacherData?.subject || "Teacher"}
            </span>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#1e3272] flex items-center justify-center text-white text-sm font-semibold shadow-md shrink-0">
            {initials}
          </div>
          <button
            onClick={logout}
            type="button"
            className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TeacherHeader;
