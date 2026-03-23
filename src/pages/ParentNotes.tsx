import { useState, useEffect } from "react";
import { 
  Sparkles, Loader2, Copy, CheckCheck, MessageSquare, 
  FileText, Smile, AlertTriangle, BrainCircuit, Users,
  Send, RefreshCw, ChevronDown, Check
} from "lucide-react";
import { AIController } from "../ai/controller/ai-controller";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const TONES = [
  { id: "Friendly", label: "Friendly & Warm", icon: Smile, color: "bg-emerald-50 border-emerald-100 text-emerald-700", activeColor: "bg-emerald-500 text-white border-emerald-500", desc: "Encouraging and supportive tone." },
  { id: "Strict", label: "Strict & Firm", icon: AlertTriangle, color: "bg-rose-50 border-rose-100 text-rose-700", activeColor: "bg-rose-500 text-white border-rose-500", desc: "Professional and firm approach." },
  { id: "Neutral", label: "Neutral & Formal", icon: FileText, color: "bg-slate-50 border-slate-100 text-slate-700", activeColor: "bg-slate-700 text-white border-slate-700", desc: "Objective and factual tone." },
];

const MSG_TYPES = [
  { id: "PTM Note", label: "PTM Meeting Note", icon: MessageSquare, desc: "Quick note for parent-teacher meetings." },
  { id: "Term Progress Report Auto-Draft", label: "Progress Report Draft", icon: FileText, desc: "Structured term report card remarks." },
];

