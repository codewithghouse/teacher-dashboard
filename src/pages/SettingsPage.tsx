import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { doc, serverTimestamp } from "firebase/firestore";
import { auditedUpdate } from "../lib/auditedWrites";
import { getInitials } from "../lib/initials";
import { toast } from "sonner";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  hero:  "#08090C",
  bg:    "#F5F6F9",
  white: "#ffffff",
  ink1:  "#08090C",
  ink2:  "#42475A",
  ink3:  "#8C92A4",
  s1:    "#F5F6F9",
  s2:    "#ECEEF4",
  bdr:   "#E2E5EE",
  blue:  "#3B5BDB",
  blBg:  "#EDF2FF",
  blBdr: "#BAC8FF",
  grn:   "#087F5B",
  glBg:  "#EBFBEE",
  red:   "#C92A2A",
  rlBg:  "#FFF5F5",
  rlBdr: "#FFC9C9",
  amb:   "#C87014",
  alBg:  "#FFF9DB",
  tea:   "#0C8599",
  tlBg:  "#E3FAFC",
};

interface NotificationSettings {
  assignments: boolean;
  grading: boolean;
  attendance: boolean;
  messages: boolean;
  risks: boolean;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputS: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 11,
  border: `1px solid ${T.bdr}`, background: T.s1,
  fontSize: 13, color: T.ink1, fontFamily: "inherit", outline: "none",
};
const selectS: React.CSSProperties = {
  ...inputS, appearance: "none" as const, cursor: "pointer", paddingRight: 30,
};
const labelS: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  fontSize: 9, fontWeight: 500, color: T.ink3,
  letterSpacing: "0.07em", textTransform: "uppercase" as const,
  marginBottom: 7,
};
const chevDown = (
  <svg style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }}
    width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round">
    <polyline points="2,4 6,8 10,4" />
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────
const SettingsPage = () => {
  const { teacherData, logout } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({ name: "", email: "", phone: "", subject: "" });

  const [notifications, setNotifications] = useState<NotificationSettings>({
    assignments: true, grading: true, attendance: true, messages: true, risks: true,
  });

  const [preferences, setPreferences] = useState({
    defaultView: "Grid", gradeScale: "Percentage", dateFormat: "DD/MM/YYYY", language: "English",
  });

  useEffect(() => {
    if (teacherData) {
      setFormData({
        name: teacherData.name || "",
        email: teacherData.email || "",
        phone: teacherData.phone || "",
        subject: teacherData.subject || "",
      });
      // Only merge persisted notification keys we know about — if Firestore
      // contains legacy or unexpected fields, defaults win for any missing key.
      if (teacherData.notifications && typeof teacherData.notifications === "object") {
        const n = teacherData.notifications as Partial<NotificationSettings>;
        setNotifications(prev => ({
          assignments: typeof n.assignments === "boolean" ? n.assignments : prev.assignments,
          grading:     typeof n.grading     === "boolean" ? n.grading     : prev.grading,
          attendance:  typeof n.attendance  === "boolean" ? n.attendance  : prev.attendance,
          messages:    typeof n.messages    === "boolean" ? n.messages    : prev.messages,
          risks:       typeof n.risks       === "boolean" ? n.risks       : prev.risks,
        }));
      }
      if (teacherData.preferences && typeof teacherData.preferences === "object") {
        const p = teacherData.preferences as Partial<typeof preferences>;
        setPreferences(prev => ({
          defaultView: typeof p.defaultView === "string" ? p.defaultView : prev.defaultView,
          gradeScale:  typeof p.gradeScale  === "string" ? p.gradeScale  : prev.gradeScale,
          dateFormat:  typeof p.dateFormat  === "string" ? p.dateFormat  : prev.dateFormat,
          language:    typeof p.language    === "string" ? p.language    : prev.language,
        }));
      }
    }

  }, [teacherData]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!teacherData?.id) return;
    setIsSaving(true);
    try {
      await auditedUpdate(doc(db, "teachers", teacherData.id), {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        notifications, preferences,
        updatedAt: serverTimestamp(),
      });
      toast.success("Settings saved.");
    } catch (e) {
      console.error("[SettingsPage] save failed", e);
      toast.error("Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (!teacherData) return;
    setFormData({ name: teacherData.name || "", email: teacherData.email || "", phone: teacherData.phone || "", subject: teacherData.subject || "" });
    setNotifications({ assignments: true, grading: true, attendance: true, messages: true, risks: true });
    toast.info("Form reset.");
  };

  const toggleNotif = (key: keyof NotificationSettings) =>
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));

  const allNotifsOn = Object.values(notifications).every(Boolean);

  const toggleAllNotifs = () => {
    const newVal = !allNotifsOn;
    setNotifications({ assignments: newVal, grading: newVal, attendance: newVal, messages: newVal, risks: newVal });
  };

  const initials = getInitials(formData.name);

  // 3D tilt handlers (cursor-following — smooth/buttery vibe)
  const handle3DEnter = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.4s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.4s cubic-bezier(0.2,0.8,0.2,1)";
  };
  const handle3DMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.4s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.4s cubic-bezier(0.2,0.8,0.2,1)";
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotX = (((y / rect.height) - 0.5) * -6).toFixed(2);
    const rotY = (((x / rect.width) - 0.5) * 6).toFixed(2);
    el.style.transform = `perspective(1200px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-5px) scale(1.012)`;
  };
  const handle3DLeave = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = "transform 0.6s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.6s cubic-bezier(0.2,0.8,0.2,1)";
    el.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)";
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>

    {/* ═══════════════════ MOBILE VIEW (new mockup) ═══════════════════ */}
    <MobileSettings
      initials={initials}
      formData={formData}
      setFormData={setFormData}
      notifications={notifications}
      toggleNotif={toggleNotif}
      allNotifsOn={allNotifsOn}
      toggleAllNotifs={toggleAllNotifs}
      preferences={preferences}
      setPreferences={setPreferences}
      isSaving={isSaving}
      onSave={handleSave}
      onReset={handleReset}
      onLogout={logout}
    />

    {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
    <div
      className="hidden md:block -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-4 pt-6 pb-10"
      style={{
        minHeight: "100vh",
        background: "#EEF4FF",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <style>{`
        @keyframes setsFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .sets-enter > * { animation: setsFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
        .sets-enter > *:nth-child(1) { animation-delay: .04s; }
        .sets-enter > *:nth-child(2) { animation-delay: .10s; }
        .sets-enter > *:nth-child(3) { animation-delay: .16s; }
        .sets-enter > *:nth-child(4) { animation-delay: .22s; }
        .sets-enter > *:nth-child(5) { animation-delay: .28s; }
        .sets-enter > *:nth-child(6) { animation-delay: .34s; }
        .sets-btn-press { transition: transform .2s cubic-bezier(.22,.61,.36,1), box-shadow .22s ease, filter .22s ease; }
        .sets-btn-press:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .sets-btn-press:active { transform: scale(.96); }
      `}</style>

      <div className="sets-enter w-full">

        {/* ═══ Page Head ═══ */}
        <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: '#0055FF', display: 'inline-block' }}/>
              Teacher Dashboard · Preferences
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 800, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
              Settings
            </h1>
            <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              Manage your profile, notifications, and teaching preferences.
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleReset}
              className="sets-btn-press"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 44, padding: '0 18px', borderRadius: 14,
                background: '#fff', color: '#5070B0',
                border: '0.5px solid rgba(0,85,255,.12)',
                fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 14px rgba(0,85,255,.08)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11,5 A5,5 0 1,1 8.5,1.5" /><polyline points="8.5,0 8.5,2 10.5,2" />
              </svg>
              Reset
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="sets-btn-press"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 44, padding: '0 22px', borderRadius: 14,
                background: isSaving ? '#F5F6F9' : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)',
                color: isSaving ? '#99AACC' : '#fff',
                fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                border: 'none',
                cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: isSaving ? 'none' : '0 5px 18px rgba(0,85,255,0.34), 0 2px 5px rgba(0,85,255,0.18)',
              }}
            >
              {isSaving ? (
                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1.5,6.5 4.5,10 10.5,2.5" />
                </svg>
              )}
              {isSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>

        {/* ═══ Dark Hero Banner ═══ */}
        <div
          onMouseEnter={handle3DEnter}
          onMouseMove={handle3DMove}
          onMouseLeave={handle3DLeave}
          style={{
            background: 'linear-gradient(135deg,#000A33 0%,#001A66 32%,#0044CC 68%,#0055FF 100%)',
            borderRadius: 24, padding: '28px 32px', color: '#fff',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
            marginBottom: 22,
            transformStyle: 'preserve-3d',
            willChange: 'transform',
          }}
        >
          <div style={{ position: 'absolute', top: -60, right: -40, width: 320, height: 320, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', bottom: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(123,63,244,.22) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18,
              background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 800, color: '#fff',
              flexShrink: 0, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, color: '#6FFFAA' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4CC9A4' }}/>
                Active Profile
              </div>
              <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.8px', margin: 0, color: '#fff', lineHeight: 1.05 }}>
                {formData.name || "Teacher"}
              </h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.78)', fontWeight: 500, margin: '6px 0 0 0' }}>
                {formData.email} {formData.subject ? `· ${formData.subject}` : ''}
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(110px,1fr))', gap: 10 }}>
              {[
                { label: 'Notifications', value: `${Object.values(notifications).filter(Boolean).length}/5`, color: Object.values(notifications).filter(Boolean).length === 5 ? '#6FFFAA' : '#FFD088' },
                { label: 'Language', value: preferences.language.slice(0, 8), color: '#fff' },
                { label: 'Format', value: preferences.dateFormat.slice(0, 10), color: '#C8A4FF' },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '10px 14px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: s.color, letterSpacing: '-0.3px' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── PROFILE ──────────────────────────────────────────────────── */}
        <SectionCard title="Profile" iconBg={T.blBg} iconColor={T.blue}
          icon={<><circle cx="6.5" cy="4.5" r="2.5" /><path d="M1.5 11.5s1-3 5-3 5 3 5 3" /></>}
          right={<span style={{ fontSize: 10, color: T.blue, fontWeight: 500, cursor: "pointer" }}>Edit photo</span>}
        >
          {/* Avatar row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderBottom: `1px solid ${T.s2}` }}>
            <div style={{
              width: 56, height: 56, borderRadius: 17,
              background: T.blBg, border: `2px solid ${T.blBdr}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17, fontWeight: 500, color: T.blue, flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 500, color: T.ink1, margin: 0 }}>{formData.name || "Teacher"}</p>
              <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{formData.email}</p>
            </div>
            <button type="button" style={{
              padding: "7px 12px", borderRadius: 10,
              border: `1px solid ${T.bdr}`, background: T.s1,
              fontSize: 11, fontWeight: 500, color: T.blue,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              Edit
            </button>
          </div>

          {/* Name */}
          <FormRow label="Name" icon={<><circle cx="6" cy="4" r="2.5" /><path d="M1.5 10.5s1-3 4.5-3 4.5 3 4.5 3" /></>}>
            <input style={inputS} value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Your name" />
          </FormRow>

          {/* Email */}
          <FormRow label="Email" icon={<><rect x="1" y="2.5" width="10" height="7" rx="1.5" /><polyline points="1,4.5 6,7 11,4.5" /></>}>
            <input style={{ ...inputS, color: T.ink3, cursor: "not-allowed" }} value={formData.email} disabled />
            <Hint text="Managed by school admin" />
          </FormRow>

          {/* Phone */}
          <FormRow label="Phone" icon={<path d="M2,3 C2,3 3,2 4.5,2.5 L5.5,4.5 C5.5,4.5 5,5 4.5,5.5 C5,6.5 6,7.5 7,8 C7.5,7.5 8,7 8,7 L10,8 C10.5,10 9.5,10 9.5,10 C7.5,11 2,7 2,3Z" />}>
            <input style={inputS} value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="Phone number" />
          </FormRow>

          {/* Subject */}
          <FormRow label="Subject" icon={<><rect x="1.5" y="1" width="9" height="10" rx="1.5" /><line x1="3.5" y1="4.5" x2="8.5" y2="4.5" /><line x1="3.5" y1="7" x2="6.5" y2="7" /></>} last>
            <input style={{ ...inputS, color: T.ink3, cursor: "not-allowed" }} value={formData.subject} disabled />
            <Hint text="Set by school admin" />
          </FormRow>
        </SectionCard>

        {/* ── NOTIFICATIONS ────────────────────────────────────────────── */}
        <SectionCard title="Notifications" iconBg={T.alBg} iconColor={T.amb}
          icon={<><path d="M6.5 1.5C4.5 1.5 3 3 3 5v3l-1.5 2H11L9.5 8V5C9.5 3 8 1.5 6.5 1.5z" /><line x1="5.5" y1="11" x2="7.5" y2="11" /></>}
          right={
            <span onClick={toggleAllNotifs} style={{ fontSize: 10, color: T.blue, fontWeight: 500, cursor: "pointer" }}>
              {allNotifsOn ? "Disable all" : "Enable all"}
            </span>
          }
        >
          {([
            { key: "assignments" as const, title: "Assignments", sub: "Submission alerts" },
            { key: "grading" as const,     title: "Grading",     sub: "Deadline reminders" },
            { key: "attendance" as const,  title: "Attendance",  sub: "Threshold warnings" },
            { key: "messages" as const,    title: "Messages",    sub: "New parent messages" },
            { key: "risks" as const,       title: "Risks & alerts", sub: "Performance concerns" },
          ]).map((item, i, arr) => (
            <ToggleRow key={item.key} title={item.title} sub={item.sub}
              active={notifications[item.key]}
              onClick={() => toggleNotif(item.key)}
              last={i === arr.length - 1}
            />
          ))}
        </SectionCard>

        {/* ── PREFERENCES ──────────────────────────────────────────────── */}
        <SectionCard title="Preferences" iconBg={T.tlBg} iconColor={T.tea}
          icon={<><circle cx="6.5" cy="6.5" r="5" /><circle cx="6.5" cy="6.5" r="2" /><line x1="6.5" y1="1.5" x2="6.5" y2="4.5" /><line x1="6.5" y1="8.5" x2="6.5" y2="11.5" /><line x1="1.5" y1="6.5" x2="4.5" y2="6.5" /><line x1="8.5" y1="6.5" x2="11.5" y2="6.5" /></>}
        >
          <SelectRow label="Dashboard view" value={preferences.defaultView} options={["Grid", "List", "Compact"]}
            onChange={v => setPreferences({ ...preferences, defaultView: v })}
            icon={<><rect x="1" y="1.5" width="10" height="9.5" rx="1.5" /><line x1="3.5" y1="5" x2="8.5" y2="5" /><line x1="3.5" y1="7.5" x2="6.5" y2="7.5" /></>} />
          <SelectRow label="Grade metric" value={preferences.gradeScale} options={["Percentage", "Grade (A–F)", "Points"]}
            onChange={v => setPreferences({ ...preferences, gradeScale: v })}
            icon={<><polyline points="1.5,9 4.5,5.5 7,7.5 10.5,3.5" /><polyline points="9,3.5 10.5,3.5 10.5,5" /></>} />
          <SelectRow label="Date format" value={preferences.dateFormat} options={["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]}
            onChange={v => setPreferences({ ...preferences, dateFormat: v })}
            icon={<><rect x="1.5" y="2" width="9" height="8.5" rx="1.5" /><line x1="4" y1="1" x2="4" y2="3.5" /><line x1="8" y1="1" x2="8" y2="3.5" /><line x1="1.5" y1="5.5" x2="10.5" y2="5.5" /></>} />
          <SelectRow label="Language" value={preferences.language} options={["English", "Hindi", "Urdu"]}
            onChange={v => setPreferences({ ...preferences, language: v })}
            icon={<><circle cx="6" cy="6" r="4.5" /><circle cx="6" cy="6" r="1.5" /></>} last />
        </SectionCard>

        {/* ── SECURITY ─────────────────────────────────────────────────── */}
        <SectionCard title="Security" iconBg={T.blBg} iconColor={T.blue}
          icon={<><path d="M6.5 1.5L11 3.5V7C11 9.5 6.5 11.5 6.5 11.5S2 9.5 2 7V3.5L6.5 1.5z" /><polyline points="4.5,6.5 6,8 8.5,5" /></>}
          right={<span style={{ fontSize: 10, fontWeight: 500, background: T.glBg, color: T.grn, padding: "3px 8px", borderRadius: 20 }}>Secured</span>}
        >
          {/* Info banner */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 14, margin: "8px", borderRadius: 13, background: T.s1, border: `1px solid ${T.bdr}` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M7 1.5L12 3.5V7C12 10 7 12 7 12S2 10 2 7V3.5L7 1.5z" /><polyline points="5,7 6.5,8.5 9.5,5" />
            </svg>
            <div>
              <p style={{ fontSize: 12, fontWeight: 500, color: T.ink1, margin: 0 }}>Security</p>
              <p style={{ fontSize: 10, color: T.ink3, marginTop: 2, lineHeight: 1.4 }}>Account credentials are managed by your school administrator. Contact admin to change password.</p>
            </div>
          </div>
          <ToggleRow title="Two-factor auth" sub="Extra login protection" active={false} onClick={() => {}} />
          <ToggleRow title="Login notifications" sub="Alert on new device login" active={true} onClick={() => {}} last />
        </SectionCard>

        {/* ── DANGER ZONE ──────────────────────────────────────────────── */}
        <div className="sets-card3d" style={{
          background: T.white,
          border: "0.5px solid rgba(0,85,255,0.07)",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: T.rlBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={T.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 1.5L12 11.5H1L6.5 1.5z" /><line x1="6.5" y1="5" x2="6.5" y2="8" />
                <circle cx="6.5" cy="9.5" r=".6" fill={T.red} stroke="none" />
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: T.red }}>Danger zone</span>
          </div>

          <DangerRow title="Clear all data" sub="Remove local cache and preferences"
            onClick={() => { localStorage.clear(); toast.success("Local data cleared."); }} />

          <DangerRow title="Sign out" sub="Log out of your account" last
            onClick={() => { if (confirm("Sign out?")) logout(); }} />
        </div>

        <div style={{ height: 8 }} />
      </div>

      {/* ═══ AI Intelligence card ═══ */}
      <div
        onMouseEnter={handle3DEnter}
        onMouseMove={handle3DMove}
        onMouseLeave={handle3DLeave}
        style={{
          background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
          borderRadius: 22, padding: '24px 28px', color: '#fff',
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)',
          marginTop: 14,
          transformStyle: 'preserve-3d',
          willChange: 'transform',
        }}
      >
        <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              AI Settings Intelligence
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
              Profile &amp; Preferences Summary
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
              {allNotifsOn ? (
                <>All 5 notification channels are active — you'll stay on top of every student update.</>
              ) : Object.values(notifications).some(Boolean) ? (
                <><b style={{ color: '#fff', fontWeight: 700 }}>{Object.values(notifications).filter(Boolean).length} of 5</b> notification channels enabled. Consider turning on the rest to catch every alert.</>
              ) : (
                <>All notifications are off — you may miss key student and admin updates.</>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
          {[
            { label: 'Notifications', value: `${Object.values(notifications).filter(Boolean).length}/5`, sub: allNotifsOn ? 'All active' : 'Partial', color: allNotifsOn ? '#6FFFAA' : '#FFD088' },
            { label: 'Display', value: preferences.defaultView, sub: 'Dashboard view', color: '#C8A4FF' },
            { label: 'Locale', value: preferences.language, sub: preferences.dateFormat, color: '#fff' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color, letterSpacing: '-0.4px', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      </div>
    </div>
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only Settings view (new mockup design)
// ─────────────────────────────────────────────────────────────────────────────
interface MobileSettingsProps {
  initials: string;
  formData: { name: string; email: string; phone: string; subject: string };
  setFormData: React.Dispatch<React.SetStateAction<{ name: string; email: string; phone: string; subject: string }>>;
  notifications: NotificationSettings;
  toggleNotif: (key: keyof NotificationSettings) => void;
  allNotifsOn: boolean;
  toggleAllNotifs: () => void;
  preferences: { defaultView: string; gradeScale: string; dateFormat: string; language: string };
  setPreferences: React.Dispatch<React.SetStateAction<{ defaultView: string; gradeScale: string; dateFormat: string; language: string }>>;
  isSaving: boolean;
  onSave: () => void;
  onReset: () => void;
  onLogout: () => void;
}

const MobileSettings = ({
  initials, formData, setFormData,
  notifications, toggleNotif, allNotifsOn, toggleAllNotifs,
  preferences, setPreferences,
  isSaving, onSave, onReset, onLogout,
}: MobileSettingsProps) => {
  const [twoFactor, setTwoFactor] = useState(false);
  const [loginNotifs, setLoginNotifs] = useState(true);

  const editName = () => {
    const v = prompt("Enter your name:", formData.name);
    if (v !== null) setFormData(prev => ({ ...prev, name: v.trim() }));
  };
  const editPhone = () => {
    const v = prompt("Enter your phone:", formData.phone);
    if (v !== null) setFormData(prev => ({ ...prev, phone: v.trim() }));
  };

  const cyclePref = <K extends keyof typeof preferences>(key: K, options: string[]) => {
    const cur = preferences[key];
    const idx = options.indexOf(cur);
    const next = options[(idx + 1) % options.length];
    setPreferences(prev => ({ ...prev, [key]: next }));
  };

  return (
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
        paddingBottom: 90,
      }}
    >
      <style>{`
        .st-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .st-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(0,85,255,.08), 0 24px 44px rgba(0,85,255,.18), 0 8px 16px rgba(0,85,255,.1); } }
        .st-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(0,85,255,.1), 0 6px 16px rgba(0,85,255,.14); }
        .st-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
        .st-press:active { transform: scale(.94); }
        @keyframes stFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes stPulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
        .st-pulse { animation: stPulse 1.6s ease-in-out infinite; }
        .st-enter > * { animation: stFadeUp .45s cubic-bezier(.34,1.56,.64,1) both; }
        .st-enter > *:nth-child(1) { animation-delay: .04s; }
        .st-enter > *:nth-child(2) { animation-delay: .10s; }
        .st-enter > *:nth-child(3) { animation-delay: .16s; }
        .st-enter > *:nth-child(4) { animation-delay: .22s; }
        .st-enter > *:nth-child(5) { animation-delay: .28s; }
        .st-enter > *:nth-child(6) { animation-delay: .34s; }
        .st-enter > *:nth-child(7) { animation-delay: .40s; }
        .st-enter > *:nth-child(8) { animation-delay: .46s; }
        .st-enter > *:nth-child(9) { animation-delay: .52s; }
        .st-enter > *:nth-child(10) { animation-delay: .58s; }
        .st-enter > *:nth-child(11) { animation-delay: .64s; }
        .st-enter > *:nth-child(12) { animation-delay: .70s; }
        .st-toggle { width: 46px; height: 28px; background: rgba(0,85,255,.1); border-radius: 100px; position: relative; flex-shrink: 0; cursor: pointer; transition: background .22s cubic-bezier(.2,.9,.3,1); }
        .st-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; background: white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 2px 4px rgba(0,0,0,.08); transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
        .st-toggle.on { background: #00C853; }
        .st-toggle.on::after { transform: translateX(18px); }
      `}</style>

      <div className="st-enter" style={{ display: "flex", flexDirection: "column" }}>

        {/* Page Header */}
        <div style={{ padding: "8px 2px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: 2, background: "#0055FF", display: "inline-block" }} />
            Preferences
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Settings</h1>
          <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
            Manage your profile, notifications and preferences.
          </div>
        </div>

        {/* Profile Hero */}
        <div
          className="st-card3d"
          onClick={editName}
          role="button"
          tabIndex={0}
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 24, padding: "22px 20px", marginBottom: 20,
            position: "relative", overflow: "hidden", cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,26,102,.2), 0 12px 32px rgba(0,26,102,.3)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.12) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: "linear-gradient(135deg, rgba(255,255,255,.28), rgba(255,255,255,.12))",
              backdropFilter: "blur(22px)",
              border: "0.5px solid rgba(255,255,255,.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 22, fontWeight: 800, letterSpacing: "-0.4px", flexShrink: 0,
              boxShadow: "inset 0 0.5px 0 rgba(255,255,255,.22)",
              position: "relative",
            }}>
              {initials}
              <span style={{
                position: "absolute", bottom: -4, right: -4,
                width: 22, height: 22, background: "#0055FF",
                borderRadius: "50%", border: "2.5px solid #fff",
                boxShadow: "0 2px 6px rgba(0,85,255,.4)",
                display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1.1, marginBottom: 3 }}>
                {formData.name || "Teacher"}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)", fontWeight: 500, letterSpacing: "-0.1px", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {formData.email || "—"}
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <div style={{
                  background: "rgba(255,255,255,.16)", backdropFilter: "blur(10px)",
                  border: "0.5px solid rgba(255,255,255,.22)", color: "#fff",
                  padding: "3px 9px", borderRadius: 100,
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.3px",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span className="st-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "#00E866", boxShadow: "0 0 6px #00E866" }} />
                  Active
                </div>
                {formData.subject && (
                  <div style={{
                    background: "rgba(255,255,255,.16)", backdropFilter: "blur(10px)",
                    border: "0.5px solid rgba(255,255,255,.22)", color: "#fff",
                    padding: "3px 9px", borderRadius: 100,
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.3px",
                  }}>Teacher · {formData.subject}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Profile Section */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", padding: "4px 8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Profile</span>
          <button type="button" onClick={editName} className="st-press" style={{ fontSize: 11, fontWeight: 700, color: "#0055FF", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px" }}>
            Edit name
          </button>
        </div>
        <div className="st-card3d" style={{
          background: "#fff", borderRadius: 16, padding: 3, marginBottom: 18,
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
          border: "0.5px solid rgba(0,85,255,.07)",
          overflow: "hidden",
        }}>
          <div
            className="st-press"
            onClick={editName}
            role="button"
            tabIndex={0}
            style={{ padding: "10px 12px", position: "relative", cursor: "pointer", borderRadius: 11 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: 5 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>
              </svg>
              Name
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#001040", letterSpacing: "-0.2px" }}>
              {formData.name || <span style={{ color: "#99AACC", fontWeight: 500 }}>Tap to set name</span>}
            </div>
          </div>

          <div style={{ padding: "10px 12px", position: "relative", background: "rgba(255,170,0,.04)", borderRadius: 11, borderTop: "0.5px solid rgba(0,85,255,.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: 5 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1 0 2 1 2 2v12c0 1-1 2-2 2H4c-1 0-2-1-2-2V6c0-1 1-2 2-2z"/><polyline points="22 6 12 13 2 6"/>
              </svg>
              Email
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFAA00" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#002080", letterSpacing: "-0.2px" }}>{formData.email || "—"}</div>
            <div style={{ fontSize: 10, color: "#99AACC", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFAA00" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Managed by school admin
            </div>
          </div>

          <div
            className="st-press"
            onClick={editPhone}
            role="button"
            tabIndex={0}
            style={{ padding: "10px 12px", position: "relative", cursor: "pointer", borderRadius: 11, borderTop: "0.5px solid rgba(0,85,255,.07)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: 5 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
              </svg>
              Phone
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#001040", letterSpacing: "-0.2px" }}>
              {formData.phone || <span style={{ color: "#99AACC", fontWeight: 500 }}>Tap to add phone</span>}
            </div>
          </div>

          <div style={{ padding: "10px 12px", position: "relative", background: "rgba(255,170,0,.04)", borderRadius: 11, borderTop: "0.5px solid rgba(0,85,255,.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.3px", textTransform: "uppercase", marginBottom: 5 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#99AACC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
              </svg>
              Subject
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFAA00" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#002080", letterSpacing: "-0.2px" }}>{formData.subject || "—"}</div>
            <div style={{ fontSize: 10, color: "#99AACC", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFAA00" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Set by school admin
            </div>
          </div>
        </div>

        {/* Notifications Section */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", padding: "4px 8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Notifications</span>
          <button type="button" onClick={toggleAllNotifs} className="st-press" style={{ fontSize: 11, fontWeight: 700, color: allNotifsOn ? "#FF3355" : "#0055FF", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.1px" }}>
            {allNotifsOn ? "Disable all" : "Enable all"}
          </button>
        </div>
        <div className="st-card3d" style={{
          background: "#fff", borderRadius: 16, padding: 3, marginBottom: 18,
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
          border: "0.5px solid rgba(0,85,255,.07)",
          overflow: "hidden",
        }}>
          {([
            { key: "assignments" as const, title: "Assignments",    sub: "Submission alerts",    color: "linear-gradient(135deg, #0055FF, #1166FF)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
            { key: "grading" as const,     title: "Grading",        sub: "Deadline reminders",    color: "linear-gradient(135deg, #FFAA00, #FFDD55)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> },
            { key: "attendance" as const,  title: "Attendance",     sub: "Threshold warnings",    color: "linear-gradient(135deg, #FF8800, #FFAB33)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
            { key: "messages" as const,    title: "Messages",       sub: "New parent messages",   color: "linear-gradient(135deg, #00C853, #00E866)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> },
            { key: "risks" as const,       title: "Risks & alerts", sub: "Performance concerns",  color: "linear-gradient(135deg, #FF3355, #FF6680)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 21h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg> },
          ]).map((item, idx) => {
            const active = notifications[item.key];
            return (
              <div
                key={item.key}
                className="st-press"
                onClick={() => toggleNotif(item.key)}
                role="button"
                tabIndex={0}
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  padding: "12px 11px", borderRadius: 13, cursor: "pointer",
                  borderTop: idx > 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
                }}
              >
                <div style={{ width: 30, height: 30, borderRadius: 9, background: item.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,85,255,.12)" }}>
                  {item.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.25 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>{item.sub}</div>
                </div>
                <div className={`st-toggle ${active ? "on" : ""}`} />
              </div>
            );
          })}
        </div>

        {/* Preferences Section */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", padding: "4px 8px 10px" }}>Preferences</div>
        <div className="st-card3d" style={{
          background: "#fff", borderRadius: 16, padding: 3, marginBottom: 18,
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
          border: "0.5px solid rgba(0,85,255,.07)",
          overflow: "hidden",
        }}>
          {([
            { key: "defaultView" as const, title: "Dashboard view", value: preferences.defaultView, options: ["Grid", "List", "Compact"], color: "linear-gradient(135deg, #16B8B0, #2FD4CC)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
            { key: "gradeScale" as const, title: "Grade metric", value: preferences.gradeScale, options: ["Percentage", "Grade (A–F)", "Points"], color: "linear-gradient(135deg, #0055FF, #1166FF)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg> },
            { key: "dateFormat" as const, title: "Date format", value: preferences.dateFormat, options: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"], color: "linear-gradient(135deg, #FF8800, #FFAB33)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
            { key: "language" as const, title: "Language", value: preferences.language, options: ["English", "Hindi", "Urdu"], color: "linear-gradient(135deg, #001A66, #0044CC)",
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg> },
          ]).map((item, idx) => (
            <div
              key={item.key}
              className="st-press"
              onClick={() => cyclePref(item.key, item.options)}
              role="button"
              tabIndex={0}
              style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "12px 11px", borderRadius: 13, cursor: "pointer",
                borderTop: idx > 0 ? "0.5px solid rgba(0,85,255,.07)" : "none",
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 9, background: item.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,85,255,.12)" }}>
                {item.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.25 }}>{item.title}</div>
              </div>
              <div style={{ fontSize: 13, color: "#5070B0", fontWeight: 600, letterSpacing: "-0.15px", flexShrink: 0 }}>{item.value}</div>
              <div style={{ color: "#99AACC", fontSize: 20, fontWeight: 400, lineHeight: 1, marginLeft: 4, flexShrink: 0 }}>›</div>
            </div>
          ))}
        </div>

        {/* Security Section */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", padding: "4px 8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Security</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#00C853", letterSpacing: "-0.1px", display: "flex", alignItems: "center", gap: 3 }}>✓ Secured</span>
        </div>
        <div className="st-card3d" style={{
          background: "#fff", borderRadius: 16, padding: 3, marginBottom: 18,
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
          border: "0.5px solid rgba(0,85,255,.07)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "3px 3px 0" }}>
            <div style={{
              background: "rgba(0,200,83,.08)",
              border: "0.5px solid rgba(0,200,83,.22)",
              borderRadius: 13, padding: "11px 12px", marginBottom: 0,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 9, background: "#00C853", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                boxShadow: "0 1px 2px rgba(0,200,83,.15), 0 2px 5px rgba(0,200,83,.2)",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#001040", letterSpacing: "-0.2px" }}>Admin-managed account</div>
                <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 500, marginTop: 1, letterSpacing: "-0.1px", lineHeight: 1.4 }}>Contact admin to change password</div>
              </div>
              <div style={{
                background: "rgba(0,200,83,.1)", color: "#00C853",
                padding: "3px 9px", borderRadius: 100,
                fontSize: 9, fontWeight: 900, letterSpacing: "0.5px", textTransform: "uppercase", flexShrink: 0,
              }}>Safe</div>
            </div>
          </div>

          <div
            className="st-press"
            onClick={() => setTwoFactor(v => !v)}
            role="button"
            tabIndex={0}
            style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "12px 11px", borderRadius: 13, cursor: "pointer",
              marginTop: 3,
            }}
          >
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #001A66, #0044CC)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,26,102,.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.25 }}>Two-factor auth</div>
              <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>Extra login protection</div>
            </div>
            <div className={`st-toggle ${twoFactor ? "on" : ""}`} />
          </div>

          <div
            className="st-press"
            onClick={() => setLoginNotifs(v => !v)}
            role="button"
            tabIndex={0}
            style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "12px 11px", borderRadius: 13, cursor: "pointer",
              borderTop: "0.5px solid rgba(0,85,255,.07)",
            }}
          >
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #0055FF, #1166FF)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,85,255,.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.25 }}>Login notifications</div>
              <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>Alert on new device login</div>
            </div>
            <div className={`st-toggle ${loginNotifs ? "on" : ""}`} />
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ fontSize: 10, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", padding: "4px 8px 10px" }}>Danger zone</div>
        <div className="st-card3d" style={{
          background: "#fff", borderRadius: 16, padding: 3, marginBottom: 18,
          boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
          border: "0.5px solid rgba(0,85,255,.07)",
          overflow: "hidden",
        }}>
          <div
            className="st-press"
            onClick={() => { localStorage.clear(); toast.success("Local data cleared."); }}
            role="button"
            tabIndex={0}
            style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "12px 11px", borderRadius: 13, cursor: "pointer",
            }}
          >
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #FF8800, #FFAB33)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(255,136,0,.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", lineHeight: 1.25 }}>Clear all data</div>
              <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>Remove local cache and preferences</div>
            </div>
            <div style={{ color: "#99AACC", fontSize: 20, fontWeight: 400, lineHeight: 1, marginLeft: 4, flexShrink: 0 }}>›</div>
          </div>

          <div
            className="st-press"
            onClick={() => { if (confirm("Sign out?")) onLogout(); }}
            role="button"
            tabIndex={0}
            style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "12px 11px", borderRadius: 13, cursor: "pointer",
              borderTop: "0.5px solid rgba(0,85,255,.07)",
            }}
          >
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #FF3355, #FF6680)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(255,51,85,.2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#FF3355", letterSpacing: "-0.2px", lineHeight: 1.25 }}>Sign out</div>
              <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginTop: 2 }}>Log out of your account</div>
            </div>
            <div style={{ color: "#FF3355", fontSize: 20, fontWeight: 400, lineHeight: 1, marginLeft: 4, flexShrink: 0 }}>›</div>
          </div>
        </div>

        {/* App info footer */}
        <div style={{ textAlign: "center", padding: "8px 0 4px", color: "#99AACC", fontSize: 10, fontWeight: 600, letterSpacing: "0.3px" }}>
          EduIntellect · v2.4.1
        </div>

      </div>

      {/* Sticky Save Bar */}
      <div style={{
        position: "fixed", bottom: 88, left: 0, right: 0,
        background: "rgba(238,244,255,.94)",
        backdropFilter: "saturate(220%) blur(32px)",
        WebkitBackdropFilter: "saturate(220%) blur(32px)",
        borderTop: "0.5px solid rgba(0,85,255,.07)",
        padding: "12px 16px 14px",
        zIndex: 50, display: "flex", gap: 10,
      }}>
        <button
          type="button"
          onClick={onReset}
          disabled={isSaving}
          className="st-press"
          style={{
            flex: "0 0 100px", height: 48, borderRadius: 14,
            background: "#F4F7FE", color: "#002080",
            fontSize: 13, fontWeight: 700,
            border: "0.5px solid rgba(0,85,255,.07)",
            letterSpacing: "-0.2px",
            cursor: isSaving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            opacity: isSaving ? 0.5 : 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
          </svg>
          Reset
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="st-press"
          style={{
            flex: 1, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, #0044CC 0%, #0055FF 50%, #1166FF 100%)",
            color: "#fff",
            fontSize: 14, fontWeight: 800, border: "none",
            cursor: isSaving ? "wait" : "pointer",
            letterSpacing: "-0.2px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            boxShadow: "0 1px 2px rgba(0,26,102,.28), 0 6px 18px rgba(0,85,255,.38), inset 0 1px 0 rgba(255,255,255,.18)",
            fontFamily: "inherit", position: "relative", overflow: "hidden",
            opacity: isSaving ? 0.8 : 1,
          }}
        >
          {isSaving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          ) : (
            <>
              <span className="st-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFDD55", boxShadow: "0 0 6px #FFDD55", marginRight: 3 }} />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Save changes
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionCard = ({ title, iconBg, iconColor, icon, right, children }: {
  title: string; iconBg: string; iconColor: string;
  icon: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="sets-card3d" style={{
    background: T.white,
    border: "0.5px solid rgba(0,85,255,0.07)",
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
    marginBottom: 16,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 14px", borderBottom: `1px solid ${T.s2}` }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color: T.ink1 }}>{title}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
    {children}
  </div>
);

const FormRow = ({ label, icon, children, last }: {
  label: string; icon: React.ReactNode; children: React.ReactNode; last?: boolean;
}) => (
  <div style={{ padding: "12px 14px", borderBottom: last ? "none" : `1px solid ${T.s2}` }}>
    <div style={labelS}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      {label}
    </div>
    {children}
  </div>
);

const Hint = ({ text }: { text: string }) => (
  <p style={{ fontSize: 10, color: T.ink3, marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
    <svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="5.5" r="4.5" /><line x1="5.5" y1="3.5" x2="5.5" y2="6" />
      <circle cx="5.5" cy="7.5" r=".6" fill={T.ink3} stroke="none" />
    </svg>
    {text}
  </p>
);

const ToggleRow = ({ title, sub, active, onClick, last }: {
  title: string; sub: string; active: boolean; onClick: () => void; last?: boolean;
}) => (
  <div onClick={onClick} style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "13px 14px", borderBottom: last ? "none" : `1px solid ${T.s2}`,
    cursor: "pointer",
  }}>
    <div>
      <p style={{ fontSize: 13, fontWeight: 500, color: T.ink1, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{sub}</p>
    </div>
    <div style={{
      width: 44, height: 26, borderRadius: 13,
      background: active ? T.blue : T.bdr,
      position: "relative", transition: "background 200ms",
      flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 3,
        left: active ? 21 : 3,
        width: 20, height: 20, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        transition: "left 200ms",
      }} />
    </div>
  </div>
);

const SelectRow = ({ label, icon, value, options, onChange, last }: {
  label: string; icon: React.ReactNode; value: string;
  options: string[]; onChange: (v: string) => void; last?: boolean;
}) => (
  <div style={{ padding: "12px 14px", borderBottom: last ? "none" : `1px solid ${T.s2}` }}>
    <div style={labelS}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={T.ink3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      {label}
    </div>
    <div style={{ position: "relative", marginTop: 7 }}>
      <select style={selectS} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
      {chevDown}
    </div>
  </div>
);

const DangerRow = ({ title, sub, onClick, last }: {
  title: string; sub: string; onClick: () => void; last?: boolean;
}) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 14px", borderBottom: last ? "none" : `1px solid ${T.s2}`,
  }}>
    <div>
      <p style={{ fontSize: 13, fontWeight: 500, color: T.red, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{sub}</p>
    </div>
    <button type="button" onClick={onClick} style={{
      padding: "7px 13px", borderRadius: 10,
      background: T.rlBg, border: `1px solid ${T.rlBdr}`,
      color: T.red, fontSize: 11, fontWeight: 500,
      cursor: "pointer", fontFamily: "inherit",
    }}>
      {title.includes("Sign") ? "Sign out" : "Clear"}
    </button>
  </div>
);

export default SettingsPage;