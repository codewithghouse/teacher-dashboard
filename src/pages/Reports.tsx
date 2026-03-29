import { useState, useEffect } from "react";
import GenerateReport from "@/components/GenerateReport";
import { 
  FileText, Eye, Star, Sparkles, TrendingUp, Download, PieChart, Layout, BrainCircuit, BookOpen, 
  BarChart3, Users, AlertTriangle, Clock, ChevronRight, FileJson, FileSpreadsheet, PlusCircle, CheckCircle2
} from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";

const reports_config = [
  { 
    id: "class_perf", 
    title: "Class Performance Report", 
    desc: "Comprehensive analysis of class performance including grades, attendance, and progress trends.", 
    popular: true, 
    type: "Academic",
    color: "bg-blue-100 text-blue-600",
    formats: ["PDF", "Excel"],
    icon: BarChart3
  },
  { 
    id: "individual_progress", 
    title: "Individual Progress Report", 
    desc: "Detailed report for individual students covering all academic metrics and recommendations.", 
    popular: false, 
    type: "Student-Specific",
    color: "bg-emerald-100 text-emerald-600",
    formats: ["PDF"],
    icon: Users
  },
  { 
    id: "attendance_summary", 
    title: "Attendance Summary", 
    desc: "Monthly or term-wise attendance report with statistics and absentee analysis.", 
    popular: false, 
    type: "Administrative",
    color: "bg-amber-100 text-amber-600",
    formats: ["PDF", "Excel"],
    icon: Clock
  },
  { 
    id: "at_risk", 
    title: "At-Risk Students Report", 
    desc: "List of students with academic or attendance concerns requiring intervention.", 
    popular: false, 
    type: "Intervention",
    color: "bg-rose-100 text-rose-600",
    formats: ["PDF", "Excel"],
    icon: AlertTriangle
  },
];

const Reports = () => {
  const { teacherData } = useAuth();
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(
      collection(db, "reports"),
      where("teacherId", "==", teacherData.id)
    );
    return onSnapshot(q, (snap) => {
       const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
       // Client-side sorting to bypass index requirement
       docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
       setHistory(docs.slice(0, 5));
    });
  }, [teacherData?.id]);

  const handleOpenGenerate = (report: any) => {
    setSelectedReport(report);
    setIsGenerateOpen(true);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 pb-10 text-left">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-6 mb-10">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Reports</h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest leading-none">Generate and download academic reports.</p>
        </div>
        <div className="flex items-center gap-3 bg-white border border-slate-200 px-6 py-4 rounded-[2rem] shadow-sm">
           <Layout className="w-5 h-5 text-[#1e3a8a]"/>
           <span className="text-xs font-black uppercase tracking-widest text-slate-600 italic">{teacherData?.schoolName || 'EduIntellect Main'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {reports_config.map((r) => (
          <div key={r.id} className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:translate-y-[-4px] transition-all group relative overflow-hidden flex flex-col h-full">
            <div className="flex justify-between items-start mb-6">
              <div className={`w-16 h-16 rounded-2xl ${r.color} flex items-center justify-center shadow-inner`}>
                <r.icon className="w-8 h-8" />
              </div>
              {r.popular && (
                <div className="bg-emerald-500 text-white px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20">
                  Popular
                </div>
              )}
            </div>

            <h2 className="text-2xl font-black text-slate-900 mb-3 group-hover:text-[#1e3a8a] transition-colors">{r.title}</h2>
            <p className="text-sm font-semibold text-slate-400 leading-relaxed mb-8 flex-grow">{r.desc}</p>
            
            <div className="flex gap-2 mb-8">
              {r.formats.map(f => (
                <span key={f} className="px-4 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-[9px] font-black text-slate-400 uppercase tracking-widest group-hover:border-indigo-100 group-hover:text-indigo-600 transition-all">{f}</span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleOpenGenerate(r)}
                className="bg-[#1e3a8a] text-white py-4 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#1e4fc0] transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 group-active:scale-95"
              >
                Generate
              </button>
              <button 
                onClick={() => handleOpenGenerate(r)}
                className="bg-white text-slate-900 py-4 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2 group-active:scale-95"
              >
                Preview
              </button>
            </div>
          </div>
        ))}

        {/* Dynamic History Section */}
        <div className="col-span-full mt-12 pb-20">
            <div className="flex items-center justify-between mb-8">
                <div>
                   <h3 className="text-2xl font-black text-slate-900 tracking-tight italic">Intelligence Output History</h3>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic leading-none mt-1">Audit trail of generated academic documents</p>
                </div>
                <button className="flex items-center gap-2 text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline"><TrendingUp className="w-4 h-4"/> View Full Audit</button>
            </div>

            <div className="bg-white border border-slate-100 rounded-[3rem] p-4 shadow-sm">
                {history.length === 0 ? (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-10">
                      <div className="p-8 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-center group">
                          <PlusCircle className="w-10 h-10 text-slate-200 group-hover:text-indigo-400 transition-colors mb-4" />
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">No Recent Exports</p>
                      </div>
                      <div className="col-span-2 space-y-4 flex flex-col justify-center">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic leading-relaxed">Generated reports will appear here for 30 days. You can sync individual reports directly to parent portals from the generation screen.</p>
                          <div className="h-px bg-slate-100 w-full" />
                          <div className="flex items-center gap-6 opacity-30">
                             <FileJson size={32}/><FileSpreadsheet size={32}/><FileText size={32}/>
                          </div>
                      </div>
                   </div>
                ) : (
                   <div className="space-y-3">
                      {history.map(h => (
                         <div key={h.id} className="flex items-center justify-between p-6 bg-slate-50/50 hover:bg-white border border-transparent hover:border-slate-100 rounded-[2rem] transition-all group">
                            <div className="flex items-center gap-4">
                               <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-indigo-600">
                                  <FileText className="w-6 h-6"/>
                               </div>
                               <div>
                                  <p className="text-sm font-black text-slate-800">{h.title} - {h.grade}</p>
                                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                     <CheckCircle2 className="w-3 h-3 text-emerald-500" /> {h.status} • {h.format?.toUpperCase()} FORMAT • {h.createdAt?.toDate?.().toLocaleDateString()}
                                  </p>
                               </div>
                            </div>
                            <button className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-100 transition-all opacity-0 group-hover:opacity-100">
                               <Download className="w-4 h-4"/>
                            </button>
                         </div>
                      ))}
                   </div>
                )}
            </div>
        </div>
      </div>

      <GenerateReport 
        isOpen={isGenerateOpen} 
        onOpenChange={setIsGenerateOpen} 
        report={selectedReport} 
      />
    </div>
  );
};

export default Reports;
