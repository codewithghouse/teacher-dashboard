import { useState, useEffect } from "react";
import { 
  Loader2, 
  MessageSquare, 
  Search, 
  Plus, 
  Filter, 
  ChevronRight, 
  Clock, 
  CheckCircle2, 
  Calendar,
  MoreVertical,
  X,
  Sparkles,
  Send,
  User,
  GraduationCap
} from "lucide-react";
import { db } from "../lib/firebase";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  orderBy 
} from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";
import { AIController } from "../ai/controller/ai-controller";

const STATS_CONFIG = [
  { label: "Total Messages", key: "total", icon: MessageSquare, color: "bg-blue-50 text-blue-500", borderColor: "border-blue-100" },
  { label: "Pending Replies", key: "pending", icon: Clock, color: "bg-amber-50 text-amber-500", borderColor: "border-amber-100" },
  { label: "Resolved", key: "resolved", icon: CheckCircle2, color: "bg-emerald-50 text-emerald-500", borderColor: "border-emerald-100" },
  { label: "Meetings Scheduled", key: "meetings", icon: Calendar, color: "bg-rose-50 text-rose-500", borderColor: "border-rose-100" },
];

const TEMPLATES = [
  { id: "grade", label: "Grade Concern", desc: "Inform parent about declining grades" },
  { id: "good", label: "Good Performance", desc: "Share positive progress update" },
  { id: "attendance", label: "Attendance Issue", desc: "Report frequent absences" },
  { id: "assignment", label: "Missing Assignments", desc: "Notify about pending work" },
  { id: "meeting", label: "Meeting Request", desc: "Schedule parent-teacher meeting" },
];

const TABS = ["All Messages", "Sent", "Received", "Meetings"];

