import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { 
  collection, query, where, onSnapshot, addDoc, 
  serverTimestamp, deleteDoc, doc, getDocs, updateDoc 
} from "firebase/firestore";
import { 
  BookOpen, Users, Clock, ArrowRight, GraduationCap, 
  Loader2, Activity, Sparkles, Plus, 
  Trash2, UserPlus, Search, Check, X, ShieldCheck
} from "lucide-react";
import { 
  Dialog, DialogContent, DialogHeader, 
  DialogTitle, DialogDescription, DialogFooter 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const MyClasses = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();
  
  const [classes, setClasses] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddClassOpen, setIsAddClassOpen] = useState(false);
  const [isManageStudentsOpen, setIsManageStudentsOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);
  
  const [newClass, setNewClass] = useState({ name: "", grade: "", section: "" });
  const [newStudent, setNewStudent] = useState({ name: "", email: "" });
  const [existSearch, setExistSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 1. Fetch Teacher's Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, [teacherData?.id]);

  // 2. Fetch Enrollments for Teacher's Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      setEnrollments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherData?.id]);

  // 3. Fetch All Students (Global Registry) to search from
  useEffect(() => {
    const q = query(collection(db, "students")); 
    const unsub = onSnapshot(q, (snap) => {
      setAllStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Global Students Fetch Error:", error);
    });
    return () => unsub();
  }, []);

  const handleAddClass = async () => {
    if (!newClass.name || !newClass.grade) return toast.error("Class Name and Grade are required");
    setIsSaving(true);
    try {
      await addDoc(collection(db, "classes"), {
        ...newClass,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        createdAt: serverTimestamp()
      });
      toast.success("Class added successfully!");
      setIsAddClassOpen(false);
      setNewClass({ name: "", grade: "", section: "" });
    } catch (e) {
      toast.error("Failed to add class");
    } finally {
      setIsSaving(false);
    }
  };

  const enrollStudentAction = async (studentEmail: string, studentName: string, studentId?: string) => {
    if (!selectedClass?.id) return;
    const email = studentEmail.toLowerCase().trim();
    const alreadyEnrolled = enrollments.some(e => e.classId === selectedClass.id && e.studentEmail?.toLowerCase() === email);
    if (alreadyEnrolled) return toast.error("Student already in this class roster");

    await addDoc(collection(db, "enrollments"), {
      studentEmail: email,
      studentName,
      studentId: studentId || null,
      classId: selectedClass.id,
      className: selectedClass.name,
      teacherId: teacherData.id,
      schoolId: teacherData.schoolId || "",
      status: "Invited",
      enrolledAt: serverTimestamp()
    });
  };

  const handleAddStudent = async () => {
    if (!newStudent.name || !newStudent.email) return toast.error("Name and Email are required");
    setIsSaving(true);
    try {
      const email = newStudent.email.toLowerCase().trim();
      const existing = allStudents.find(s => s.email?.toLowerCase() === email);
      
      let finalStudentId = existing?.id;
      if (!existing) {
        const newDoc = await addDoc(collection(db, "students"), {
          name: newStudent.name,
          email: email,
          status: "Invited",
          teacherId: teacherData.id,
          schoolId: teacherData.schoolId || "",
          createdAt: serverTimestamp()
        });
        finalStudentId = newDoc.id;
      }

      await enrollStudentAction(email, newStudent.name, finalStudentId);
      toast.success(`${newStudent.name} enrolled`);
      setNewStudent({ name: "", email: "" });
    } catch (e) {
      toast.error("Enrollment failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignExisting = async (student: any) => {
    setIsSaving(true);
    try {
      await enrollStudentAction(student.email, student.name, student.id);
      toast.success(`${student.name} assigned`);
      setExistSearch("");
    } catch (e) {
      toast.error("Assignment failed");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteClass = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    try {
      await deleteDoc(doc(db, "classes", id));
      const q = query(collection(db, "enrollments"), where("classId", "==", id));
      const snap = await getDocs(q);
      const delPromises = snap.docs.map(d => deleteDoc(doc(db, "enrollments", d.id)));
      await Promise.all(delPromises);
      toast.success("Class removed");
    } catch (e) {
      toast.error("Error deleting class");
    }
  };

  const unenrollStudent = async (enrollId: string) => {
     if (!confirm("Unenroll this student?")) return;
     try {
       await deleteDoc(doc(db, "enrollments", enrollId));
       toast.success("Student removed");
     } catch (e) {
       toast.error("Failed to unenroll");
     }
  };

  if (loading) return (
    <div className="h-[60vh] flex flex-col items-center justify-center">
      <Loader2 className="w-10 h-10 text-[#1e3a8a] animate-spin mb-4" />
      <p className="font-bold text-slate-400">Syncing Registry...</p>
    </div>
  );

  const currentRoster = enrollments.filter(e => e.classId === selectedClass?.id);
  
  // Safely generate search candidates with null checks
  const candidates = allStudents.filter(s => {
    if (!s.email) return false;
    const isEnrolled = currentRoster.some(e => e.studentEmail?.toLowerCase() === s.email.toLowerCase());
    if (isEnrolled) return false;
    
    if (!existSearch) return true; // Show all available if no search string
    
    const search = existSearch.toLowerCase();
    const nameMatch = (s.name || "").toLowerCase().includes(search);
    const emailMatch = (s.email || "").toLowerCase().includes(search);
    return nameMatch || emailMatch;
  }).slice(0, 10);

  return (
    <div className="animate-in fade-in duration-500 pb-10 px-4 max-w-7xl mx-auto text-left">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-12 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight text-left">Academic Ecosystem</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1e3a8a]"/> Central Class & Roster Intelligence
          </p>
        </div>
        <button onClick={() => setIsAddClassOpen(true)} className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-xl hover:translate-y-[-2px] transition-all flex items-center gap-3">
          <Plus className="w-6 h-6" /> Start New Class Group
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-100 rounded-[4rem] p-32 text-center">
          <BookOpen className="w-12 h-12 text-slate-200 mx-auto mb-8" />
          <h2 className="text-3xl font-black text-slate-800 mb-3">No Classes Found</h2>
          <button onClick={() => setIsAddClassOpen(true)} className="px-12 py-5 bg-slate-900 text-white rounded-3xl font-black uppercase text-xs tracking-widest hover:bg-[#1e3a8a] transition-all shadow-xl">Onboard First Class</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {classes.map((cls) => {
            const rosterCount = enrollments.filter(e => e.classId === cls.id).length;
            return (
              <div 
                key={cls.id} 
                onClick={() => { setSelectedClass(cls); setIsManageStudentsOpen(true); }}
                className="bg-white border border-slate-100 rounded-[3.5rem] p-10 shadow-sm hover:shadow-2xl transition-all group flex flex-col text-left cursor-pointer hover:border-[#1e3a8a]/20"
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="w-16 h-16 rounded-3xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-xl group-hover:scale-110 transition-transform"><GraduationCap className="w-8 h-8" /></div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteClass(cls.id); }} 
                    className="p-3 bg-red-50 text-red-200 hover:text-rose-500 rounded-2xl transition-all relative z-20"
                  >
                    <Trash2 className="w-6 h-6" />
                  </button>
                </div>
                <h3 className="text-3xl font-black text-slate-900 mb-2 leading-tight group-hover:text-[#1e3a8a] transition-colors">{cls.name}</h3>
                <div className="flex items-center gap-2 mb-10">
                   <span className="text-[10px] font-black text-[#1e3a8a] bg-blue-50 px-3 py-1.5 rounded-full uppercase tracking-widest">{cls.grade}</span>
                </div>
                <div className="grid grid-cols-2 gap-5 mb-10 mt-auto">
                  <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 group-hover:bg-white transition-colors">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500"/> Roster</p>
                    <p className="text-2xl font-black text-slate-900">{rosterCount}</p>
                  </div>
                  <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 group-hover:bg-white transition-colors">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500"/> Active</p>
                    <p className="text-2xl font-black text-emerald-600">94%</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button className="flex-1 bg-slate-900 text-white py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-widest group-hover:bg-[#1e3a8a] transition-all flex items-center justify-center gap-3">
                    <UserPlus className="w-5 h-5" /> Manage Roster
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); navigate("/students"); }} 
                    className="w-16 bg-blue-50 text-[#1e3a8a] border border-blue-100 rounded-[2rem] flex items-center justify-center hover:bg-[#1e3a8a] hover:text-white transition-all"
                  >
                    <ArrowRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MANAGE STUDENTS DIALOG ── */}
      <Dialog open={isManageStudentsOpen} onOpenChange={setIsManageStudentsOpen}>
        <DialogContent className="sm:max-w-[720px] rounded-[4rem] max-h-[95vh] flex flex-col p-2 bg-[#f8fafc] border-none shadow-3xl overflow-hidden text-left">
          <div className="p-10 pb-4 bg-transparent text-left">
            <DialogHeader className="text-left">
              <DialogTitle className="text-4xl font-black text-slate-900 flex items-center gap-4 text-left">
                 <div className="w-14 h-14 bg-white rounded-3xl shadow-xl flex items-center justify-center -rotate-3"><Users className="w-7 h-7 text-blue-600" /></div>
                 {selectedClass?.name} Roster
              </DialogTitle>
              <DialogDescription className="text-slate-400 font-bold mt-2 uppercase tracking-widest text-[10px] text-left">Assign Existing Scholars or Invite New Candidates</DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="flex-1 overflow-y-auto p-10 pt-0 space-y-10 bg-transparent custom-scrollbar text-left">
            
            {/* 1. ASSIGN EXISTING SECTION */}
            <div className="space-y-6 pt-4 text-left">
               <div className="flex justify-between items-center text-left">
                  <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-3">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#1e3a8a] shadow-sm shadow-blue-500/50" /> Add from Global Registry
                  </h4>
               </div>
               <div className="relative group">
                  <Input placeholder="Search Global Registry..." className="h-16 rounded-[2rem] bg-white border-none shadow-sm pl-14 font-bold" value={existSearch} onChange={e => setExistSearch(e.target.value)} />
                  <Search className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" />
               </div>
               
               <div className="space-y-3 animate-in fade-in duration-300">
                  {candidates.map(s => (
                    <div key={s.id} className="p-5 bg-white border border-slate-50 rounded-[2rem] flex items-center justify-between shadow-sm hover:shadow-md transition-all">
                       <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 font-black text-xs">{s.name?.substring(0,2).toUpperCase()}</div>
                          <div className="text-left">
                             <p className="font-black text-slate-800 text-sm leading-none mb-1">{s.name}</p>
                             <p className="text-[10px] text-slate-400 font-bold uppercase">{s.email}</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-3">
                          {s.status === "Active" && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
                          <button onClick={() => handleAssignExisting(s)} disabled={isSaving} className="px-5 py-2.5 bg-[#1e3a8a] text-white text-[10px] font-black uppercase rounded-xl shadow-lg hover:bg-slate-900 active:scale-95 disabled:opacity-50 transition-all">Assign</button>
                       </div>
                    </div>
                  ))}
                  {candidates.length === 0 && (
                    <div className="p-6 text-center bg-white/50 border border-dashed border-slate-200 rounded-3xl">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No available scholars found in registry</p>
                    </div>
                  )}
               </div>
            </div>

            {/* 2. ENROLL NEW SECTION */}
            <div className="p-8 bg-white border border-slate-100 rounded-[3rem] shadow-xl relative overflow-hidden text-left">
               <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-500"/> Direct Invitation Protocol
               </h4>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2 text-left">
                    <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</Label>
                    <Input placeholder="Candidate Name" className="h-14 rounded-2xl bg-slate-50 border-none font-bold" value={newStudent.name} onChange={e=>setNewStudent({...newStudent, name: e.target.value})} />
                  </div>
                  <div className="space-y-2 text-left">
                    <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Parent Email</Label>
                    <Input placeholder="Official Email" type="email" className="h-14 rounded-2xl bg-slate-50 border-none font-bold" value={newStudent.email} onChange={e=>setNewStudent({...newStudent, email: e.target.value})} />
                  </div>
               </div>
               <button onClick={handleAddStudent} disabled={isSaving} className="w-full mt-6 py-4 bg-emerald-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 disabled:opacity-50 transition-all">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Enroll Scholar
               </button>
            </div>

            {/* 3. CURRENT ROSTER SECTION */}
            <div className="space-y-6 text-left">
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active Roster ({currentRoster.length})
              </h4>
              <div className="space-y-3">
                {currentRoster.map((e) => {
                  const s = allStudents.find(stu => stu.email?.toLowerCase() === e.studentEmail?.toLowerCase());
                  const isGlobalActive = s?.status === "Active";
                  return (
                    <div key={e.id} className="flex items-center justify-between p-5 bg-white rounded-[2rem] shadow-sm border border-slate-50 group/row transition-all">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs ${isGlobalActive ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                          {e.studentName?.substring(0,2).toUpperCase()}
                        </div>
                        <div className="text-left">
                          <p className="font-black text-slate-800 text-sm flex items-center gap-2">
                             {e.studentName}
                             {isGlobalActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          </p>
                          <p className="text-[9px] font-bold text-slate-400">{e.studentEmail}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border ${isGlobalActive ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
                          {isGlobalActive ? 'Active' : 'Invited'}
                        </div>
                        <button onClick={() => unenrollStudent(e.id)} className="p-2.5 bg-rose-50 text-rose-300 hover:text-rose-500 rounded-xl opacity-0 group-hover/row:opacity-100 transition-all"><X className="w-4 h-4"/></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          <div className="p-8 bg-white border-t border-slate-100 mt-auto text-left">
            <button onClick={() => setIsManageStudentsOpen(false)} className="w-full py-5 bg-slate-900 text-white rounded-[2rem] text-[11px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">Audit Complete</button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* ── ADD CLASS DIALOG ── */}
      <Dialog open={isAddClassOpen} onOpenChange={setIsAddClassOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-[4rem] text-left">
          <div className="bg-[#1e3a8a] p-10 text-white rounded-t-[4rem]">
             <DialogTitle className="text-3xl font-black mb-2">New Class</DialogTitle>
          </div>
          <div className="p-10 space-y-6 text-left">
            <div className="space-y-2 text-left">
              <Label className="uppercase text-[10px] font-black text-slate-400 ml-1">Class Name</Label>
              <Input placeholder="e.g. Physics" className="h-14 rounded-2xl font-bold bg-slate-50" value={newClass.name} onChange={e=>setNewClass({...newClass, name: e.target.value})} />
            </div>
            <div className="space-y-2 text-left">
              <Label className="uppercase text-[10px] font-black text-slate-400 ml-1">Grade</Label>
              <Input placeholder="e.g. 10th" className="h-14 rounded-2xl font-bold bg-slate-50" value={newClass.grade} onChange={e=>setNewClass({...newClass, grade: e.target.value})} />
            </div>
            <button disabled={isSaving} onClick={handleAddClass} className="w-full h-16 bg-[#1e3a8a] text-white rounded-3xl font-black uppercase tracking-widest shadow-lg py-4">Create Class</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyClasses;
