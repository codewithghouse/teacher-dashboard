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
      
      toast.success("Identity Matrix Synchronized.");
    } catch (error) {
      console.error("Settings Update Error:", error);
      toast.error("Cloud linkage failure.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNotification = (key: keyof NotificationSettings) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-20 text-left font-sans">
      
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-0 sm:px-2">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Teacher Dashboard</p>
          <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tighter leading-none mb-2 sm:mb-3">Settings</h1>
          <p className="text-sm sm:text-lg font-bold text-slate-400 italic">Configure your professional profile and preferences.</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 sm:flex-none px-4 sm:px-8 h-11 sm:h-14 bg-white border border-slate-100 rounded-2xl text-sm font-black text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4"/> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 sm:flex-none px-5 sm:px-10 h-11 sm:h-14 bg-[#1e3a8a] text-white rounded-2xl text-sm font-black shadow-lg shadow-blue-900/20 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 sm:gap-3 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
            {isSaving ? "Syncing..." : "Update Identity"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-10">
        
        <div className="lg:col-span-4 bg-white border border-slate-100 rounded-3xl sm:rounded-[3.5rem] p-6 sm:p-10 shadow-sm relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-50/50 rounded-full blur-3xl group-hover:bg-blue-100/50 transition-all" />
          
          <div className="flex items-center gap-5 mb-11 relative z-10">
            <div className="w-16 h-16 rounded-[2rem] bg-slate-50 flex items-center justify-center text-[#1e3a8a] shadow-inner group-hover:rotate-6 transition-transform">
              <User size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Identity</h2>
          </div>

          <div className="space-y-8 relative z-10">
            <InputField label="Name" icon={User} value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <InputField label="Email" icon={Mail} value={formData.email} disabled desc="System Registered Email" />
            <InputField label="Phone" icon={Phone} value={formData.phone} onChange={v => setFormData({...formData, phone: v})} />
            <InputField label="Primary Subject" icon={BookOpen} value={formData.subject} disabled desc="Core Academic Domain" />
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-100 rounded-3xl sm:rounded-[3.5rem] p-6 sm:p-10 shadow-sm relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-50/50 rounded-full blur-3xl group-hover:bg-amber-100/50 transition-all" />
          
          <div className="flex items-center gap-5 mb-11 relative z-10">
            <div className="w-16 h-16 rounded-[2rem] bg-slate-50 flex items-center justify-center text-amber-600 shadow-inner group-hover:rotate-12 transition-transform">
              <Bell size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Neural Alerts</h2>
          </div>

          <div className="space-y-8 relative z-10">
            <ToggleSwitch label="Assignments" desc="Submission alerts" active={notifications.assignments} onClick={() => toggleNotification('assignments')} />
            <ToggleSwitch label="Grading" desc="Deadline reminders" active={notifications.grading} onClick={() => toggleNotification('grading')} />
            <ToggleSwitch label="Attendance" desc="Threshold warnings" active={notifications.attendance} onClick={() => toggleNotification('attendance')} />
            <ToggleSwitch label="Messages" desc="New parent queries" active={notifications.messages} onClick={() => toggleNotification('messages')} />
            <ToggleSwitch label="Risks" desc="Performance concerns" active={notifications.risks} onClick={() => toggleNotification('risks')} />
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-100 rounded-3xl sm:rounded-[3.5rem] p-6 sm:p-10 shadow-sm relative overflow-hidden group">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-50/50 rounded-full blur-3xl group-hover:bg-emerald-100/50 transition-all" />
          
          <div className="flex items-center gap-5 mb-11 relative z-10">
            <div className="w-16 h-16 rounded-[2rem] bg-slate-50 flex items-center justify-center text-emerald-600 shadow-inner group-hover:-rotate-6 transition-transform">
              <Settings size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">Preferences</h2>
          </div>

          <div className="space-y-8 relative z-10">
            <SelectField label="Dashboard View" icon={Layout} value={preferences.defaultView} options={["Grid", "Compact"]} onChange={v => setPreferences({...preferences, defaultView: v})} />
            <SelectField label="Grade Metric" icon={TrendingUp} value={preferences.gradeScale} options={["Percentage", "GPA"]} onChange={v => setPreferences({...preferences, gradeScale: v})} />
            <SelectField label="Date Format" icon={Clock} value={preferences.dateFormat} options={["DD/MM/YYYY", "Relative"]} onChange={v => setPreferences({...preferences, dateFormat: v})} />
            
            <div className="pt-6 border-t border-slate-50 mt-10">
              <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl flex items-start gap-4 shadow-inner">
                 <ShieldCheck className="w-6 h-6 text-[#1e3a8a] shrink-0" />
                 <div>
                    <p className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-1">Central Security</p>
                    <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase tracking-tighter italic">Credentials managed by school primary hub.</p>
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
  <div className="text-left group/field">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3 pl-1 flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 group-hover/field:text-[#1e3a8a] transition-all" /> {label}
    </label>
    <input 
      type="text" 
      value={value}
      onChange={e => onChange?.(e.target.value)}
      disabled={disabled}
      className={`w-full h-14 px-6 bg-slate-50 border border-slate-100 rounded-2xl text-[13px] font-black text-slate-700 outline-none transition-all shadow-inner ${disabled ? 'opacity-40 cursor-not-allowed italic' : 'focus:bg-white focus:border-[#1e3a8a] focus:ring-4 focus:ring-blue-50'}`} 
    />
    {desc && <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mt-2 px-1">{desc}</p>}
  </div>
);

const SelectField = ({ label, icon: Icon, value, options, onChange }: any) => (
  <div className="text-left">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-3 pl-1 flex items-center gap-2">
      <Icon size={14} /> {label}
    </label>
    <select 
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full h-14 px-6 bg-slate-50 border border-slate-100 rounded-2xl text-[13px] font-black text-slate-700 outline-none focus:bg-white focus:border-[#1e3a8a] transition-all shadow-inner appearance-none cursor-pointer"
    >
      {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);

const ToggleSwitch = ({ label, desc, active, onClick }: any) => (
  <div className="flex items-center justify-between group/toggle" onClick={onClick}>
    <div className="cursor-pointer">
      <h3 className="text-sm font-black text-slate-800 mb-0.5 group-hover/toggle:text-[#1e3a8a] transition-colors">{label}</h3>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">{desc}</p>
    </div>
    <div className={`w-14 h-7 rounded-full relative cursor-pointer shadow-inner transition-all ${active ? 'bg-[#1e3a8a]' : 'bg-slate-200 hover:bg-slate-300'}`}>
      <div className={`w-5 h-5 bg-white rounded-full absolute top-1 shadow-2xl transition-all ${active ? 'right-1 scale-110' : 'left-1'}`} />
    </div>
  </div>
);

export default SettingsPage;
