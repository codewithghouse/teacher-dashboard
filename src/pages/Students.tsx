import { useState, useEffect } from "react";
import StudentProfile from "@/components/StudentProfile";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Filter, Loader2, UserPlus, Trash2, Edit, MoreVertical } from "lucide-react";
import { sendEmail } from "../lib/resend";

const statusStyles: Record<string, string> = {
  Active: "bg-green-100 text-green-700 font-bold",
  Invited: "bg-blue-100 text-blue-700 font-bold",
  "At Risk": "bg-red-100 text-red-700 font-bold",
};

const Students = () => {
  const { teacherData, user } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<any | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<any | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    grade: "",
    section: ""
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    grade: "",
    section: ""
  });

  const handleOpenInvite = () => {
    setInviteForm({
      name: "",
      email: "",
      grade: teacherData?.classes || "",
      section: ""
    });
    setIsInviteOpen(true);
  };

  const handleOpenEdit = (student: any) => {
    setStudentToEdit(student);
    setEditForm({
      name: student.name || "",
      email: student.email || "",
      grade: student.grade || "",
      section: student.section || ""
    });
    setIsEditOpen(true);
  };

  const handleOpenDelete = (student: any) => {
    setStudentToDelete(student);
    setIsDeleteAlertOpen(true);
  };

  useEffect(() => {
    if (!teacherData?.id) return;

    // Fetch students assigned to THIS teacher
    const q = query(
      collection(db, "students"),
      where("teacherId", "==", teacherData.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const colors = ["bg-[#3b82f6]", "bg-[#22c55e]", "bg-[#f59e0b]", "bg-[#ef4444]", "bg-[#8b5cf6]", "bg-[#ec4899]"];
      const data = snapshot.docs.map((doc, idx) => ({
        id: doc.id,
        ...doc.data(),
        initials: doc.data().name ? doc.data().name.split(' ').map((n: any) => n[0]).join('').toUpperCase() : "S",
        color: colors[idx % colors.length]
      }));
      setStudents(data);
    });

    return () => unsubscribe();
  }, [teacherData?.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.name || !inviteForm.email || !inviteForm.grade) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSending(true);
    try {
      // 1. Save to Firestore
      await addDoc(collection(db, "students"), {
        ...inviteForm,
        email: inviteForm.email.toLowerCase(),
        teacherId: teacherData.id,
        teacherName: teacherData.name,
        schoolId: teacherData.schoolId,
        schoolName: teacherData.schoolName,
        branch: teacherData.branch,
        status: 'Invited',
        createdAt: serverTimestamp()
      });

      // 2. Send Invitation Email
      const parentDashboardUrl = "https://parent-dashboard-ten.vercel.app";
      await sendEmail({
        to: inviteForm.email,
        subject: `Student Invitation: Join ${teacherData.name}'s Class at ${teacherData.schoolName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #1e3a8a;">Welcome to EduIntellect</h2>
            <p>Hello,</p>
            <p><strong>${teacherData.name}</strong> from <strong>${teacherData.schoolName}</strong> has invited your child <strong>${inviteForm.name}</strong> to join their class (${inviteForm.grade} - ${inviteForm.section}).</p>
            <p>Please use your registered Google account (${inviteForm.email}) to access the Parent Dashboard and monitor your child's progress.</p>
            <div style="margin: 30px 0;">
              <a href="${parentDashboardUrl}" style="background-color: #1e3a8a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Access Parent Dashboard</a>
            </div>
            <p style="color: #64748b; font-size: 14px;">If you didn't expect this invitation, please contact the school administration.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="font-size: 12px; color: #94a3b8;">Sent via EduIntellect Learning Management System.</p>
          </div>
        `
      });

      toast.success("Student invited successfully!");
      setIsInviteOpen(false);
      setInviteForm({ name: "", email: "", grade: "", section: "" });
    } catch (error: any) {
      console.error("Invite Error:", error);
      toast.error(error.message || "Failed to invite student");
    } finally {
      setIsSending(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentToEdit) return;

    setIsSending(true);
    try {
      const docRef = doc(db, "students", studentToEdit.id);
      await updateDoc(docRef, {
        ...editForm,
        email: editForm.email.toLowerCase()
      });
      toast.success("Student updated successfully!");
      setIsEditOpen(false);
    } catch (error: any) {
      console.error("Update Error:", error);
      toast.error("Failed to update student");
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async () => {
    if (!studentToDelete) return;

    try {
      await deleteDoc(doc(db, "students", studentToDelete.id));
      toast.success("Student records deleted");
      setIsDeleteAlertOpen(false);
    } catch (error: any) {
      console.error("Delete Error:", error);
      toast.error("Failed to delete records");
    }
  };

  const filteredStudents = students.filter(s => 
    s.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (selectedStudent) {
    return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      {/* Header & Filters */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Students</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1 tracking-tight">View and manage all your assigned students.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              className="border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm bg-card w-[280px] focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 shadow-sm" 
              placeholder="Search by name or email..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={handleOpenInvite}
            className="bg-[#1e3a8a] text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:bg-[#1e4fc0] transition-colors shadow-md flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> Add Student
          </button>
        </div>
      </div>

      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#1e294b]">Invite New Student</DialogTitle>
            <DialogDescription className="text-slate-500 font-medium">
              Enter student details to send an invitation to the parent.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs font-bold uppercase text-slate-500">Student Full Name</Label>
              <Input 
                id="name" 
                placeholder="e.g. Rahul Kumar" 
                className="rounded-xl border-slate-200"
                value={inviteForm.name}
                onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-bold uppercase text-slate-500">Parent Email (for Login)</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="parent@email.com" 
                className="rounded-xl border-slate-200"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-slate-500">Grade / Class</Label>
                <Select onValueChange={(val) => setInviteForm({ ...inviteForm, grade: val })}>
                  <SelectTrigger className="rounded-xl border-slate-200">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"].map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="section" className="text-xs font-bold uppercase text-slate-500">Section</Label>
                <Input 
                  id="section" 
                  placeholder="e.g. A" 
                  className="rounded-xl border-slate-200"
                  value={inviteForm.section}
                  onChange={(e) => setInviteForm({ ...inviteForm, section: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="pt-4">
              <button 
                type="submit" 
                disabled={isSending}
                className="w-full h-12 rounded-xl bg-[#1e3a8a] text-white font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending Invite...
                  </>
                ) : (
                  "Invite Student"
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#1e294b]">Edit Student Details</DialogTitle>
            <DialogDescription className="text-slate-500 font-medium">
              Update information for {studentToEdit?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-xs font-bold uppercase text-slate-500">Student Full Name</Label>
              <Input 
                id="edit-name" 
                className="rounded-xl border-slate-200"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email" className="text-xs font-bold uppercase text-slate-500">Parent Email</Label>
              <Input 
                id="edit-email" 
                type="email" 
                className="rounded-xl border-slate-200"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-slate-500">Grade / Class</Label>
                <Select value={editForm.grade} onValueChange={(val) => setEditForm({ ...editForm, grade: val })}>
                  <SelectTrigger className="rounded-xl border-slate-200">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"].map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-section" className="text-xs font-bold uppercase text-slate-500">Section</Label>
                <Input 
                  id="edit-section" 
                  className="rounded-xl border-slate-200"
                  value={editForm.section}
                  onChange={(e) => setEditForm({ ...editForm, section: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="pt-4">
              <button 
                type="submit" 
                disabled={isSending}
                className="w-full h-12 rounded-xl bg-[#1e3a8a] text-white font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-slate-900">Delete Student Record?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              This will permanently remove <strong>{studentToDelete?.name}</strong> from your roster. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl font-bold">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold"
            >
              Delete Records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Main Student Cards Grid */}
      <div className="bg-white border border-border rounded-2xl p-6 shadow-sm min-h-[400px]">
         {filteredStudents.length > 0 ? (
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
             {filteredStudents.map((s) => (
               <div key={s.id} className="bg-card border border-border rounded-2xl p-6 hover:border-[#1e3a8a]/30 transition-all shadow-sm flex flex-col h-full group relative">
                 <div className="flex justify-between items-start mb-6">
                   <div className={`w-14 h-14 rounded-[1rem] flex items-center justify-center text-white text-xl font-bold shadow-sm ${s.color}`}>
                     {s.initials}
                   </div>
                   <div className="flex flex-col items-end gap-2">
                      <span className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest ${statusStyles[s.status || 'Active']}`}>
                        {s.status || 'Active'}
                      </span>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger className="p-1 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none">
                          <MoreVertical className="w-4 h-4 text-slate-400" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl p-1 shadow-xl border border-slate-100 min-w-[120px]">
                          <DropdownMenuItem 
                            onClick={() => handleOpenEdit(s)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-600 focus:text-primary focus:bg-primary/5 rounded-lg cursor-pointer transition-colors"
                          >
                            <Edit className="w-3.5 h-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleOpenDelete(s)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-red-600 focus:text-red-700 focus:bg-red-50 rounded-lg cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                 
                 <div className="mb-6">
                    <h3 className="font-bold text-foreground text-lg mb-1 truncate">{s.name}</h3>
                    <p className="text-[13px] text-muted-foreground font-bold uppercase tracking-tight">
                      {s.grade} - {s.section || 'N/A'}
                    </p>
                 </div>
                 
                 <div className="space-y-3 mb-8 flex-grow">
                   <div className="flex justify-between items-center text-[12px] font-bold">
                     <span className="text-muted-foreground uppercase tracking-tighter">Attendance</span>
                     <span className="text-green-600">{s.attendance || '95%'}</span>
                   </div>
                   
                   <div className="flex justify-between items-center text-[12px] font-bold">
                     <span className="text-muted-foreground uppercase tracking-tighter">Avg. Score</span>
                     <span className="text-foreground">{s.avgScore || '88%'}</span>
                   </div>

                   <div className="pt-2 border-t border-slate-50">
                     <p className="text-[10px] text-slate-400 font-bold uppercase">Parent Email</p>
                     <p className="text-xs font-semibold text-foreground truncate">{s.email}</p>
                   </div>
                 </div>
                 
                 <button 
                   onClick={() => setSelectedStudent(s)}
                   className="w-full bg-[#1e3a8a] text-white py-3 rounded-xl text-sm font-bold hover:bg-[#1e4fc0] transition-colors shadow-md mt-auto"
                 >
                   View Profile
                 </button>
               </div>
             ))}
           </div>
         ) : (
           <div className="flex flex-col items-center justify-center py-20 text-center">
             <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-300">
               <UserPlus className="w-10 h-10" />
             </div>
             <h3 className="text-xl font-bold text-slate-900">No students found</h3>
             <p className="text-sm text-slate-500 max-w-xs mt-1">
               You haven't added any students yet. Use the "Add Student" button to invite your first student.
             </p>
           </div>
         )}
      </div>
    </div>
  );
};

export default Students;