const ParentNotes = () => {
  const { teacherData } = useAuth();
  const [studentName, setStudentName] = useState("");
  const [selectedType, setSelectedType] = useState("PTM Note");
  const [selectedTone, setSelectedTone] = useState("Friendly");
  const [keyPoints, setKeyPoints] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  
  const [students, setStudents] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherData?.id]);

  const handleGenerate = async () => {
    if (!selectedStudent && !studentName) return toast.error("Please select a scholar.");
    if (!keyPoints.trim()) return toast.error("Please provide raw academic points.");
    
    setIsGenerating(true);
    setGeneratedDraft("");
    try {
      const result = await AIController.getParentNoteGeneration({
        student_name: selectedStudent?.studentName || studentName,
        type: selectedType,
        tone: selectedTone,
        points: keyPoints.trim(),
      });
      if (result.status === "success" && result.data?.draft) {
        setGeneratedDraft(result.data.draft);
        toast.success("Professional communication draft synthesized.");
      } else {
        toast.error("AI Brain failed to synthesize draft.");
      }
    } catch (e) {
      toast.error("Network synchronization failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToPortal = async () => {
    if (!generatedDraft || !selectedStudent) return;
    setIsSaving(true);
    try {
      await addDoc(collection(db, "parent_notes"), {
        teacherId: teacherData.id,
        studentId: selectedStudent.studentId || selectedStudent.id,
        studentName: selectedStudent.studentName,
        studentEmail: selectedStudent.studentEmail,
        draft: generatedDraft,
        type: selectedType,
        tone: selectedTone,
        createdAt: serverTimestamp()
      });
      toast.success("Draft published to Parent Portal trace.");
      handleReset();
    } catch (e) {
      toast.error("Failed to persist communication trace.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedDraft);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleReset = () => {
    setGeneratedDraft("");
    setKeyPoints("");
    setStudentName("");
    setSelectedStudent(null);
  };

  const filteredSuggestions = students.filter(s => 
    s.studentName?.toLowerCase().includes(studentName.toLowerCase()) ||
    s.studentEmail?.toLowerCase().includes(studentName.toLowerCase())
  );

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-12 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Communication Studio</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <BrainCircuit className="w-4 h-4 text-indigo-500 animate-pulse"/> AI-Powered Professional Scholarly Discourse Synthesis
          </p>
        </div>
        <div className="flex items-center gap-4 bg-indigo-50/50 border border-indigo-100 px-8 py-5 rounded-[2.5rem] shadow-sm">
           <BrainCircuit className="w-6 h-6 text-[#1e3a8a]"/>
           <span className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-[0.2em]">Neural Engine: GPT-4.0-O</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        <div className="xl:col-span-2 space-y-8">
          <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/30 rounded-bl-[4rem] group-hover:bg-[#1e3a8a] transition-all opacity-20"></div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Phase 01: Scholar Selection
            </p>
            <div className="relative">
              <input
                type="text"
                value={selectedStudent ? selectedStudent.studentName : studentName}
                onChange={(e) => { setStudentName(e.target.value); setSelectedStudent(null); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Identify Scholar via Registry..."
                className="w-full h-16 pl-14 pr-6 bg-slate-50 border-none rounded-2xl text-xs font-black uppercase tracking-widest focus:ring-4 ring-blue-50 transition-all shadow-inner"
              />
              <Users className="w-6 h-6 absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-slate-100 rounded-[2rem] shadow-2xl z-50 mt-4 overflow-hidden animate-in zoom-in-95 duration-200">
                  {filteredSuggestions.slice(0, 5).map((s: any) => (
                    <button key={s.id} onClick={() => { setSelectedStudent(s); setShowSuggestions(false); }}
                      className="w-full text-left px-8 py-5 hover:bg-slate-50 transition-colors flex items-center gap-4 border-b border-slate-50 last:border-0 group">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all text-[10px] font-black flex items-center justify-center text-slate-400">
                        {s.studentName?.substring(0,2).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-black text-slate-800 uppercase tracking-widest">{s.studentName}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{s.studentEmail}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-[#1e3a8a]" /> Phase 02: Communication Motif
            </p>
            <div className="space-y-4">
              {MSG_TYPES.map((type) => {
                const isActive = selectedType === type.id;
                return (
                  <button key={type.id} onClick={() => setSelectedType(type.id)}
                    className={`w-full flex items-center gap-6 p-6 rounded-[2rem] border transition-all text-left ${ isActive ? "border-[#1e3a8a] bg-[#1e3a8a]/5 shadow-blue-500/5 shadow-xl" : "border-slate-50 bg-slate-50 hover:border-slate-100" }`}>
                    <type.icon className={`w-6 h-6 ${ isActive ? "text-[#1e3a8a]" : "text-slate-300" }`} />
                    <div className="text-left">
                      <p className={`text-[11px] font-black uppercase tracking-widest ${ isActive ? "text-[#1e3a8a]" : "text-slate-500" }`}>{type.label}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">{type.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-50 rounded-[3rem] p-10 shadow-sm text-left">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> Phase 03: Tone Calibration
            </p>
            <div className="grid grid-cols-1 gap-4">
              {TONES.map((tone) => {
                const isActive = selectedTone === tone.id;
                return (
                  <button key={tone.id} onClick={() => setSelectedTone(tone.id)}
                    className={`w-full flex items-center gap-5 p-6 rounded-[2rem] border-2 transition-all text-left ${ isActive ? tone.activeColor + " shadow-xl shadow-slate-900/10" : tone.color + " border-transparent" }`}>
                    <tone.icon className="w-6 h-6 shrink-0" />
                    <div className="text-left">
                      <p className="text-[11px] font-black uppercase tracking-widest">{tone.label}</p>
                      <p className={`text-[9px] font-bold mt-1 uppercase tracking-tighter ${isActive ? "opacity-90" : "opacity-60"}`}>{tone.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="xl:col-span-3 space-y-10">
          <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm text-left">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-slate-900" /> Phase 04: Raw Intelligence Feed
            </p>
            <textarea
              rows={8}
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              placeholder={`Synthesize academic observations...\n• Math scores are declining (84% -> 72%)\n• Social engagement at 100%\n• Late submission on Physics UT1`}
              className="w-full p-8 bg-slate-50 border-none rounded-[2.5rem] text-sm font-bold shadow-inner focus:ring-4 ring-blue-50 transition-all resize-none leading-relaxed placeholder:text-slate-200"
            />

            <button
              onClick={handleGenerate}
              disabled={isGenerating || (!selectedStudent && !studentName)}
              className="w-full mt-10 bg-[#1e3a8a] text-white py-6 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:bg-slate-950 transition-all flex items-center justify-center gap-4 active:scale-95 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />} Synthesize Professional Discourse
            </button>
          </div>

          {generatedDraft && (
            <div className="bg-white border border-slate-100 rounded-[3.5rem] p-12 shadow-2xl animate-in zoom-in-95 duration-700 text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-50 rounded-bl-[6rem] opacity-30"></div>
              <div className="flex items-center justify-between mb-10 pb-8 border-b border-slate-50 relative z-10">
                <div className="text-left">
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight leading-none mb-2">Refined Discourse</h3>
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                     <Sparkles className="w-4 h-4"/> AI Final Calibration Complete
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={handleReset} className="w-14 h-14 rounded-2xl border border-slate-100 text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all flex items-center justify-center bg-white"><RefreshCw className="w-5 h-5" /></button>
                  <button onClick={handleCopy} className={`flex items-center gap-4 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${ isCopied ? "bg-emerald-500 text-white border-emerald-500 shadow-xl shadow-emerald-500/20" : "bg-white border-slate-100 text-slate-400 hover:border-[#1e3a8a] hover:text-[#1e3a8a] shadow-sm" }`}>
                    {isCopied ? <><CheckCheck className="w-5 h-5"/> Synced!</> : <><Copy className="w-5 h-5"/> Copy Draft</>}
                  </button>
                </div>
              </div>

              <textarea
                rows={14}
                value={generatedDraft}
                onChange={(e) => setGeneratedDraft(e.target.value)}
                className="w-full p-10 bg-slate-50/50 border border-slate-50 rounded-[3rem] text-sm font-bold leading-relaxed text-slate-600 focus:outline-none focus:ring-4 ring-blue-50 transition-all relative z-10"
              />

              <div className="flex items-center gap-6 mt-10 relative z-10">
                <button onClick={handleSaveToPortal} disabled={isSaving} className="flex-1 h-16 bg-emerald-600 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/30 hover:bg-emerald-700 transition-all flex items-center justify-center gap-3">
                  {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6"/>} Publish to Parent Analytics
                </button>
                <div className="flex items-center gap-3 px-6 py-4 bg-slate-50 rounded-2xl border border-slate-100">
                   <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Global Privacy Protocol Active</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParentNotes;