const ParentNotes = () => {
  const { teacherData } = useAuth();
  const [activeTab, setActiveTab] = useState("All Messages");
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [messageContent, setMessageContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Roster States
  const [roster, setRoster] = useState<any[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");
  const [showRosterSuggestions, setShowRosterSuggestions] = useState(false);

  // 1. Fetch Roster (Enrollments)
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      setRoster(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherData?.id]);

  const filteredRoster = roster.filter(s => 
    s.studentName?.toLowerCase().includes(rosterSearch.toLowerCase()) ||
    s.studentId?.toLowerCase().includes(rosterSearch.toLowerCase())
  );

  // Stats calculation
  const stats = {
    total: notes.length,
    pending: notes.filter(n => n.status === "Pending Reply").length,
    resolved: notes.filter(n => n.status === "Replied").length,
    meetings: notes.filter(n => n.status === "Scheduled").length,
  };

  // 1. Fetch Notes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(
      collection(db, "parent_notes"), 
      where("teacherId", "==", teacherData.id)
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a: any, b: any) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });
      setNotes(data);
      setLoading(false);
    }, (error) => {
      console.error("Teacher Discourse Sync Error:", error);
      setLoading(false);
    });
    return () => unsub();
  }, [teacherData?.id]);

  // 2. Filtered Notes
  const filteredNotes = notes.filter(n => {
    const matchesTab = 
      activeTab === "All Messages" ||
      (activeTab === "Sent" && n.from === "teacher") ||
      (activeTab === "Received" && n.from === "parent") ||
      (activeTab === "Meetings" && n.status === "Scheduled");
    
    const matchesSearch = n.studentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         n.content?.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesTab && matchesSearch;
  });

  const handleSendMessage = async () => {
    if (!selectedStudent) return toast.error("Identify a target scholar first.");
    if (!messageContent.trim()) return toast.error("Message content is required.");
    try {
      await addDoc(collection(db, "parent_notes"), {
        teacherId: teacherData.id,
        teacherName: teacherData.name || "Teacher",
        studentId: selectedStudent?.studentId || "unknown",
        studentName: selectedStudent?.studentName || "Student",
        parentName: `Parent of ${selectedStudent?.studentName || 'Student'}`,
        subject: "Professional Discourse",
        content: messageContent,
        status: "Pending Reply",
        type: "Sent", // Sent from teacher
        from: "teacher",
        createdAt: serverTimestamp()
      });
      toast.success("Transmission published to Parent Portal trace.");
      setShowNewModal(false);
      setMessageContent("");
      setSelectedStudent(null);
      setRosterSearch("");
    } catch (e) {
      toast.error("Process aborted. Sync failure.");
    }
  };

  const generateAI = async () => {
    if (!selectedStudent) return toast.error("Select a scholar first.");
    setIsGenerating(true);
    try {
      const result = await AIController.getParentNoteGeneration({
        student_name: selectedStudent.name,
        type: "PTM Note",
        tone: "Professional",
        points: "Grade stability needs attention",
      });
      if (result.status === "success" && result.data?.draft) {
        setMessageContent(result.data.draft);
      }
    } catch (e) {
      toast.error("AI engine busy.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left bg-transparent">
      
      {/* ── HEADER ── */}
      <div className="flex justify-between items-start mb-10">
        <div>
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">RESULT OF CLICK: "PARENT NOTES"</p>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">Parent Notes</h1>
          <p className="text-sm font-semibold text-slate-400">Communicate with parents and track conversations.</p>
        </div>
        <button 
          onClick={() => setShowNewModal(true)}
          className="bg-[#1e3a8a] text-white px-8 py-3.5 rounded-2xl text-[12px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/10 hover:bg-blue-900 transition-all flex items-center gap-2"
        >
           <Plus className="w-4 h-4" /> New Message
        </button>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        {STATS_CONFIG.map(s => (
          <div key={s.key} className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm flex items-center gap-5">
             <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${s.color}`}>
                <s.icon className="w-7 h-7" />
             </div>
             <div>
                <h3 className="text-2xl font-black text-slate-900 leading-none mb-1 transition-all">{(stats as any)[s.key]}</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{s.label}</p>
             </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-10">
        
        {/* ── SIDEBAR: TEMPLATES ── */}
        <div className="xl:col-span-1 space-y-8">
           <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm">
              <h2 className="text-lg font-black text-slate-900 mb-8 uppercase tracking-tight">Quick Templates</h2>
              <div className="space-y-4">
                 {TEMPLATES.map(t => (
                    <button 
                      key={t.id}
                      className="w-full text-left p-6 rounded-[1.5rem] bg-slate-50 hover:bg-white border border-slate-50 hover:border-blue-100 hover:shadow-xl transition-all group"
                    >
                       <p className="text-[12px] font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{t.label}</p>
                       <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">{t.desc}</p>
                    </button>
                 ))}
              </div>
           </div>
        </div>

        {/* ── MAIN CONTENT: MESSAGE FEED ── */}
        <div className="xl:col-span-3 space-y-8">
           <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden flex flex-col min-h-[600px]">
              
              {/* TABS & SEARCH */}
              <div className="px-8 border-b border-slate-50 pt-6">
                 <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-6">
                    <div className="flex items-center gap-8 border-b-2 border-transparent">
                       {TABS.map(t => (
                          <button 
                             key={t}
                             onClick={() => setActiveTab(t)}
                             className={`pb-4 text-[11px] font-black uppercase tracking-widest transition-all relative ${activeTab === t ? 'text-[#1e3a8a]' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                             {t}
                             {activeTab === t && <div className="absolute bottom-[-2px] left-0 right-0 h-0.5 bg-[#1e3a8a] rounded-full" />}
                          </button>
                       ))}
                    </div>
                    <div className="relative w-full md:w-64">
                       <input 
                          type="text" 
                          placeholder="Search threads..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold placeholder:text-slate-400 focus:ring-2 focus:ring-blue-100 transition-all uppercase tracking-widest"
                       />
                       <Search className="w-4 h-4 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                    </div>
                 </div>
              </div>

              {/* LIST */}
              <div className="flex-1 divide-y divide-slate-50">
                 {loading ? (
                    <div className="h-full flex flex-col items-center justify-center py-20">
                       <Loader2 className="w-12 h-12 text-slate-200 animate-spin mb-4" />
                       <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Synchronizing communication portal...</p>
                    </div>
                 ) : filteredNotes.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center py-20 text-center px-10">
                       <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-6">
                          <MessageSquare className="w-10 h-10 text-slate-200" />
                       </div>
                       <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">Zero Transmissions</h3>
                       <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">No scholarly discourse recorded for this subdivision.</p>
                    </div>
                 ) : (
                    filteredNotes.map(n => (
                       <div key={n.id} className="p-8 hover:bg-slate-50/50 transition-all group relative">
                          <div className="flex gap-6 items-start">
                             <div className="w-12 h-12 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white text-base font-black shadow-md group-hover:scale-110 transition-transform">
                                {n.studentName?.substring(0,2).toUpperCase()}
                             </div>
                             <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start mb-4">
                                   <div>
                                      <h4 className="text-[17px] font-black text-slate-900 tracking-tight leading-none mb-2 capitalize">
                                        {n.from === "teacher" ? `Sent to: ${n.studentName}'s Parents` : `From: ${n.parentName || n.studentName + "'s Parents"}`}
                                      </h4>
                                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
                                         Class 8-A <span className="w-1 h-1 rounded-full bg-slate-200" /> {n.createdAt?.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </p>
                                   </div>
                                   <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                      n.status === "Pending Reply" ? "bg-amber-50 text-amber-500" :
                                      n.status === "Replied" ? "bg-emerald-50 text-emerald-500" :
                                      "bg-blue-50 text-blue-500"
                                   }`}>
                                      {n.status}
                                   </span>
                                </div>
                                <p className="text-[14px] font-medium text-slate-600 leading-relaxed mb-6">
                                   {n.content}
                                </p>
                                <div className="flex gap-3 relative z-10">
                                   <button 
                                      onClick={() => {
                                         setSelectedStudent({ studentId: n.studentId, studentName: n.studentName, className: 'Registry Subdivision' });
                                         setShowNewModal(true);
                                      }}
                                      className="px-6 py-2.5 bg-[#1e3a8a] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/10 hover:bg-blue-900 transition-all"
                                   >
                                      Reply
                                   </button>
                                   <button className="px-6 py-2.5 bg-white border border-slate-200 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-slate-300 transition-all">View Thread</button>
                                </div>
                             </div>
                          </div>
                          <button className="absolute top-8 right-8 p-2 text-slate-200 hover:text-slate-400 transition-colors opacity-0 group-hover:opacity-100">
                             <MoreVertical className="w-5 h-5" />
                          </button>
                       </div>
                    ))
                 )}
              </div>
           </div>
        </div>
      </div>

      {/* ── NEW MESSAGE MODAL (AI OPTIMIZED) ── */}
      {showNewModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="bg-white rounded-[3rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
              <div className="bg-[#1e3a8a] p-10 text-white relative">
                 <button onClick={() => setShowNewModal(false)} className="absolute top-8 right-8 p-3 hover:bg-white/10 rounded-2xl transition-all">
                    <X className="w-6 h-6" />
                 </button>
                 <div className="w-16 h-16 bg-white/10 rounded-[1.5rem] flex items-center justify-center mb-6">
                    <Send className="w-8 h-8 text-white" />
                 </div>
                 <h2 className="text-3xl font-black tracking-tight leading-none mb-2">Initialize Discourse</h2>
                 <p className="text-blue-100/70 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Global Communication Pipeline</p>
              </div>

              <div className="p-10 space-y-8 overflow-y-auto custom-scrollbar flex-1">
                 <div className="space-y-3 relative">
                    <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Identify Target Scholar</label>
                    <div className="relative">
                       <input 
                          type="text" 
                          value={selectedStudent ? selectedStudent.studentName : rosterSearch}
                          onChange={(e) => {
                             setRosterSearch(e.target.value);
                             setSelectedStudent(null);
                             setShowRosterSuggestions(true);
                          }}
                          onFocus={() => setShowRosterSuggestions(true)}
                          placeholder="Search student by registry ID or name..."
                          className="w-full pl-12 h-14 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-4 ring-blue-50 transition-all font-black uppercase tracking-widest placeholder:text-slate-200"
                       />
                       <User className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                    </div>

                    {showRosterSuggestions && (rosterSearch || showRosterSuggestions) && filteredRoster.length > 0 && (
                       <div className="absolute top-full left-0 right-0 bg-white border border-slate-100 rounded-[2rem] shadow-2xl z-50 mt-4 overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                             {filteredRoster.slice(0, 100).map((s: any) => (
                                <button 
                                   key={s.id} 
                                   onClick={() => { 
                                      setSelectedStudent(s); 
                                      setShowRosterSuggestions(false); 
                                      setRosterSearch(""); 
                                   }}
                                   className="w-full text-left px-8 py-5 hover:bg-slate-50 transition-colors flex items-center gap-4 border-b border-slate-50 last:border-0 group"
                                >
                                   <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all text-[10px] font-black flex items-center justify-center text-slate-400">
                                      {s.studentName?.substring(0,2).toUpperCase()}
                                   </div>
                                   <div className="text-left flex-1">
                                      <p className="text-xs font-black text-slate-800 uppercase tracking-widest">{s.studentName}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                         <p className="text-[9px] font-bold text-[#1e3a8a] uppercase">Class: {s.className || s.grade || s.classId || "General Registry"}</p>
                                         <span className="w-1 h-1 rounded-full bg-slate-200" />
                                         <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest">ID: {s.studentId?.substring(0, 8)}</p>
                                      </div>
                                   </div>
                                </button>
                             ))}
                          </div>
                       </div>
                    )}
                 </div>

                 <div className="space-y-4">
                    <div className="flex justify-between items-end">
                       <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Message Content</label>
                       <button 
                         onClick={generateAI}
                         disabled={isGenerating}
                         className="flex items-center gap-2 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors"
                       >
                          {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Use AI Assistant
                       </button>
                    </div>
                    <textarea 
                       rows={6} 
                       value={messageContent}
                       onChange={(e) => setMessageContent(e.target.value)}
                       placeholder="Draft your scholarly observation here..."
                       className="w-full p-8 bg-slate-50 border-none rounded-[2.5rem] text-sm font-bold shadow-inner focus:ring-4 ring-blue-50 transition-all resize-none leading-relaxed"
                    />
                 </div>

                 <div className="pt-4 flex gap-4">
                    <button 
                       onClick={handleSendMessage}
                       className="flex-1 bg-[#1e3a8a] text-white py-5 rounded-[2rem] font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-900/10 hover:bg-blue-900 transition-all flex items-center justify-center gap-3"
                    >
                       <Send className="w-4 h-4" /> Publish Transmission
                    </button>
                    <button 
                       onClick={() => setShowNewModal(false)}
                       className="px-10 bg-slate-50 text-slate-400 py-5 rounded-[2rem] font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all"
                    >
                       Discard
                    </button>
                 </div>
              </div>

              <div className="bg-slate-50 p-6 text-center border-t border-slate-100">
                 <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">End-to-End Encrypted Communication Trace</p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default ParentNotes;
