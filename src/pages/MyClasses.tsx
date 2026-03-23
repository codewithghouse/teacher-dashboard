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
    const q = query(collection(db, "students")); // For search across all records
    const unsub = onSnapshot(q, (snap) => {
      setAllStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    // Check if already enrolled in THIS class
    const alreadyEnrolled = enrollments.some(e => e.classId === selectedClass.id && e.studentEmail === studentEmail);
    if (alreadyEnrolled) return toast.error("Student already in this class roster");

    // Create Enrollment Record
    await addDoc(collection(db, "enrollments"), {
      studentEmail: studentEmail.toLowerCase(),
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
      const email = newStudent.email.toLowerCase();
      // 1. Check if student exists globally
      const existing = allStudents.find(s => s.email === email);
      
      let finalStudentId = existing?.id;
      if (!existing) {
        // Create in global student registry if doesn't exist
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

      // 2. Add to Enrollments for THIS specific class
      await enrollStudentAction(email, newStudent.name, finalStudentId);

      toast.success(`${newStudent.name} enrolled in ${selectedClass.name}`);
      setNewStudent({ name: "", email: "" });
    } catch (e) {
      console.error(e);
      toast.error("Failed to enroll student");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignExisting = async (student: any) => {
    setIsSaving(true);
    try {
      await enrollStudentAction(student.email, student.name, student.id);
      toast.success(`${student.name} assigned to your class`);
      setExistSearch("");
    } catch (e) {
      toast.error("Failed to assign student");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteClass = async (id: string) => {
    if (!confirm("Are you sure? This will remove the class group and enrollments.")) return;
    try {
      await deleteDoc(doc(db, "classes", id));
      // Optional: Delete enrollments related to this class
      const q = query(collection(db, "enrollments"), where("classId", "==", id));
      const snap = await getDocs(q);
      snap.docs.forEach(d => deleteDoc(doc(db, "enrollments", d.id)));
      
      toast.success("Class and roster removed");
    } catch (e) {
      toast.error("Error deleting class");
    }
  };

  const unenrollStudent = async (enrollId: string) => {
     if (!confirm("Unenroll this student?")) return;
     try {
       await deleteDoc(doc(db, "enrollments", enrollId));
       toast.success("Student removed from roster");
     } catch (e) {
       toast.error("Failed to unenroll");
     }
  };

  if (loading) return (
    <div className="h-[60vh] flex flex-col items-center justify-center">
      <Loader2 className="w-10 h-10 text-[#1e3a8a] animate-spin mb-4" />
      <p className="font-bold text-slate-400">Syncing Academic Registry...</p>
    </div>
  );

  const currentRoster = enrollments.filter(e => e.classId === selectedClass?.id);
  const searchCandidates = allStudents.filter(s => 
    !currentRoster.some(e => e.studentEmail === s.email) && 
    (s.name.toLowerCase().includes(existSearch.toLowerCase()) || 
     s.email.toLowerCase().includes(existSearch.toLowerCase()))
  ).slice(0, 8); // Showing up to 8 candidates

  return (
    <div className="animate-in fade-in duration-500 pb-10 px-4 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-12 gap-8 bg-white p-10 rounded-[3rem] border border-slate-50 shadow-sm shadow-slate-100/50">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Academic Ecosystem</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1e3a8a]"/> Central Class & Roster Intelligence
          </p>
        </div>
        <button 
          onClick={() => setIsAddClassOpen(true)}
          className="bg-[#1e3a8a] text-white px-10 py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/30 hover:translate-y-[-2px] hover:shadow-blue-900/40 transition-all flex items-center gap-3 active:scale-95"
        >
          <Plus className="w-6 h-6" /> Start New Class Group
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-100 rounded-[4rem] p-32 text-center group">
          <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-8 group-hover:bg-blue-50 transition-colors duration-500">
            <BookOpen className="w-12 h-12 text-slate-200 group-hover:text-blue-200 transition-colors" />
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-3">No Class Structures Yet</h2>
          <p className="text-slate-400 font-bold mb-10 max-w-md mx-auto italic leading-relaxed">Your digital teaching hub is ready. Setup classes once and manage enrollments effortlessly.</p>
          <button onClick={() => setIsAddClassOpen(true)} className="px-12 py-5 bg-slate-900 text-white rounded-3xl font-black uppercase text-xs tracking-[0.2em] hover:bg-[#1e3a8a] transition-all shadow-xl">Onboard First Class</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {classes.map((cls) => {
            const classEnrollments = enrollments.filter(e => e.classId === cls.id);
            return (
              <div key={cls.id} className="bg-white border border-slate-100 rounded-[3.5rem] p-10 shadow-sm hover:shadow-2xl transition-all group relative overflow-hidden flex flex-col">
                <div className="absolute -right-16 -top-16 w-48 h-48 bg-blue-50/40 rounded-full blur-3xl group-hover:bg-blue-100/50 transition-colors pointer-events-none"></div>
                
                <div className="flex justify-between items-start mb-8 relative z-10">
                  <div className="w-16 h-16 rounded-3xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-xl rotate-3 group-hover:rotate-0 transition-transform">
                    <GraduationCap className="w-8 h-8" />
                  </div>
                  <button onClick={() => deleteClass(cls.id)} className="p-3 bg-red-50 text-red-200 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all">
                    <Trash2 className="w-6 h-6" />
                  </button>
                </div>

                <div className="mb-10 relative z-10">
                  <h3 className="text-3xl font-black text-slate-900 mb-2 leading-tight">{cls.name}</h3>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-black text-[#1e3a8a] bg-blue-50 px-3 py-1.5 rounded-full uppercase tracking-widest">{cls.grade}</span>
                     {cls.section && <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-3 py-1.5 rounded-full uppercase tracking-widest">Section {cls.section}</span>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5 mb-10 relative z-10 mt-auto">
                  <div className="bg-slate-50/50 p-5 rounded-3xl border border-slate-100 hover:bg-white hover:shadow-lg transition-all">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500"/> Capacity</p>
                    <p className="text-2xl font-black text-slate-900 tracking-tighter">{classEnrollments.length} <span className="text-sm text-slate-300 font-bold tracking-normal ml-1">Regd</span></p>
                  </div>
                  <div className="bg-slate-50/50 p-5 rounded-3xl border border-slate-100 hover:bg-white hover:shadow-lg transition-all">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500"/> Engagement</p>
                    <p className="text-2xl font-black text-emerald-600 tracking-tighter">94%</p>
                  </div>
                </div>

                <div className="flex gap-4 relative z-10">
                  <button 
                    onClick={() => { setSelectedClass(cls); setIsManageStudentsOpen(true); }}
                    className="flex-1 bg-slate-900 text-white py-5 rounded-[2rem] text-[11px] font-black uppercase tracking-[0.2em] hover:shadow-xl hover:translate-y-[-2px] transition-all flex items-center justify-center gap-3"
                  >
                    <UserPlus className="w-5 h-5" /> Manage Roster
                  </button>
                  <button 
                    onClick={() => navigate("/students")}
                    className="w-16 bg-blue-50 text-[#1e3a8a] border border-blue-100 rounded-[2rem] flex items-center justify-center hover:bg-[#1e3a8a] hover:text-white transition-all shadow-sm"
                  >
                    <ArrowRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ADD CLASS DIALOG ── */}
      <Dialog open={isAddClassOpen} onOpenChange={setIsAddClassOpen}>
        <DialogContent className="sm:max-w-[540px] rounded-[4rem] p-0 overflow-hidden border-none shadow-3xl">
          <div className="bg-[#1e3a8a] p-10 text-white">
             <DialogTitle className="text-3xl font-black mb-2 tracking-tight">Create New Class</DialogTitle>
             <p className="text-blue-200/80 font-bold text-sm tracking-wide">Design a dedicated academic space for your students.</p>
          </div>
          <div className="p-10 space-y-8 bg-white">
            <div className="space-y-4">
              <Label className="uppercase text-[11px] font-black text-slate-400 tracking-[0.2em] ml-1">Identify Class / Subject</Label>
              <Input placeholder="e.g. Physics Grade 10" className="h-16 rounded-3xl font-bold bg-slate-50 border-slate-100 focus:ring-4 ring-blue-50" value={newClass.name} onChange={e=>setNewClass({...newClass, name: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <Label className="uppercase text-[11px] font-black text-slate-400 tracking-[0.2em] ml-1">Grade Level</Label>
                <Input placeholder="e.g. Year 11" className="h-16 rounded-3xl font-bold bg-slate-50 border-slate-100" value={newClass.grade} onChange={e=>setNewClass({...newClass, grade: e.target.value})} />
              </div>
              <div className="space-y-4">
                <Label className="uppercase text-[11px] font-black text-slate-400 tracking-[0.2em] ml-1">Section/Arm</Label>
                <Input placeholder="Optional Section" className="h-16 rounded-3xl font-bold bg-slate-50 border-slate-100" value={newClass.section} onChange={e=>setNewClass({...newClass, section: e.target.value})} />
              </div>
            </div>
          </div>
          <div className="p-10 bg-slate-50 border-t border-slate-100">
            <button disabled={isSaving} onClick={handleAddClass} className="w-full h-16 bg-[#1e3a8a] text-white rounded-3xl font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 shadow-xl shadow-blue-900/20 active:scale-95 transition-all disabled:opacity-50">
              {isSaving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />} Initialize Academic Environment
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── MANAGE STUDENTS DIALOG ── UNIFIED ENROLLMENT SYSTEM */}
      <Dialog open={isManageStudentsOpen} onOpenChange={setIsManageStudentsOpen}>
        <DialogContent className="sm:max-w-[720px] rounded-[4rem] max-h-[95vh] flex flex-col p-2 bg-[#f8fafc] border-none shadow-3xl">
          <div className="p-10 pb-0 bg-transparent">
            <DialogHeader>
              <DialogTitle className="text-4xl font-black text-slate-900 flex items-center gap-4">
                 <div className="w-14 h-14 bg-white rounded-3xl shadow-xl flex items-center justify-center -rotate-3"><Users className="w-7 h-7 text-blue-600" /></div>
                 {selectedClass?.name} Roster
              </DialogTitle>
              <DialogDescription className="text-slate-400 font-bold mt-2 uppercase tracking-widest text-xs">Lifecycle Management: Enrolling & Onboarding Candidates</DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="flex-1 overflow-y-auto p-10 space-y-12 bg-transparent custom-scrollbar">
            
            {/* ── GLOBAL SEARCH & ASSIGN ── */}
            <div className="space-y-6">
               <div className="flex justify-between items-center">
                  <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-3">
                     <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" /> Add from Global Registry
                  </h4>
                  {existSearch && <button onClick={()=>setExistSearch("")} className="text-[9px] font-black uppercase text-blue-500 hover:text-blue-700">Clear Search</button>}
               </div>
               <div className="relative group">
                  <Input 
                    placeholder="Search by name or email from all registered students..." 
                    className="h-16 rounded-[2rem] bg-white border-none shadow-xl shadow-slate-200/50 pl-14 transition-all focus:ring-4 ring-blue-100" 
                    value={existSearch} 
                    onChange={e => setExistSearch(e.target.value)} 
                  />
                  <Search className="w-5 h-5 absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-hover:text-blue-400 transition-colors" />
               </div>
               
               <div className="space-y-3 animate-in fade-in duration-300">
                  {searchCandidates.length > 0 ? (
                    <>
                      {!existSearch && <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2">Recently Registered (Available Scholars)</p>}
                      {searchCandidates.map(s => (
                        <div key={s.id} className="p-6 bg-white border border-blue-50/50 rounded-3xl flex items-center justify-between shadow-xl shadow-slate-100 hover:border-blue-200 transition-all group/item">
                           <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover/item:bg-blue-50 group-hover/item:text-blue-500 transition-all font-black text-xs">
                                 {s.initials || s.name.substring(0,2).toUpperCase()}
                              </div>
                              <div>
                                 <p className="font-black text-slate-800 text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] sm:max-w-none">{s.name}</p>
                                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{s.email}</p>
                              </div>
                           </div>
                           <div className="flex items-center gap-3">
                              {s.status === "Active" && <ShieldCheck className="w-4 h-4 text-emerald-500" />}
                              <button 
                                onClick={() => handleAssignExisting(s)}
                                disabled={isSaving}
                                className="px-6 py-3 bg-[#1e3a8a] text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-900 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                              >
                                 Assign Now
                              </button>
                           </div>
                        </div>
                      ))}
                    </>
                  ) : existSearch ? (
                    <div className="p-10 text-center bg-white/50 border border-dashed border-slate-200 rounded-3xl">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No matching scholar found in global registry</p>
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-blue-50/30 border border-dashed border-blue-100 rounded-3xl">
                       <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-relaxed">Global Registry is currently empty or all scholars are already in this class.</p>
                    </div>
                  )}
               </div>
            </div>

            {/* QUICK ENROLL NEW */}
            <div className="p-10 bg-white border border-slate-100 rounded-[3.5rem] shadow-2xl shadow-slate-200/40 relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-[4rem] pointer-events-none -mr-10 -mt-10 group-hover:bg-emerald-100 transition-colors duration-500"></div>
               <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-[0.2em] mb-8 relative z-10 flex items-center gap-2">
                  <Plus className="w-3 h-3 text-emerald-500"/> Direct Invitation Protocol
               </h4>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 relative z-10">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Legal Name</Label>
                    <Input placeholder="Full Name" className="h-14 rounded-2xl bg-slate-50 border-none font-bold placeholder:text-slate-300" value={newStudent.name} onChange={e=>setNewStudent({...newStudent, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Verified Email Address</Label>
                    <Input placeholder="Parent Email" type="email" className="h-14 rounded-2xl bg-slate-50 border-none font-bold placeholder:text-slate-300" value={newStudent.email} onChange={e=>setNewStudent({...newStudent, email: e.target.value})} />
                  </div>
               </div>
               <button onClick={handleAddStudent} disabled={isSaving} className="w-full mt-8 py-5 bg-emerald-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 active:scale-95 disabled:opacity-50 transition-all">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Enroll & Transmit Invite
               </button>
            </div>

            {/* ACTIVE ROSTER */}
            <div className="space-y-6 pb-4">
              <div className="flex justify-between items-center bg-transparent">
                <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" /> Live Class Population
                </h4>
                <div className="px-4 py-1.5 bg-blue-100/50 border border-blue-100 rounded-full">
                   <p className="text-[10px] font-black text-[#1e3a8a]">{currentRoster.length} Members</p>
                </div>
              </div>
              
              <div className="space-y-4">
                {currentRoster.map((e) => {
                  const s = allStudents.find(stu => stu.email === e.studentEmail);
                  const isGlobalActive = s?.status === "Active";
                  return (
                    <div key={e.id} className="flex items-center justify-between p-6 bg-white rounded-3xl shadow-lg shadow-slate-100 hover:shadow-xl transition-all border border-slate-50 group/row">
                      <div className="flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-sm shadow-inner transition-colors duration-500 ${isGlobalActive ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                          {e.studentName.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-black text-slate-800 text-base flex items-center gap-2">
                             {e.studentName}
                             {isGlobalActive && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Active in system" />}
                          </p>
                          <p className="text-[11px] font-bold text-slate-400 mt-0.5">{e.studentEmail}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.15em] border ${
                           isGlobalActive 
                            ? 'bg-emerald-50 border-emerald-100 text-emerald-600' 
                            : 'bg-indigo-50 border-indigo-100 text-[#4f46e5]'
                        }`}>
                          {isGlobalActive ? 'Active Member' : 'Invitation Sent'}
                        </div>
                        <button onClick={() => unenrollStudent(e.id)} className="p-3 bg-red-50 text-red-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl opacity-0 group-hover/row:opacity-100 transition-all">
                           <X className="w-5 h-5"/>
                        </button>
                      </div>
                    </div>
                  );
                })}
                {currentRoster.length === 0 && (
                  <div className="py-24 text-center bg-white/40 border-2 border-dashed border-slate-100 rounded-[3.5rem]">
                    <Users className="w-16 h-16 text-slate-100 mx-auto mb-6" />
                    <p className="text-sm font-black text-slate-300 uppercase tracking-[0.3em]">Environment Inactive: Roster is Vacant</p>
                    <p className="text-[10px] text-slate-300 font-bold mt-2 italic px-20">Start by recruiting existing scholars or transmitting new invitations above.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="p-10 pt-4 bg-white border-t border-slate-100 mt-auto shadow-2xl relative z-20">
            <button onClick={() => setIsManageStudentsOpen(false)} className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-slate-800 transition-all active:scale-95">Roster Audit Complete</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyClasses;
