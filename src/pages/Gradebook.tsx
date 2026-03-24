import React, { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, where, setDoc, doc, writeBatch, deleteDoc, getDocs } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { 
  Loader2, Search, FileSpreadsheet, Plus, Upload, Check, ChevronRight, Calculator, Trash2, Save
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ClassData {
  id: string;
  name: string;
  [key: string]: any;
}

interface CustomColumn {
  id: string;
  name: string;
  maxMarks: number;
}

const getGrade = (percentage: number) => {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B";
  if (percentage >= 60) return "C";
  if (percentage >= 50) return "D";
  return "F";
};

const gradeColor = (grade: string) => {
  if (grade === "A+" || grade === "A") return "text-emerald-500 bg-emerald-50";
  if (grade === "B") return "text-blue-500 bg-blue-50";
  if (grade === "C") return "text-amber-500 bg-amber-50";
  return "text-rose-500 bg-rose-50";
};

export default function Gradebook() {
  const { teacherData } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  
  const [students, setStudents] = useState<any[]>([]);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [scores, setScores] = useState<Record<string, any>>({}); 
  const [localScores, setLocalScores] = useState<Record<string, any>>({}); // Added for manual edit tracking
  
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColMax, setNewColMax] = useState("100");

  const [saving, setSaving] = useState(false);

  // 1. Fetch Classes
  useEffect(() => {
    if (!teacherData?.id) return;
    const q = query(collection(db, "classes"), where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ClassData);
      setClasses(cls);
      if (cls.length > 0 && !selectedClassId) {
        setSelectedClassId(cls[0].id);
      } else if (cls.length === 0) {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [teacherData?.id, selectedClassId]);

  // 2. Fetch Students, Columns, and Scores for Selected Class
  useEffect(() => {
    if (!teacherData?.id || !selectedClassId) return;
    setLoading(true);

    const selClass = classes.find(c => c.id === selectedClassId);

    // Fetch Enrollments
    const qEnroll = query(collection(db, "enrollments"), where("classId", "==", selectedClassId));
    
    // Fetch Columns
    const qCols = query(collection(db, "gradebook_columns"), where("classId", "==", selectedClassId));
    
    // Fetch Scores
    const qScores = query(collection(db, "gradebook_scores"), where("classId", "==", selectedClassId));

    const unsubCols = onSnapshot(qCols, (colSnap) => {
        const fetchedCols = colSnap.docs.map(d => ({ id: d.id, ...d.data() } as CustomColumn));
        setColumns(fetchedCols.sort((a:any, b:any) => a.createdAt - b.createdAt));
    });

    const unsubScores = onSnapshot(qScores, (scoreSnap) => {
        const fetchedScores: any = {};
        scoreSnap.docs.forEach(d => {
            const data = d.data();
            fetchedScores[`${data.studentId}_${data.columnId}`] = Number(data.mark) || 0;
        });
        setScores(fetchedScores);
        setLocalScores(fetchedScores); // Sync local state
    });

    const unsubStudents = onSnapshot(qEnroll, (snap) => {
        const studs = snap.docs.map(d => {
            const e = d.data();
            return {
                id: e.studentId || d.id,
                name: e.studentName,
                rollNo: e.rollNo || "N/A",
                initials: e.studentName?.substring(0,2).toUpperCase() || "ST"
            };
        });
        const uniqueStuds = Array.from(new Map(studs.map(item => [item.id, item])).values())
                                .sort((a,b) => a.name.localeCompare(b.name));
        setStudents(uniqueStuds);
        setLoading(false);
    });

    return () => { unsubCols(); unsubScores(); unsubStudents(); };
  }, [teacherData?.id, selectedClassId]);

  const handleAddColumn = async () => {
      if (!newColName.trim() || !newColMax) return toast.error("Please fill column details.");
      try {
          const colId = `col_${Date.now()}`;
          await setDoc(doc(db, "gradebook_columns", colId), {
              id: colId,
              classId: selectedClassId,
              teacherId: teacherData.id,
              name: newColName,
              maxMarks: Number(newColMax),
              createdAt: Date.now()
          });
          toast.success("Custom Assessment field added!");
          setShowAddCol(false);
          setNewColName("");
          setNewColMax("100");
      } catch (e) {
          toast.error("Failed to add column");
      }
  };

  const handleDeleteColumn = async (colId: string) => {
      if (!confirm("Are you sure? This will delete the column and all associated marks.")) return;
      try {
          await deleteDoc(doc(db, "gradebook_columns", colId));
          toast.success("Column deleted successfully!");
          
          // Optionally, dispatch a background job to delete associated scores to clean up DB space
          const qScores = query(collection(db, "gradebook_scores"), where("columnId", "==", colId));
          const snap = await getDocs(qScores);
          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();

      } catch (e) {
          toast.error("Failed to delete column");
      }
  };

  const handleLocalScoreChange = (studentId: string, colId: string, value: string) => {
      setLocalScores(prev => ({ ...prev, [`${studentId}_${colId}`]: value }));
  };

  const handleSaveGrades = async () => {
      setSaving(true);
      const batch = writeBatch(db);
      let count = 0;
      
      Object.keys(localScores).forEach(key => {
          const localVal = localScores[key] === "" ? 0 : Number(localScores[key]);
          const originalVal = Number(scores[key] || 0);
          
          if (localScores[key] !== "" && localVal !== originalVal) {
              const matchedCol = columns.find(c => key.endsWith(c.id));
              if (!matchedCol) return;

              const cId = matchedCol.id;
              const sId = key.replace(`_${cId}`, "");
              
              const docRef = doc(db, "gradebook_scores", key);
              batch.set(docRef, {
                  id: key,
                  studentId: sId,
                  columnId: cId,
                  classId: selectedClassId,
                  mark: localVal,
                  updatedAt: Date.now()
              }, { merge: true });
              count++;
          }
      });

      if (count > 0) {
          try {
              await batch.commit();
              toast.success(`Matrix Synced! Saved ${count} record updates.`);
          } catch(e) {
              toast.error("Failed to save changes.");
          }
      } else {
          toast.info("No new modifications detected.");
      }
      setSaving(false);
  };

  // ─── EXCEL IMPORT / EXPORT LOGIC ───

  const exportTemplate = () => {
      if (students.length === 0) return toast.error("No students to export.");
      if (columns.length === 0) return toast.error("Please create at least one custom column first.");

      // Row 1: Headers (Roll No | Student Name | Col1 | Col2 ...)
      const headers = ["Roll No", "Student Name", ...columns.map(c => `${c.name} (Max ${c.maxMarks})`)];
      const data = [headers];

      // Row 2..N: Student Data & existing scores
      students.forEach(s => {
          const row: any[] = [s.rollNo, s.name];
          columns.forEach(c => {
             const key = `${s.id}_${c.id}`;
             row.push(localScores[key] !== undefined ? localScores[key] : ""); // Use localScores for unsaved exports
          });
          data.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gradebook");
      XLSX.writeFile(wb, `${classes.find(c=>c.id===selectedClassId)?.name}_Gradebook.xlsx`);
      toast.success("Template exported! Fill it offline & re-upload.");
  };

  const processImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      toast.info("Analyzing custom spreadsheet...", { duration: 2000 });
      const reader = new FileReader();
      
      reader.onload = async (evt) => {
          try {
              const bstr = evt.target?.result as string;
              const wb = XLSX.read(bstr, { type: "binary" });
              const ws = wb.Sheets[wb.SheetNames[0]];
              
              const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
              if (data.length < 2) return toast.error("Sheet seems empty.");

              const sheetHeaders = data[0] as string[];
              
              const colMapping: {sheetIndex: number, dbColId: string}[] = [];
              
              // Custom Columns: Index 2 onwards (Since 0 is Roll No, 1 is Name)
              for (let i = 2; i < sheetHeaders.length; i++) {
                  const headerName = sheetHeaders[i].split("(")[0].trim().toLowerCase();
                  const matchedDbCol = columns.find(c => c.name.toLowerCase() === headerName);
                  if (matchedDbCol) colMapping.push({ sheetIndex: i, dbColId: matchedDbCol.id });
              }

               if (colMapping.length === 0) {
                    return toast.error("No recognized columns found in the Excel sheet matching this class dashboard.");
               }

              const batch = writeBatch(db);
              let changedCount = 0;

              for (let r = 1; r < data.length; r++) {
                  const row = data[r];
                  const rawRollNo = row[0]?.toString(); 
                  if (!rawRollNo) continue;
                  
                  // Match by Roll No (ignoring case/whitespace for safety)
                  const validStudent = students.find(s => s.rollNo?.toString().trim().toLowerCase() === rawRollNo.trim().toLowerCase());
                  if (!validStudent) continue;

                  colMapping.forEach(map => {
                      const importedMark = row[map.sheetIndex];
                      if (importedMark !== undefined && importedMark !== "" && !isNaN(Number(importedMark))) {
                          const scoreId = `${validStudent.id}_${map.dbColId}`;
                          const docRef = doc(db, "gradebook_scores", scoreId);
                          batch.set(docRef, {
                              id: scoreId,
                              studentId: validStudent.id,
                              columnId: map.dbColId,
                              classId: selectedClassId,
                              mark: Number(importedMark),
                              updatedAt: Date.now()
                          }, { merge: true });
                          changedCount++;
                      }
                  });
              }

              if (changedCount > 0) {
                  await batch.commit();
                  toast.success(`Excel Import Success! Fully synchronized ${changedCount} individual marks.`);
              } else {
                  toast.info("No new marks found to update.");
              }
              
          } catch (err) {
              console.error(err);
              toast.error("Failed to parse the Excel file.");
          } finally {
              if (fileInputRef.current) fileInputRef.current.value = "";
          }
      };
      reader.readAsBinaryString(file);
  };

  // ─── GRAND TOTAL & CALCULATION HELPERS ───
  const getStudentTotals = (sId: string) => {
      let earned = 0;
      let totalMax = 0;
      columns.forEach(col => {
          totalMax += Number(col.maxMarks);
          const val = localScores[`${sId}_${col.id}`];
          if (val !== undefined && val !== "") earned += Number(val);
      });
      const pct = totalMax > 0 ? (earned / totalMax) * 100 : 0;
      return { earned, totalMax, pct, grade: getGrade(pct) };
  };

  // Class Averages
  const classAverages: Record<string, number> = {};
  if (students.length > 0) {
     columns.forEach(col => {
         let sum = 0;
         students.forEach(s => {
             const val = localScores[`${s.id}_${col.id}`];
             if (val !== undefined && val !== "") sum += Number(val);
         });
         classAverages[col.id] = Number((sum / students.length).toFixed(1));
     });
  }

  const filtered = students.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-in fade-in duration-500 pb-20 text-left">
      
      {/* ─── HEADER CONTROLS ─── */}
      <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
         <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 flex items-center gap-2 mb-2">
                <Calculator className="w-3 h-3" /> RESULT OF CLICK: "GRADEBOOK"
            </p>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none mb-4">Gradebook Engine</h1>
            
            {classes.length > 0 && (
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger className="w-[250px] h-12 rounded-xl bg-slate-50 border-none text-[#1e3a8a] text-xs font-black uppercase tracking-widest shadow-inner">
                  <SelectValue placeholder="Select Class Roster" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs font-bold uppercase">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
         </div>

         <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
             <button 
                 onClick={exportTemplate}
                 className="flex-1 md:flex-none uppercase tracking-widest text-[10px] bg-slate-50 border border-slate-200 text-slate-600 px-6 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors shadow-sm"
             >
                 <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Print Template
             </button>
             
             <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="flex-1 md:flex-none uppercase tracking-widest text-[10px] bg-emerald-50 text-emerald-600 px-6 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors shadow-sm border border-emerald-100"
             >
                 <Upload className="w-4 h-4" /> Import Excel
             </button>
             <input type="file" accept=".xlsx,.xls" ref={fileInputRef} className="hidden" onChange={processImport} />

             <button 
                 onClick={() => setShowAddCol(true)}
                 className="flex-1 md:flex-none uppercase tracking-widest text-[10px] bg-white border-2 border-slate-200 text-slate-700 px-6 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
             >
                 <Plus className="w-4 h-4" /> Add Column
             </button>

             <button 
                 onClick={handleSaveGrades}
                 disabled={saving}
                 className="flex-1 md:flex-none uppercase tracking-widest text-[10px] bg-[#1e3a8a] text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-900 transition-all shadow-lg active:scale-95 disabled:opacity-50"
             >
                 {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />} {saving ? "Saving..." : "Save Grades"}
             </button>
         </div>
      </div>

      {showAddCol && (
          <div className="bg-slate-50 border-2 border-indigo-100 rounded-3xl p-6 mb-8 flex flex-col sm:flex-row items-end gap-6 shadow-inner animate-in slide-in-from-top-4">
              <div className="flex-1 w-full">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Custom Field Name</label>
                  <input 
                      type="text" 
                      value={newColName}
                      onChange={e=>setNewColName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-[#1e3a8a]"
                      placeholder="e.g. Weekly Spellings, FA1..." 
                  />
              </div>
              <div className="w-full sm:w-32">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Max Score</label>
                  <input 
                      type="number" 
                      value={newColMax}
                      onChange={e=>setNewColMax(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-[#1e3a8a] text-center"
                      placeholder="100" 
                  />
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                 <button onClick={() => setShowAddCol(false)} className="px-6 py-3 rounded-xl bg-white text-slate-400 font-bold border border-slate-200 hover:bg-slate-100 transition-all text-xs">Cancel</button>
                 <button onClick={handleAddColumn} className="px-6 py-3 rounded-xl bg-indigo-50 text-indigo-600 font-black border border-indigo-100 hover:bg-indigo-100 transition-all uppercase tracking-widest text-[10px] flex items-center gap-2"><Check className="w-4 h-4"/> Confirm</button>
              </div>
          </div>
      )}

      {/* ─── MASTER SPREADSHEET RENDERER ─── */}
      {loading ? (
        <div className="py-32 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-[3rem]">
           <Loader2 className="w-12 h-12 text-[#1e3a8a] animate-spin mb-4" />
           <p className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest">Constructing Matrix...</p>
        </div>
      ) : columns.length === 0 ? (
        <div className="py-24 bg-white border-2 border-dashed border-slate-200 rounded-[3rem] text-center px-6">
           <FileSpreadsheet className="w-16 h-16 text-slate-200 mx-auto mb-6" />
           <h3 className="text-xl font-black text-slate-800 mb-2">Gradebook Engine is Empty</h3>
           <p className="text-sm font-bold text-slate-400 mb-6">Create your first custom assessment field to start building the matrix.</p>
           <button onClick={() => setShowAddCol(true)} className="mx-auto uppercase tracking-widest text-[10px] bg-[#1e3a8a] text-white px-8 py-4 rounded-xl font-black flex items-center gap-2 shadow-sm"><Plus className="w-4 h-4"/> Build First Column</button>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-100/50 overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-max">
                    <thead className="bg-[#f8fafc]">
                        <tr>
                            <th className="px-8 py-5 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] min-w-[250px]">
                                Scholar Profile
                            </th>
                            
                            {/* Render Dynamic Custom Columns */}
                            {columns.map(col => (
                                <th key={col.id} className="px-6 py-5 border-b border-slate-200 text-center relative group min-w-[120px]">
                                    <div className="flex flex-col items-center justify-center">
                                       <div className="flex items-center gap-2">
                                           <p className="text-[10px] font-black text-[#1e3a8a] uppercase tracking-[0.2em]">{col.name}</p>
                                           <button 
                                              onClick={() => handleDeleteColumn(col.id)} 
                                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-rose-50 rounded text-rose-500 hover:bg-rose-100"
                                              title="Delete Column"
                                           >
                                               <Trash2 className="w-3 h-3" />
                                           </button>
                                       </div>
                                       <p className="text-[9px] font-bold text-slate-400 mt-1">/ {col.maxMarks}</p>
                                    </div>
                                </th>
                            ))}

                            <th className="px-6 py-5 border-b border-slate-200 text-center bg-slate-50">
                                <p className="text-[10px] font-black text-slate-800 uppercase tracking-[0.2em]">Matrix Total</p>
                            </th>
                            <th className="px-6 py-5 border-b border-slate-200 text-center bg-indigo-50/50">
                                <p className="text-[10px] font-black text-indigo-800 uppercase tracking-[0.2em]">Final Grade</p>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {students.map(s => {
                            const totals = getStudentTotals(s.id);
                            return (
                                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-8 py-5 bg-white group-hover:bg-slate-50/50 border-r border-slate-50 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] text-white flex items-center justify-center text-xs font-black shadow-sm">
                                                {s.initials}
                                            </div>
                                            <div>
                                                <p className="text-sm font-black text-slate-800">{s.name}</p>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Roll {s.rollNo}</p>
                                            </div>
                                        </div>
                                    </td>
                                    
                                    {columns.map(col => (
                                        <td key={col.id} className="px-6 py-4 text-center border-r border-slate-50 relative">
                                            <input 
                                                type="number"
                                                className={`w-16 h-10 text-center text-sm font-black bg-transparent outline-none focus:bg-white focus:border focus:border-indigo-200 focus:shadow-sm rounded-lg hover:bg-slate-50 transition-all text-slate-700 mx-auto block ${localScores[`${s.id}_${col.id}`] !== (scores[`${s.id}_${col.id}`] || "") ? "bg-amber-50/50 border-amber-200" : ""}`}
                                                value={localScores[`${s.id}_${col.id}`] !== undefined ? localScores[`${s.id}_${col.id}`] : ""}
                                                placeholder="-"
                                                onChange={(e) => handleLocalScoreChange(s.id, col.id, e.target.value)}
                                            />
                                        </td>
                                    ))}

                                    <td className="px-6 py-5 text-center bg-slate-50/30 border-l border-slate-100">
                                        <div className="text-sm font-black text-slate-800">{totals.earned} <span className="text-[10px] text-slate-400">/ {totals.totalMax}</span></div>
                                        <div className="text-[10px] font-bold text-slate-500 mt-1">{totals.pct.toFixed(1)}%</div>
                                    </td>
                                    <td className="px-6 py-5 text-center bg-indigo-50/30 border-l border-slate-100">
                                        <span className={`px-4 py-2 rounded-xl text-xs font-black ${gradeColor(totals.grade)} shadow-sm inline-block min-w-[40px]`}>
                                            {totals.grade}
                                        </span>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                    <tfoot className="bg-[#f8fafc] border-t-2 border-slate-200">
                        <tr>
                            <td className="px-8 py-6 sticky left-0 z-10 bg-[#f8fafc] border-r border-slate-200">
                                <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Class Averages</p>
                            </td>
                            {columns.map(col => (
                                <td key={col.id} className="px-6 py-6 text-center border-r border-slate-200">
                                    <p className="text-xs font-black text-slate-800">{classAverages[col.id] || 0}</p>
                                </td>
                            ))}
                            <td colSpan={2} className="px-6 py-6 text-center">
                                {/* Aggregated average could go here */}
                                <p className="text-[10px] font-bold text-slate-400 italic">Auto-calculated per column matrix</p>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            
            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex items-center justify-center gap-8 flex-wrap">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"/><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Excellent (A+, A)</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"/><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Good (B)</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500"/><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Average (C)</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500"/><span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">At Risk (D, F)</span></div>
            </div>
        </div>
      )}

    </div>
  );
}
