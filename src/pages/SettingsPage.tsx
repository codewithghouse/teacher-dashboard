import React, { useState, useEffect } from "react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { 
  User, Bell, Settings, ShieldCheck, Mail, Phone, 
  BookOpen, Globe, Layout, Clock, Save, X, Loader2, TrendingUp
} from "lucide-react";

interface NotificationSettings {
  assignments: boolean;
  grading: boolean;
  attendance: boolean;
  messages: boolean;
  risks: boolean;
}

const SettingsPage = () => {
  const { teacherData } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: ""
  });

  const [notifications, setNotifications] = useState<NotificationSettings>({
    assignments: true,
    grading: true,
    attendance: true,
    messages: true,
    risks: true
  });

  const [preferences, setPreferences] = useState({
    defaultView: "Grid",
    gradeScale: "Percentage",
    dateFormat: "DD/MM/YYYY"
  });

  useEffect(() => {
    if (teacherData) {
      setFormData({
        name: teacherData.name || "",
        email: teacherData.email || "",
        phone: teacherData.phone || "",
        subject: teacherData.subject || ""
      });
      if (teacherData.notifications) {
        setNotifications(teacherData.notifications);
      }
      if (teacherData.preferences) {
        setPreferences(teacherData.preferences);
      }
    }
  }, [teacherData]);

  const handleSave = async () => {
    if (!teacherData?.id) return;
    setIsSaving(true);

    try {
      const docRef = doc(db, "teachers", teacherData.id);
      const updatePayload = {
        name: formData.name,
        phone: formData.phone,
        notifications: notifications,
        preferences: preferences,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(docRef, updatePayload);

      // No need to manually update local state; AuthContext has an onSnapshot listener
      // that will automatically detect this change and update the teacherData globally.

      toast.success("Settings saved.");
    } catch (error) {
      console.error("Settings Update Error:", error);
      toast.error("Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNotification = (key: keyof NotificationSettings) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-8 text-left pb-12">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="ds-page-title">Settings</h1>
          <p className="ds-page-subtitle">Manage your profile, notifications, and preferences.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="ds-btn-secondary"
          >
            <X className="w-4 h-4" /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="ds-btn-primary disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Profile */}
        <div className="ds-card p-6 sm:p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-[#1e3272]">
              <User size={18} />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Profile</h2>
          </div>
          <div className="space-y-5">
            <InputField label="Name" icon={User} value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} />
            <InputField label="Email" icon={Mail} value={formData.email} disabled desc="Managed by school admin" />
            <InputField label="Phone" icon={Phone} value={formData.phone} onChange={(v: string) => setFormData({...formData, phone: v})} />
            <InputField label="Subject" icon={BookOpen} value={formData.subject} disabled desc="Set by school admin" />
          </div>
        </div>

        {/* Notifications */}
        <div className="ds-card p-6 sm:p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Bell size={18} />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Notifications</h2>
          </div>
          <div className="space-y-5">
            <ToggleSwitch label="Assignments" desc="Submission alerts" active={notifications.assignments} onClick={() => toggleNotification('assignments')} />
            <ToggleSwitch label="Grading" desc="Deadline reminders" active={notifications.grading} onClick={() => toggleNotification('grading')} />
            <ToggleSwitch label="Attendance" desc="Threshold warnings" active={notifications.attendance} onClick={() => toggleNotification('attendance')} />
            <ToggleSwitch label="Messages" desc="New parent messages" active={notifications.messages} onClick={() => toggleNotification('messages')} />
            <ToggleSwitch label="Risks" desc="Performance concerns" active={notifications.risks} onClick={() => toggleNotification('risks')} />
          </div>
        </div>

        {/* Preferences */}
        <div className="ds-card p-6 sm:p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Settings size={18} />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Preferences</h2>
          </div>
          <div className="space-y-5">
            <SelectField label="Dashboard View" icon={Layout} value={preferences.defaultView} options={["Grid", "Compact"]} onChange={(v: string) => setPreferences({...preferences, defaultView: v})} />
            <SelectField label="Grade Metric" icon={TrendingUp} value={preferences.gradeScale} options={["Percentage", "GPA"]} onChange={(v: string) => setPreferences({...preferences, gradeScale: v})} />
            <SelectField label="Date Format" icon={Clock} value={preferences.dateFormat} options={["DD/MM/YYYY", "Relative"]} onChange={(v: string) => setPreferences({...preferences, dateFormat: v})} />

            <div className="pt-4 border-t border-slate-100">
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-[#1e3272] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-0.5">Security</p>
                  <p className="text-xs text-slate-400">Account credentials are managed by your school administrator.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

const InputField = ({ label, icon: Icon, value, onChange, disabled, desc }: any) => (
  <div className="text-left">
    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      <Icon className="w-3.5 h-3.5" /> {label}
    </label>
    <input
      type="text"
      value={value}
      onChange={e => onChange?.(e.target.value)}
      disabled={disabled}
      className={`ds-input ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    />
    {desc && <p className="text-xs text-slate-400 mt-1">{desc}</p>}
  </div>
);

const SelectField = ({ label, icon: Icon, value, options, onChange }: any) => (
  <div className="text-left">
    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      <Icon size={13} /> {label}
    </label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="ds-select"
    >
      {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

const ToggleSwitch = ({ label, desc, active, onClick }: any) => (
  <div className="flex items-center justify-between cursor-pointer" onClick={onClick}>
    <div>
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
    </div>
    <div className={`w-11 h-6 rounded-full relative flex-shrink-0 transition-colors duration-150 ${active ? 'bg-[#1e3272]' : 'bg-slate-200'}`}>
      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow transition-all duration-150 ${active ? 'right-1' : 'left-1'}`} />
    </div>
  </div>
);

export default SettingsPage;
