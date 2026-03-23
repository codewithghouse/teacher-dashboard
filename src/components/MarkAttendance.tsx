import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, Loader2, Save, UserCheck, UserX, Clock, Check, RefreshCw, Layers } from 'lucide-react';
import { db } from "../lib/firebase";
import { collection, query, getDocs, where, serverTimestamp, setDoc, doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

interface MarkAttendanceProps { 
  onBack: () => void;
  initialClassId?: string;
}

const MarkAttendance = ({ onBack, initialClassId }: MarkAttendanceProps) => {
  const { teacherData } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // 1. Fetch Teacher's Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClasses(cls);
      if (!selectedClassId && cls.length > 0) setSelectedClassId(cls[0].id);
      setLoading(false);
    });
    return () => unsub();
  }, [teacherData?.id, selectedClassId]);

  // 2. Fetch Students for Selected Class from Enrollments
  useEffect(() => {
    if (!selectedClassId || !teacherData?.id) return;
    setLoading(true);
    const q = query(
      collection(db, "enrollments"), 
      where("teacherId", "==", teacherData.id),
      where("classId", "==", selectedClassId)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const roster = snap.docs.map(d => ({
        id: (d.data() as any).studentId || d.id,
        enrollId: d.id,
        name: (d.data() as any).studentName,
        email: (d.data() as any).studentEmail,
        status: 'none' // 'present', 'absent', 'late', 'none'
      }));
      setStudents(roster);
      setLoading(false);
    });
    return () => unsub();
  }, [selectedClassId, teacherData?.id]);

  const stats = {
    present: students.filter(s => s.status === 'present').length,
    absent: students.filter(s => s.status === 'absent').length,
    late: students.filter(s => s.status === 'late').length,
    unmarked: students.filter(s => s.status === 'none').length,
  };

  const setStatus = (id: string, newStatus: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
  };

  const handleSave = async () => {
    if (students.length === 0) return toast.error("No scholars in this registry subdivision.");
    if (stats.unmarked > 0) {
      if (!confirm(`You have ${stats.unmarked} unmarked scholars. Proceed with partial synchronization?`)) return;
    }

    setSaving(true);
    const today = new Date().toISOString().split('T')[0];
    const selClass = classes.find(c => c.id === selectedClassId);

    try {
      const promises = students
        .filter(s => s.status !== 'none')
        .map(s => {
          const attendanceRef = doc(db, "attendance", `${s.id}_${selectedClassId}_${today}`);
          return setDoc(attendanceRef, {
            studentId: s.id,
            studentName: s.name,
            studentEmail: s.email,
            status: s.status,
            date: today,
            teacherId: teacherData.id,
            classId: selectedClassId,
            className: selClass?.name || "Unknown",
            timestamp: serverTimestamp()
          });
        });

      await Promise.all(promises);
      toast.success(`Daily logs synchronized for ${selClass?.name}!`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Synchronization failed. Check network status.");
    } finally {
      setSaving(false);
    }
  };

  const filtered = students.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.email.toLowerCase().includes(search.toLowerCase())
  );

  const selClass = classes.find(c => c.id === selectedClassId);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 pb-20 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div className="text-left">
          <button onClick={onBack} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Cancel Routine
          </button>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-1">Marking: {selClass?.name || 'Loading...'}</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
             <Layers className="w-4 h-4 text-[#1e3a8a]"/> Institutional Roster Control • {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={markAllPresent} className="bg-emerald-50 text-emerald-700 px-8 py-5 rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-emerald-100 transition-all flex items-center gap-2 active:scale-95">
            <UserCheck className="w-5 h-5" /> Mark All Present
          </button>
          <button onClick={handleSave} disabled={saving || loading} className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/40 hover:translate-y-[-2px] hover:bg-slate-950 transition-all flex items-center gap-3 active:scale-95">
            {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <RefreshCw className="w-5 h-5 transition-transform group-hover:rotate-180" />} Synchronize Daily Log
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="p-6 bg-white border border-slate-50 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-emerald-100 transition-all">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-sm group-hover:bg-emerald-500 group-hover:text-white transition-all"><Check className="w-5 h-5"/></div>
          <div className="text-right"><p className="text-2xl font-black text-slate-800 leading-none">{stats.present}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Present</p></div>
        </div>
        <div className="p-6 bg-white border border-slate-50 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-amber-100 transition-all">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-sm group-hover:bg-amber-500 group-hover:text-white transition-all"><Clock className="w-5 h-5"/></div>
          <div className="text-right"><p className="text-2xl font-black text-slate-800 leading-none">{stats.late}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Late</p></div>
        </div>
        <div className="p-6 bg-white border border-slate-50 rounded-[2rem] shadow-sm flex items-center justify-between group hover:border-rose-100 transition-all">
          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600 shadow-sm group-hover:bg-rose-500 group-hover:text-white transition-all"><UserX className="w-5 h-5"/></div>
          <div className="text-right"><p className="text-2xl font-black text-slate-800 leading-none">{stats.absent}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Absent</p></div>
        </div>
        <div className="p-6 bg-slate-50 border border-slate-100 rounded-[2rem] shadow-sm flex items-center justify-between group transition-all">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-300 shadow-inner"><RefreshCw className="w-5 h-5"/></div>
          <div className="text-right"><p className="text-2xl font-black text-slate-400 leading-none">{stats.unmarked}</p><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Unmarked</p></div>
        </div>
      </div>

      <div className="bg-white border border-slate-50 rounded-[3.5rem] p-12 shadow-sm text-left">
        <div className="flex flex-col md:flex-row items-center justify-between mb-10 pb-8 border-b border-slate-50 gap-6">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Scholar Disposition Matrix</h2>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input value={search} onChange={e=>setSearch(e.target.value)} type="text" placeholder="Filter roster subdivision..." className="pl-14 pr-8 py-5 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest focus:ring-4 ring-blue-50 transition-all w-80 shadow-inner placeholder:text-slate-300"/>
          </div>
        </div>

        {loading ? (
             <div className="py-24 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accessing Enrollment Trace...</p>
             </div>
        ) : filtered.length === 0 ? (
           <div className="py-24 text-center">
              <UserX className="w-16 h-16 text-slate-100 mx-auto mb-6" />
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No Scholars Detected</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {filtered.map((student) => (
              <div key={student.id} className={`p-8 rounded-[3rem] border transition-all relative overflow-hidden group ${
                 student.status === 'present' ? 'bg-emerald-50 border-emerald-100' :
                 student.status === 'absent' ? 'bg-rose-50 border-rose-100' :
                 student.status === 'late' ? 'bg-amber-50 border-amber-100' :
                 'bg-white border-slate-100 hover:shadow-2xl'
              }`}>
                <div className="flex items-center gap-5 mb-8">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xs font-black shadow-lg transition-transform group-hover:scale-110 ${
                     student.status === 'present' ? 'bg-emerald-500 text-white shadow-emerald-200' :
                     student.status === 'absent' ? 'bg-rose-500 text-white shadow-rose-200' :
                     student.status === 'late' ? 'bg-amber-500 text-white shadow-amber-200' :
                     'bg-slate-50 text-slate-400'
                  }`}>
                    {student.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left overflow-hidden">
                    <h3 className="text-base font-black text-slate-900 leading-tight group-hover:text-[#1e3a8a] transition-colors truncate">{student.name}</h3>
                    <p className="text-[9px] text-slate-400 font-extrabold uppercase mt-1 tracking-widest truncate">{student.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                   <button 
                      onClick={() => setStatus(student.id, 'present')}
                      className={`h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 flex items-center justify-center gap-2 ${
                         student.status === 'present' ? 'bg-emerald-500 text-white border-emerald-500 shadow-xl shadow-emerald-500/20 scale-105' : 'bg-white border-slate-100 text-slate-400 hover:border-emerald-500 hover:text-emerald-500'
                      }`}
                   >
                      <Check className="w-4 h-4"/> Present
                   </button>
                   <button 
                      onClick={() => setStatus(student.id, 'late')}
                      className={`h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 flex items-center justify-center gap-2 ${
                         student.status === 'late' ? 'bg-amber-500 text-white border-amber-500 shadow-xl shadow-amber-500/20 scale-105' : 'bg-white border-slate-100 text-slate-400 hover:border-amber-500 hover:text-amber-500'
                      }`}
                   >
                      <Clock className="w-4 h-4"/> Late
                   </button>
                   <button 
                      onClick={() => setStatus(student.id, 'absent')}
                      className={`h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 flex items-center justify-center gap-2 ${
                         student.status === 'absent' ? 'bg-rose-500 text-white border-rose-500 shadow-xl shadow-rose-500/20 scale-105' : 'bg-white border-slate-100 text-slate-400 hover:border-rose-500 hover:text-rose-500'
                      }`}
                   >
                      <UserX className="w-4 h-4"/> Absent
                   </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkAttendance;
