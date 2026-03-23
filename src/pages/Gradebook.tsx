import React, { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, getDocs, where } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { 
  Loader2, Search, FileSpreadsheet, Award, 
  BarChart3, Info, ChevronDown, GraduationCap 
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface StudentGrade {
  id: string;
  name: string;
  initials: string;
  hw1: number;
  hw2: number;
  hw3: number;
  q1: number;
  q2: number;
  ut1: number;
  ut2: number;
  mid: number;
  proj: number;
  total: number;
  grade: string;
}

const headers = ["HW1", "HW2", "HW3", "Quiz1", "Quiz2", "UT1", "UT2", "Mid", "Proj"];

const gradeColor = (grade: string) => {
  if (grade === "A+" || grade === "A") return "text-emerald-500";
  if (grade === "B") return "text-blue-500";
  if (grade === "C") return "text-amber-500";
  return "text-rose-500";
};

const getGrade = (total: number) => {
  const pct = (total / 330) * 100;
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
};

interface ClassData {
  id: string;
  name: string;
  [key: string]: any;
}

const Gradebook = () => {
  const { teacherData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClassName, setSelectedClassName] = useState<string>("");
  const [students, setStudents] = useState<StudentGrade[]>([]);
  const [search, setSearch] = useState("");
  const [classAvgs, setClassAvgs] = useState<any>({});

  // 1. Fetch Classes for this teacher
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const classList = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ClassData);
      setClasses(classList);
      if (classList.length > 0 && !selectedClassName) {
        setSelectedClassName(classList[0].name);
      } else if (classList.length === 0) {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [teacherData?.id, selectedClassName]);

  // 2. Fetch Students and Grades for the selected class
  useEffect(() => {
    if (!teacherData?.id || !selectedClassName) return;
    setLoading(true);

    const q = query(
      collection(db, "students"), 
      where("teacherId", "==", teacherData.id),
      where("grade", "==", selectedClassName)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const gradesSnap = await getDocs(collection(db, "grades"));
      const allGrades = gradesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const data: StudentGrade[] = snapshot.docs.map(doc => {
        const s = doc.data();
        const g: any = allGrades.find((grade: any) => grade.studentId === doc.id) || {};
        
        const row = {
          id: doc.id,
          name: s.name,
          initials: s.name?.substring(0,2).toUpperCase() || "ST",
          hw1: g.hw1 || 0,
          hw2: g.hw2 || 0,
          hw3: g.hw3 || 0,
          q1: g.q1 || 0,
          q2: g.q2 || 0,
          ut1: g.ut1 || 0,
          ut2: g.ut2 || 0,
          mid: g.mid || 0,
          proj: g.proj || 0,
          total: 0,
          grade: ""
        };

        row.total = row.hw1 + row.hw2 + row.hw3 + row.q1 + row.q2 + row.ut1 + row.ut2 + row.mid + row.proj;
        row.grade = getGrade(row.total);
        return row;
      });

      setStudents(data);

      if (data.length > 0) {
        const avgs: any = {};
        const keys = ["hw1", "hw2", "hw3", "q1", "q2", "ut1", "ut2", "mid", "proj", "total"];
        keys.forEach(k => {
          const sum = data.reduce((acc, curr: any) => acc + (curr[k as keyof StudentGrade] as number), 0);
          avgs[k] = (sum / data.length).toFixed(1);
        });
        avgs.grade = getGrade(parseFloat(avgs.total));
        setClassAvgs(avgs);
      } else {
        setClassAvgs({});
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [teacherData?.id, selectedClassName]);

  const filtered = students.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-6">
        <div>
          <h1 className="text-3xl font-black text-foreground">Gradebook Central</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Master Academic Roster</p>
            {classes.length > 0 && (
              <Select value={selectedClassName} onValueChange={setSelectedClassName}>
                <SelectTrigger className="w-[200px] h-8 rounded-lg bg-blue-50 border-blue-100 text-[#1e3a8a] text-[10px] font-black uppercase tracking-widest py-0">
                  <SelectValue placeholder="Select Class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => (
                    <SelectItem key={c.id} value={c.name} className="text-[10px] font-black uppercase tracking-widest">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search scholar..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-11 pr-4 py-3 border-2 border-slate-50 bg-slate-50/50 rounded-2xl text-sm font-bold focus:outline-none focus:border-[#1e3a8a] focus:bg-white transition-all w-64 shadow-inner"
              />
           </div>
           <button className="bg-slate-50 border-2 border-slate-100 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white hover:border-indigo-200 transition-all flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600"/> Export Data
           </button>
        </div>
      </div>

      {loading ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem] shadow-sm">
           <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-4" />
           <p className="text-sm font-black text-[#1e3a8a] uppercase tracking-widest">Analyzing Class Records...</p>
        </div>
      ) : classes.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem] shadow-sm text-center px-6">
           <GraduationCap className="w-20 h-20 text-slate-100 mb-6" />
           <h2 className="text-xl font-black text-slate-800 mb-2 whitespace-nowrap">No Classes Configured</h2>
           <p className="text-sm font-bold text-slate-400 max-w-sm uppercase tracking-tight leading-relaxed mb-6">
             Please define your classes in the "My Classes" section first to start tracking student scores.
           </p>
        </div>
      ) : students.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem] shadow-sm text-center px-6">
           <Award className="w-20 h-20 text-slate-100 mb-6" />
           <h2 className="text-xl font-black text-slate-800 mb-2 whitespace-nowrap">Gradebook is Empty</h2>
           <p className="text-sm font-bold text-slate-400 max-w-sm uppercase tracking-tight leading-relaxed mb-6">
             Selected class "{selectedClassName}" has no students yet. Add students in the roster to see their scores here.
           </p>
        </div>
      ) : (
        <div className="bg-white border-2 border-slate-50 rounded-[3rem] shadow-sm overflow-hidden p-1">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="text-left py-6 px-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Scholars</th>
                  {headers.map((h) => (
                    <th key={h} className="text-center py-6 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                  <th className="text-center py-6 px-6 text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50/30">Total</th>
                  <th className="text-center py-6 px-6 text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50/30 rounded-tr-[2.5rem]">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((s) => {
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="py-5 px-8">
                        <div className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px] font-black shadow-sm">{s.initials}</div>
                           <p className="font-bold text-slate-700 text-sm whitespace-nowrap">{s.name}</p>
                        </div>
                      </td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.hw1}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.hw2}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.hw3}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.q1}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.q2}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.ut1}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.ut2}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.mid}</td>
                      <td className="text-center py-5 px-4 text-sm font-black text-slate-600 italic opacity-80">{s.proj}</td>
                      <td className="text-center py-5 px-6 text-sm font-black bg-indigo-50/20 text-[#1e3a8a]">{s.total}</td>
                      <td className={`text-center py-5 px-6 text-sm font-black bg-indigo-50/20 ${gradeColor(s.grade)}`}>{s.grade}</td>
                    </tr>
                  );
                })}
                {/* Class Average Row */}
                {Object.keys(classAvgs).length > 0 && (
                <tr className="bg-slate-50/80 font-black">
                  <td className="py-6 px-8 text-[11px] font-black text-slate-900 uppercase tracking-widest border-t-2 border-slate-100 flex items-center gap-2">
                     <BarChart3 className="w-4 h-4 text-[#1e3a8a]"/> Class Average
                  </td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.hw1}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.hw2}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.hw3}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.q1}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.q2}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.ut1}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.ut2}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.mid}</td>
                  <td className="text-center py-6 px-4 text-sm text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.proj}</td>
                  <td className="text-center py-6 px-6 text-sm bg-indigo-100 text-[#1e3a8a] border-t-2 border-slate-100">{classAvgs.total}</td>
                  <td className={`text-center py-6 px-6 text-sm bg-indigo-100 border-t-2 border-slate-100 ${gradeColor(classAvgs.grade)}`}>{classAvgs.grade}</td>
                </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-8 px-10 py-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 bg-slate-50/30">
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-md shadow-emerald-100" /> Excellent</div>
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-md shadow-blue-100" /> Standard</div>
            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-md shadow-rose-100" /> Warning</div>
            <div className="ml-auto text-slate-400 italic font-medium flex items-center gap-2">
               <Info className="w-3 h-3"/> Weights: Mid (100) | UT (50) | HW (20) | Quiz (10)
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gradebook;
