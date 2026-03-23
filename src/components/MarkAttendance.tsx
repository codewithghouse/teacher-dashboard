import React, { useState, useEffect } from 'react';
import { ChevronLeft, Search, Loader2, Save, UserCheck, UserX } from 'lucide-react';
import { db } from "../lib/firebase";
import { collection, query, getDocs, where, serverTimestamp, setDoc, doc, onSnapshot } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const MarkAttendance = ({ onBack }: { onBack: () => void }) => {
  const { teacherData } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
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
      if (cls.length > 0 && !selectedClassId) setSelectedClassId(cls[0].id);
      setLoading(false);
    });
    return () => unsub();
  }, [teacherData?.id]);

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
        status: 'none'
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

  const toggleStatus = (id: string, status: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: s.status === status ? 'none' : status } : s));
  };

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
  };

  const handleSave = async () => {
    if (students.length === 0) return toast.error("No students in this class roster.");
    if (stats.unmarked > 0) {
      if (!confirm(`You have ${stats.unmarked} unmarked scholars. Proceed with partial record?`)) return;
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
      toast.success(`Attendance saved for ${selClass?.name}!`);
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Failed to sync attendance with server.");
    } finally {
      setSaving(false);
    }
  };

  const filteredStudents = students.filter(s => 
    (s.name || "").toLowerCase().includes(search.toLowerCase()) || 
    (s.email || "").toLowerCase().includes(search)
  );

  return (
    <div className="animate-in fade-in duration-500 pb-10 text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-6">
        <div className="text-left">
          <button onClick={onBack} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#1e3a8a] flex items-center gap-1 mb-2 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Exit Session
          </button>
          <h1 className="text-3xl font-black text-slate-900">Live Roster Audit</h1>
          <div className="flex items-center gap-4 mt-1">
             <select 
               value={selectedClassId} 
               onChange={e => setSelectedClassId(e.target.value)}
               className="bg-slate-50 border-none text-xs font-black uppercase tracking-widest text-[#1e3a8a] py-1 pl-0 pr-8 focus:ring-0 cursor-pointer"
             >
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
             </select>
             <span className="text-slate-300">|</span>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
               {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
             </p>
          </div>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving || loading || students.length === 0}
          className="bg-emerald-600 text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl shadow-emerald-900/20 hover:bg-emerald-700 transition-all flex items-center gap-3 disabled:opacity-50 active:scale-95"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} Synchronize Daily Roster
        </button>
      </div>

      <div className="bg-white border border-slate-50 rounded-[3rem] p-8 mb-8 flex flex-wrap items-center justify-between gap-8 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Roster Automation:</span>
          <button onClick={markAllPresent} disabled={loading || students.length === 0} className="px-6 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:border-emerald-200 hover:bg-emerald-50 transition-all flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-500" /> Mark All Present
          </button>
        </div>
        
        <div className="flex items-center gap-12 bg-slate-50/50 px-10 py-4 rounded-[2rem] border border-slate-100">
          <div className="text-center">
            <p className="text-2xl font-black text-emerald-600 leading-none">{stats.present}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mt-1">Present</p>
          </div>
          <div className="w-[1px] h-8 bg-slate-200" />
          <div className="text-center">
            <p className="text-2xl font-black text-rose-600 leading-none">{stats.absent}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mt-1">Absent</p>
          </div>
          <div className="w-[1px] h-8 bg-slate-200" />
          <div className="text-center">
            <p className="text-2xl font-black text-amber-500 leading-none">{stats.late}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mt-1">Late</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-50 rounded-[3.5rem] p-10 shadow-sm relative overflow-hidden text-left">
        <div className="flex flex-col md:flex-row items-center justify-between mb-10 pb-8 border-b border-slate-50 gap-6">
          <div className="text-left">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Student Disposition</h2>
            <p className="text-[10px] font-black text-slate-400 tracking-widest uppercase mt-1">Audit Population: {students.length} Scholars</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="w-5 h-5 absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input 
              type="text" 
              placeholder="Filter roster..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-14 pr-6 py-5 bg-slate-50 border-none rounded-2xl text-[13px] font-bold focus:ring-4 ring-blue-50 transition-all shadow-inner placeholder:text-slate-300"
            />
          </div>
        </div>

        {loading ? (
           <div className="py-32 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-6" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Recalibrating Neural Student Matrix...</p>
           </div>
        ) : filteredStudents.length === 0 ? (
           <div className="py-32 text-center">
              <UserX className="w-16 h-16 text-slate-100 mx-auto mb-6" />
              <p className="text-sm font-black text-slate-300 uppercase tracking-[0.2em]">Roster is Empty or Filtered</p>
           </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredStudents.map((student) => (
              <div key={student.id} className="p-8 bg-white border border-slate-100 rounded-[2.5rem] transition-all hover:shadow-xl hover:border-blue-100 group relative">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#1e3a8a] group-hover:text-white transition-all font-black text-lg shadow-sm">
                    {student.name?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <h3 className="font-black text-slate-900 text-sm leading-tight group-hover:text-[#1e3a8a] transition-colors">{student.name}</h3>
                    <p className="text-[9px] text-slate-400 font-extrabold uppercase mt-1 tracking-widest truncate max-w-[100px]">{student.email}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => toggleStatus(student.id, 'present')} className={`py-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${student.status === 'present' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}>P</button>
                  <button onClick={() => toggleStatus(student.id, 'absent')} className={`py-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${student.status === 'absent' ? 'bg-rose-500 text-white shadow-lg' : 'bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-600'}`}>A</button>
                  <button onClick={() => toggleStatus(student.id, 'late')} className={`py-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${student.status === 'late' ? 'bg-amber-500 text-white shadow-lg' : 'bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-500'}`}>L</button>
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
