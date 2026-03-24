import { useState, useEffect, useRef } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, addDoc,
  serverTimestamp, deleteDoc, doc, updateDoc, getDocs
} from "firebase/firestore";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Search, Loader2, UserPlus, Trash2, Edit,
  MoreVertical, BrainCircuit, FileSpreadsheet,
  Upload, X, CheckCircle, Sparkles, Users, CheckCircle2
} from "lucide-react";
import { sendEmail } from "../lib/resend";
import { AIController } from "../ai/controller/ai-controller";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BulkStudent {
  name: string;
  email: string;
  grade: string;
  section: string;
  _status?: "pending" | "success" | "error" | "duplicate";
  _error?: string;
}

const statusStyles: Record<string, string> = {
  Active:   "bg-emerald-100 text-emerald-700 font-black",
  Invited:  "bg-blue-100 text-blue-700 font-black",
  "At Risk":"bg-rose-100 text-rose-700 font-black",
};

// ─── Component ────────────────────────────────────────────────────────────────
const Students = () => {
  const { teacherData } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── State ──────────────────────────────────────────────────────────────────
  const [students, setStudents]               = useState<any[]>([]);
  const [enrollments, setEnrollments]         = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [isInviteOpen, setIsInviteOpen]       = useState(false);
  const [isEditOpen, setIsEditOpen]           = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen]           = useState(false);
  const [studentToEdit, setStudentToEdit]     = useState<any | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<any | null>(null);
  const [isSending, setIsSending]             = useState(false);
  const [searchTerm, setSearchTerm]           = useState("");
  const [isGeneratingSummaries, setIsGeneratingSummaries] = useState(false);
  const [aiSummaries, setAiSummaries]         = useState<any>({});

  // Bulk state
  const [bulkData, setBulkData]               = useState<BulkStudent[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkDone, setBulkDone]               = useState(false);

  const [inviteForm, setInviteForm] = useState({ name: "", email: "", grade: "", section: "" });
  const [editForm, setEditForm]     = useState({ name: "", email: "", grade: "", section: "" });

  // 1. Fetch Teacher's Enrollments
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsubEnroll = onSnapshot(q, (enrollSnap) => {
      const enrollList = enrollSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEnrollments(enrollList);
    });
    return () => unsubEnroll();
  }, [teacherData?.id]);

  // 2. Fetch Global Students referenced by enrollments
  useEffect(() => {
    if (enrollments.length === 0) {
      setStudents([]);
      return;
    }
    const q = query(collection(db, "students"));
    const unsubStudents = onSnapshot(q, (snap) => {
      const allStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const uniqueEmails = [...new Set(enrollments.map(e => (e as any).studentEmail))];
      const colors = ["bg-[#3b82f6]","bg-[#22c55e]","bg-[#f59e0b]","bg-[#ef4444]","bg-[#8b5cf6]","bg-[#ec4899]"];
      
      const teacherStudents = uniqueEmails.map((email, idx) => {
        const studentInfo = allStudents.find(s => (s as any).email === email);
        const studentEnrollments = enrollments.filter(e => (e as any).studentEmail === email);
        
        return {
          id: studentInfo?.id || (email as string),
          name: (studentInfo as any)?.name || (studentEnrollments[0] as any).studentName,
          email: email,
          status: (studentInfo as any)?.status || "Invited",
          grade: studentEnrollments.map(e => (e as any).className).join(", "),
          rawGrades: studentEnrollments.map(e => (e as any).className),
          initials: ((studentInfo as any)?.name || (studentEnrollments[0] as any).studentName).substring(0,2).toUpperCase(),
          color: colors[idx % colors.length]
        };
      });
      setStudents(teacherStudents);
    });
    return () => unsubStudents();
  }, [enrollments]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteForm.name || !inviteForm.email) return toast.error("Name and email are required");
    setIsSending(true);
    try {
      const email = inviteForm.email.toLowerCase();
      const q = query(collection(db, "students"), where("email", "==", email));
      const snap = await getDocs(q);
      let sId = snap.empty ? null : snap.docs[0].id;
      
      if (!sId) {
        const docRef = await addDoc(collection(db, "students"), {
          name: inviteForm.name,
          email: email,
          status: "Invited",
          teacherId: teacherData.id,
          createdAt: serverTimestamp()
        });
        sId = docRef.id;
      }

      await addDoc(collection(db, "enrollments"), {
        studentEmail: email,
        studentName: inviteForm.name,
        studentId: sId,
        className: inviteForm.grade || "General",
        teacherId: teacherData.id,
        status: "Invited",
        enrolledAt: serverTimestamp()
      });

      await sendEmail({
        to: email,
        subject: "Class Invitation",
        html: `<p>Hello ${inviteForm.name}, you are invited to join the class: ${inviteForm.grade || 'General'}.</p>`
      });

      toast.success("Invitation sent successfully!");
      setIsInviteOpen(false);
      setInviteForm({ name: "", email: "", grade: "", section: "" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async () => {
    if (!studentToDelete) return;
    try {
      const q = query(
        collection(db, "enrollments"), 
        where("teacherId", "==", teacherData.id),
        where("studentEmail", "==", studentToDelete.email)
      );
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map(d => deleteDoc(doc(db, "enrollments", d.id)));
      await Promise.all(deletePromises);
      
      toast.success("Student removed from your list");
      setIsDeleteAlertOpen(false);
    } catch (e) {
      toast.error("Failed to delete.");
    }
  };

  const handleEdit = async () => {
    if (!studentToEdit) return;
    try {
      const studentRef = doc(db, "students", studentToEdit.id);
      await updateDoc(studentRef, { name: editForm.name });
      
      const q = query(collection(db, "enrollments"), where("studentEmail", "==", studentToEdit.email));
      const snap = await getDocs(q);
      const updatePromises = snap.docs.map(d => updateDoc(doc(db, "enrollments", d.id), { studentName: editForm.name }));
      await Promise.all(updatePromises);

      toast.success("Student updated");
      setIsEditOpen(false);
    } catch (e) {
      toast.error("Update failed.");
    }
  };

  const exportStudents = () => {
    const data = students.map(s => ({
      Name: s.name,
      Email: s.email,
      Classes: s.grade,
      Status: s.status
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "StudentRoster.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      setBulkData(data.map((row: any) => ({
        name: row.Name || row.name || "",
        email: row.Email || row.email || "",
        grade: row.Grade || row.grade || "",
        section: row.Section || row.section || ""
      })));
      setIsBulkOpen(true);
    };
    reader.readAsBinaryString(file);
  };

  const processBulk = async () => {
    setIsBulkProcessing(true);
    const updated = [...bulkData];
    for (let i = 0; i < updated.length; i++) {
      try {
        const student = updated[i];
        const email = student.email.toLowerCase();
        
        const q = query(collection(db, "students"), where("email", "==", email));
        const snap = await getDocs(q);
        let sId = snap.empty ? null : snap.docs[0].id;
        if (!sId) {
          const docRef = await addDoc(collection(db, "students"), {
            name: student.name,
            email: email,
            status: "Invited",
            teacherId: teacherData.id,
            createdAt: serverTimestamp()
          });
          sId = docRef.id;
        }

        const qE = query(collection(db, "enrollments"), 
          where("teacherId", "==", teacherData.id),
          where("studentEmail", "==", email),
          where("className", "==", student.grade || "General")
        );
        const snapE = await getDocs(qE);
        
        if (snapE.empty) {
          await addDoc(collection(db, "enrollments"), {
            studentEmail: email,
            studentName: student.name,
            studentId: sId,
            className: student.grade || "General",
            teacherId: teacherData.id,
            status: "Invited",
            enrolledAt: serverTimestamp()
          });
          updated[i]._status = "success";
        } else {
          updated[i]._status = "duplicate";
        }
      } catch (err: any) {
        updated[i]._status = "error";
        updated[i]._error = err.message;
      }
      setBulkData([...updated]);
    }
    setIsBulkProcessing(false);
    setBulkDone(true);
  };

  const generateSummaries = async () => {
    setIsGeneratingSummaries(true);
    try {
      const results: any = {};
      for (const s of students) {
         const insight = await AIController.getStudentAnalytics({ name: s.name, grade: s.grade });
         results[s.id] = insight.data;
      }
      setAiSummaries(results);
    } catch (e) {
      toast.error("AI Insight failed.");
    } finally {
      setIsGeneratingSummaries(false);
    }
  };

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.grade.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Scholar Registry</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">Cross-Class Enrollment Management</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={exportStudents} className="px-5 py-3 rounded-2xl bg-slate-50 border border-slate-100 text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="px-5 py-3 rounded-2xl bg-slate-50 border border-slate-100 text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600" /> Import
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
          
          <button onClick={() => setIsInviteOpen(true)} className="bg-[#1e3a8a] text-white px-8 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-blue-900/20 hover:scale-105 transition-all flex items-center gap-2 whitespace-nowrap">
            <UserPlus className="w-5 h-5" /> Enroll Student
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-50 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
         <div className="relative w-full md:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search by name, email or class..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 h-14 rounded-2xl bg-slate-50 border-none font-bold placeholder:text-slate-300"
            />
         </div>
         <button 
           onClick={generateSummaries}
           disabled={isGeneratingSummaries}
           className="px-6 py-4 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2"
          >
           {isGeneratingSummaries ? <Loader2 className="w-4 h-4 animate-spin"/> : <BrainCircuit className="w-4 h-4"/>}
           Generate AI Analytics
         </button>
      </div>

      {students.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem] text-center px-6">
           <Users className="w-20 h-20 text-slate-100 mb-6" />
           <h2 className="text-xl font-black text-slate-800 mb-2">Registry Inactive</h2>
           <p className="text-sm font-bold text-slate-400 max-w-sm uppercase tracking-tight leading-relaxed mb-8">
             No scholars are currently enrolled in your curriculum. Start by enrolling or importing a roster.
           </p>
           <button onClick={() => setIsInviteOpen(true)} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] shadow-lg">Begin Enrollment</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStudents.map((stu) => (
            <div key={stu.id} className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
               <div className={`absolute top-6 right-6 px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${statusStyles[stu.status] || 'bg-slate-100 text-slate-600'}`}>
                 {stu.status}
               </div>

               <div className="flex items-start gap-5 mb-8">
                  <div className={`w-16 h-16 rounded-2xl ${stu.color} text-white flex items-center justify-center text-xl font-black shadow-lg rotate-3 group-hover:rotate-0 transition-transform`}>
                    {stu.initials}
                  </div>
                  <div className="pt-1">
                    <h3 className="text-xl font-black text-slate-900 group-hover:text-[#1e3a8a] transition-colors">{stu.name}</h3>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-1">{stu.grade}</p>
                  </div>
               </div>

               <div className="space-y-4 mb-8">
                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Academic Health</p>
                    <div className="flex items-center gap-3">
                       <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${stu.status === 'At Risk' ? 'bg-rose-500 w-[45%]' : 'bg-emerald-500 w-[88%]'}`} />
                       </div>
                       <span className={`font-black text-[10px] ${stu.status === 'At Risk' ? 'text-rose-500' : 'text-emerald-500'}`}>
                         {stu.status === 'At Risk' ? '45%' : '88%'}
                       </span>
                    </div>
                  </div>
                  {aiSummaries[stu.id] && (
                    <div className="p-4 bg-indigo-50/30 rounded-2xl border border-indigo-50 animate-in slide-in-from-bottom-2">
                       <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3"/> AI Sentiment</p>
                       <p className="text-xs font-bold text-slate-600 italic leading-relaxed">"{aiSummaries[stu.id]?.note}"</p>
                    </div>
                  )}
               </div>

               <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedStudent(stu)} className="flex-1 h-14 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg hover:bg-[#1e3a8a] transition-all transform active:scale-95">Dive Deep Analytics</button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center hover:bg-slate-100 transition-colors">
                      <MoreVertical className="w-5 h-5 text-slate-400" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-2xl p-2 bg-white shadow-2xl border border-slate-50">
                      <DropdownMenuItem onClick={() => { setStudentToEdit(stu); setEditForm({ name: stu.name, email: stu.email, grade: stu.grade, section: "" }); setIsEditOpen(true); }} className="rounded-xl font-bold text-sm h-11 flex items-center gap-3"><Edit className="w-4 h-4"/> Edit Profile</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setStudentToDelete(stu); setIsDeleteAlertOpen(true); }} className="rounded-xl font-bold text-sm h-11 flex items-center gap-3 text-rose-500"><Trash2 className="w-4 h-4"/> Remove From Class</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
               </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[480px] rounded-[3rem] p-0 overflow-hidden border-none text-left">
          <div className="bg-[#1e3a8a] p-10 text-white text-center">
             <div className="w-16 h-16 bg-white/10 rounded-3xl flex items-center justify-center mx-auto mb-6"><UserPlus className="w-8 h-8"/></div>
             <DialogTitle className="text-3xl font-black tracking-tight mb-2">Enroll New Scholar</DialogTitle>
             <p className="text-blue-200/80 font-bold text-xs uppercase tracking-widest">Global Registration Interface</p>
          </div>
          <div className="p-10 space-y-6">
            <div className="space-y-4 text-left">
               <Label className="uppercase text-[10px] font-black text-slate-400 tracking-widest ml-1">Full Legal Name</Label>
               <Input placeholder="Enter student's name" className="h-14 rounded-2xl bg-slate-50 border-none font-bold" value={inviteForm.name} onChange={e=>setInviteForm({...inviteForm, name: e.target.value})} />
            </div>
            <div className="space-y-4 text-left">
               <Label className="uppercase text-[10px] font-black text-slate-400 tracking-widest ml-1">Parent/Student Email</Label>
               <Input placeholder="Searchable globally" className="h-14 rounded-2xl bg-slate-50 border-none font-bold" value={inviteForm.email} onChange={e=>setInviteForm({...inviteForm, email: e.target.value})} />
            </div>
          </div>
          <DialogFooter className="p-10 pt-0">
            <button disabled={isSending} onClick={handleInvite} className="w-full h-16 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-[#1e3a8a] transition-all disabled:opacity-50 active:scale-95 shadow-xl">
               {isSending ? <Loader2 className="w-6 h-6 animate-spin"/> : <CheckCircle2 className="w-6 h-6"/>} Finalize Enrollment
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-[3rem] text-left">
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-black text-slate-900">Modify Scholar Profile</DialogTitle>
            <DialogDescription>Updating global record for {studentToEdit?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2 text-left">
              <Label className="uppercase text-[10px] font-black text-slate-400 tracking-widest">Full Name</Label>
              <Input className="h-14 rounded-2xl font-bold bg-slate-50" value={editForm.name} onChange={e=>setEditForm({...editForm, name: e.target.value})} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={handleEdit} className="w-full h-14 bg-[#1e3a8a] text-white rounded-2xl font-black uppercase tracking-widest">Update Profile</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent className="rounded-[3rem] text-left">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-2xl font-black">Unenroll Scholar?</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-slate-500">
               This will remove the student from your academic roster. Their global profile and data in other classes remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-14 rounded-2xl uppercase text-[10px] font-black tracking-widest">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-14 rounded-2xl bg-rose-500 hover:bg-rose-600 uppercase text-[10px] font-black tracking-widest">Unenroll Pupil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
        <DialogContent className="sm:max-w-[800px] rounded-[3rem] max-h-[85vh] flex flex-col text-left">
          <DialogHeader className="p-6 text-left">
            <DialogTitle className="text-3xl font-black flex items-center gap-3"><Upload className="w-8 h-8 text-blue-600"/> Bulk Enrollment Engine</DialogTitle>
            <DialogDescription className="font-bold mt-2">Parsed {bulkData.length} records. Initializing verification.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 space-y-4">
             {bulkData.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
                   <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center font-black text-xs text-slate-400">{s.name.substring(0,2).toUpperCase()}</div>
                      <div>
                         <p className="font-black text-sm text-slate-800">{s.name}</p>
                         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.email}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-4">
                      <p className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest">{s.grade}</p>
                      {s._status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {s._status === 'duplicate' && <p className="text-[9px] font-black text-amber-500 uppercase">Already Regd</p>}
                      {s._status === 'error' && <p className="text-[9px] font-black text-rose-500 uppercase" title={s._error}>Fail</p>}
                   </div>
                </div>
             ))}
          </div>
          <DialogFooter className="p-6 border-t border-slate-50">
             {!bulkDone ? (
                <button onClick={processBulk} disabled={isBulkProcessing} className="w-full h-16 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 disabled:opacity-50 transition-all shadow-xl">
                   {isBulkProcessing ? <Loader2 className="w-6 h-6 animate-spin"/> : <CheckCircle2 className="w-6 h-6"/>} Initiate Bulk Processing
                </button>
             ) : (
                <button onClick={() => setIsBulkOpen(false)} className="w-full h-16 bg-emerald-600 text-white rounded-3xl font-black uppercase tracking-[0.2em]">Batch Processing Completed</button>
             )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {selectedStudent && (
        <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />
      )}
    </div>
  );
};

export default Students;
