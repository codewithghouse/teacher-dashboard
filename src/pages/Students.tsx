import React, { useState, useEffect } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, getDocs, addDoc, deleteDoc, doc as firestoreDoc } from "firebase/firestore";
import { Search, Loader2, UserPlus, X, Trash2 } from "lucide-react"; // Only Icons here
import { sendEmail } from "../lib/resend";
import { toast } from "sonner";

export default function Students() {
  const { teacherData } = useAuth();
  
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStudentEmail, setNewStudentEmail] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentClassId, setNewStudentClassId] = useState("");
  const [teacherClasses, setTeacherClasses] = useState<any[]>([]);

  // Real Database Fetching
  useEffect(() => {
    if (!teacherData?.id) {
        console.log("Waiting for Teacher Auth Matrix...");
        return;
    }
    
    setLoading(true);
    try {
        const qEnroll = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
        
        const unsubEnroll = onSnapshot(qEnroll, async (snap) => {
            const enrolledDocs = snap.docs.map(d => ({id: d.id, ...d.data()} as any));
            const uniqueMap = new Map();
            
            enrolledDocs.forEach(e => {
                const sid = e.studentId || e.studentEmail;
                if (!uniqueMap.has(sid)) {
                    uniqueMap.set(sid, {
                        id: sid,
                        name: e.studentName,
                        email: e.studentEmail,
                        rollNo: e.rollNo || (800 + Math.floor(Math.random()*100)).toString(),
                        className: e.className,
                        classId: e.classId,
                        initials: e.studentName?.substring(0, 2).toUpperCase() || "ST",
                        attendancePct: 0,
                        avgScorePct: 0,
                        statusTag: "Good" 
                    });
                }
            });

            const studentsArray = Array.from(uniqueMap.values());

            // Bulk fetch related data
            const qScores = query(collection(db, "test_scores"), where("teacherId", "==", teacherData.id));
            const scoresSnap = await getDocs(qScores);
            const scoresData = scoresSnap.docs.map(d => d.data());

            const qAtt = query(collection(db, "attendance"), where("teacherId", "==", teacherData.id));
            const attSnap = await getDocs(qAtt);
            const attData = attSnap.docs.map(d => d.data());

            const final = studentsArray.map(stu => {
                const stuScores = scoresData.filter(s => s.studentId === stu.id);
                let totalPct = 0, count = 0;
                stuScores.forEach(s => { if(!s.isAbsent && s.percentage) { totalPct += s.percentage; count++; } });
                const avg = count > 0 ? (totalPct / count) : 0;

                const stuAtt = attData.filter(a => a.studentId === stu.id || a.studentEmail === stu.email);
                const present = stuAtt.filter(a => a.status?.toLowerCase() === "present" || a.status?.toLowerCase() === "late").length;
                const attPct = stuAtt.length > 0 ? (present / stuAtt.length) * 100 : 100;

                let tag = "Good";
                if (avg < 60 || attPct < 85) tag = "Attention";
                if (avg > 0 && avg < 45) tag = "At Risk";

                return { ...stu, avgScorePct: avg, attendancePct: attPct, statusTag: tag };
            });

            final.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
            setStudents(final);
            setLoading(false);
        });

        const qCls = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
        const unsubCls = onSnapshot(qCls, (snap) => {
           setTeacherClasses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => { unsubEnroll(); unsubCls(); };
    } catch (e) {
        console.error("Matrix Sync Error", e);
    }
  }, [teacherData?.id]);

  const handleDelete = async (student: any) => {
      if (!teacherData?.id) return;
      if (!confirm(`Unenroll ${student.name}?`)) return;
      try {
          const q = query(
              collection(db, "enrollments"), 
              where("teacherId", "==", teacherData.id),
              where("studentEmail", "==", student.email),
              where("classId", "==", student.classId)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
              await deleteDoc(firestoreDoc(db, "enrollments", snap.docs[0].id));
              toast.success("Roster updated.");
          }
      } catch (err) {
          toast.error("Cleanup failed.");
      }
  };

  if (selectedStudent) return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;

  const filtered = students.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) || s.rollNo?.includes(search));
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      <div className="flex flex-col md:flex-row items-center justify-between mb-12 gap-6">
        <div className="text-left w-full">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 font-mono opacity-60">SYSTEM STATUS: "USER_MANAGEMENT_READY"</p>
           <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none italic uppercase">Students</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 md:mt-0">
           <button onClick={() => setShowAddModal(true)} className="bg-[#1e3a8a] text-white px-8 py-3.5 rounded-2xl text-[10px] font-black shadow-2xl shadow-blue-200 uppercase tracking-widest flex items-center gap-3 hover:scale-105 transition-all">
              <UserPlus className="w-5 h-5" /> Add Target
           </button>
           <div className="relative">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
               <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search identifier..." className="w-64 pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:bg-white focus:ring-4 ring-blue-50/50 outline-none transition-all placeholder:text-slate-300 placeholder:font-black tracking-tight" />
           </div>
        </div>
      </div>

      {loading ? (
          <div className="py-40 flex flex-col items-center justify-center">
             <Loader2 className="w-16 h-16 text-[#1e3a8a] animate-spin mb-8 opacity-20" />
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">Syncing Institutional Roster Matrix...</p>
          </div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {paginated.map(student => (
                  <div key={student.id} className="bg-white border border-slate-100 rounded-[2.5rem] p-8 hover:shadow-2xl transition-all flex flex-col group relative overflow-hidden">
                      <div className="flex justify-between items-start mb-8">
                         <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-white text-2xl font-black italic shadow-lg ${['bg-blue-500', 'bg-emerald-500', 'bg-indigo-500', 'bg-purple-500'][Math.abs(student.name.charCodeAt(0)) % 4]}`}>
                            {student.initials}
                         </div>
                         <div className="flex gap-2">
                             <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${student.statusTag === 'Good' ? 'bg-emerald-50 text-emerald-500' : student.statusTag === 'Attention' ? 'bg-amber-50 text-amber-500' : 'bg-rose-50 text-rose-500'}`}>{student.statusTag}</span>
                             <button onClick={(e) => { e.stopPropagation(); handleDelete(student); }} className="w-9 h-9 flex items-center justify-center bg-rose-50 text-rose-400 hover:text-rose-600 rounded-xl transition-all border border-transparent hover:border-rose-100 shadow-sm"><Trash2 className="w-4 h-4"/></button>
                         </div>
                      </div>

                      <h3 className="text-xl font-black text-slate-800 leading-tight mb-1 italic uppercase tracking-tighter">{student.name}</h3>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">Class {student.className} • ID: {student.rollNo}</p>

                      <div className="space-y-4 mb-8 border-t border-slate-50 pt-6">
                          <div className="flex justify-between items-center bg-slate-50/50 p-3 rounded-xl">
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Attendance</span>
                              <span className={`text-xs font-black ${student.attendancePct >= 90 ? 'text-emerald-500' : 'text-amber-500'}`}>{student.attendancePct.toFixed(0)}%</span>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50/50 p-3 rounded-xl">
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Performance</span>
                              <span className="text-xs font-black text-slate-800">{student.avgScorePct > 0 ? `${student.avgScorePct.toFixed(1)}%` : "PENDING"}</span>
                          </div>
                      </div>

                      <button onClick={() => setSelectedStudent(student)} className="w-full bg-slate-900 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-black transition-all shadow-xl shadow-slate-200">View Dossier</button>
                  </div>
              ))}
          </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] p-10 w-full max-w-xl shadow-2xl relative border border-white/20">
             <button onClick={() => setShowAddModal(false)} className="absolute top-8 right-8 w-10 h-10 flex items-center justify-center bg-slate-50 rounded-full text-slate-400 hover:text-slate-800 transition-all"><X className="w-6 h-6"/></button>
             <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic mb-2 uppercase leading-none">Enroll Target</h2>
             <p className="text-[11px] font-black text-slate-400 mb-10 uppercase tracking-[0.2em] opacity-40">System Injection: Phase 3 Student Onboarding</p>
             
             <div className="space-y-6">
                <div>
                   <label className="block text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest mb-2 ml-1">Student / Account Title</label>
                   <input type="text" value={newStudentName} onChange={e => setNewStudentName(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-black text-slate-800 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-inner tracking-tight" placeholder="e.g. Rahul Verma" />
                </div>
                <div>
                   <label className="block text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest mb-2 ml-1">Target Communications (Email)</label>
                   <input type="email" value={newStudentEmail} onChange={e => setNewStudentEmail(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-black text-slate-800 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-inner tracking-tight" placeholder="name@institutional.app" />
                </div>
                <div>
                   <label className="block text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest mb-2 ml-1">Assigned Academic Network (Class)</label>
                   <select value={newStudentClassId} onChange={e => setNewStudentClassId(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-black text-slate-800 focus:bg-white focus:border-indigo-500 outline-none transition-all shadow-inner appearance-none">
                     <option value="" disabled>Select authorized cluster...</option>
                     {teacherClasses.map(cls => (
                       <option key={cls.id} value={cls.id}>{cls.name} {cls.grade ? `(${cls.grade})` : ""}</option>
                     ))}
                   </select>
                </div>
                
                <button 
                  onClick={async () => {
                     if(!newStudentEmail || !newStudentName || !newStudentClassId) return;
                     const targetClass = teacherClasses.find(c => c.id === newStudentClassId);
                     if(!targetClass || !teacherData?.id) return;
                     
                     try {
                        const sid = newStudentEmail.toLowerCase().trim();
                        await addDoc(collection(db, "enrollments"), {
                           teacherId: teacherData.id,
                           teacherName: teacherData.name || "Faculty",
                           schoolId: teacherData.schoolId || "",
                           schoolName: teacherData.schoolName || "",
                           branch: teacherData.branch || "Main",
                           studentEmail: sid,
                           studentName: newStudentName,
                           className: targetClass.name,
                           classId: targetClass.id,
                           status: "Active",
                           enrolledAt: new Date()
                        });
                        
                        const qCheck = query(collection(db, "students"), where("email", "==", sid));
                        const checkSnap = await getDocs(qCheck);
                        if (checkSnap.empty) {
                           await addDoc(collection(db, "students"), {
                               name: newStudentName,
                               email: sid,
                               schoolId: teacherData.schoolId || "",
                               schoolName: teacherData.schoolName || "",
                               branch: teacherData.branch || "Main",
                               classId: targetClass.id,
                               status: "Active",
                               createdAt: new Date()
                           });
                        }

                        try {
                           await sendEmail({
                              to: sid,
                              subject: `Access Provisioned: ${teacherData.schoolName || "Institutional Portal"}`,
                              html: `
                                <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                                  <h2 style="color: #1e3a8a;">Welcome, ${newStudentName}!</h2>
                                  <p>Your institutional access has been provisioned for <strong>${targetClass.name}</strong>.</p>
                                  <p>Instructor: <strong>${teacherData.name || "Faculty Member"}</strong></p>
                                  <div style="margin: 30px 0; text-align: center;">
                                    <a href="https://parent-dashboard-ten.vercel.app/" style="background: #1e3a8a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Login to Secure Portal</a>
                                  </div>
                                </div>
                              `
                           });
                           toast.success("Injection Successful & Invitation Dispatched!");
                        } catch (emailErr) {
                           toast.warning("Registry updated, but email carrier failed.");
                        }

                        setShowAddModal(false);
                        setNewStudentEmail(""); setNewStudentName(""); setNewStudentClassId("");
                     } catch(err) {
                        toast.error("Database Injection Failed.");
                     }
                  }}
                  className="w-full bg-[#1e3a8a] text-white rounded-[1.5rem] py-5 font-black text-[11px] uppercase tracking-[0.3em] mt-8 shadow-2xl shadow-blue-300/30 hover:bg-blue-900 transition-all border-none"
                >
                   Execute Registry Update
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
