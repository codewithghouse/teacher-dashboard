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

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#EEF4FF" }}>

      {/* ═══ DARK HERO ═══════════════════════════════════════════════════ */}
      <div className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 bg-[#162E93] md:bg-[#08090C]">
        <div style={{ padding: "18px 22px 0" }}>
          <p style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.28)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>
            Preferences
          </p>
          <h1 style={{ fontSize: 21, fontWeight: 500, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1.1 }}>Settings</h1>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
            Manage your profile, notifications and preferences.
          </p>
        </div>

        {/* Save + Reset buttons */}
        <div style={{ display: "flex", gap: 8, padding: "18px 22px 18px" }}>
          <button type="button" onClick={handleReset} style={{
            padding: "11px 14px", borderRadius: 12,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11,5 A5,5 0 1,1 8.5,1.5" /><polyline points="8.5,0 8.5,2 10.5,2" />
            </svg>
            Reset
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving} style={{
            flex: 1, padding: "11px", borderRadius: 12,
            background: T.blue, border: "none", color: "#fff",
            fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            opacity: isSaving ? 0.7 : 1,
          }}>
            {isSaving ? (
              <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1.5,6.5 4.5,10 10.5,2.5" />
              </svg>
            )}
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {/* ═══ BODY ════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingTop: 14 }}>

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
        <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
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
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionCard = ({ title, iconBg, iconColor, icon, right, children }: {
  title: string; iconBg: string; iconColor: string;
  icon: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div style={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: "hidden" }}>
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