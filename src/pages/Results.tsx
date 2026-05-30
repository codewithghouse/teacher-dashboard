/**
 * Results.tsx (teacher-dashboard / K-12) — principal-uploaded result PDFs.
 *
 * Teacher sees results for any class they teach (resolved via
 * teaching_assignments). Per result row: class-wide PDF + collapsible
 * per-student PDF list. Read-only; principals are the only authors.
 *
 * Backend shape locked in [[project-results-module]] memory.
 */
import { useEffect, useMemo, useState } from "react";
import {
  FileText, Download, Calendar as CalendarIcon, Loader2, Users, ChevronRight,
} from "lucide-react";
import { db } from "@/lib/firebase";
import {
  collection, onSnapshot, query, where, orderBy, getDocs, type DocumentData,
} from "firebase/firestore";
import { useAuth } from "@/lib/AuthContext";
import { format } from "date-fns";

interface StudentResult {
  studentId: string;
  studentName: string;
  rollNumber?: string;
  pdfUrl: string;
  pdfName: string;
  pdfSize: number;
}

interface ResultDoc extends DocumentData {
  id: string;
  schoolId: string;
  classId: string;
  className: string;
  section?: string;
  examName: string;
  examType: string;
  academicYear: string;
  term: string;
  examDate?: string;
  classPdfUrl?: string;
  classPdfName?: string;
  classPdfSize?: number;
  studentResults: StudentResult[];
  notes?: string;
  publishedAt?: any;
  status: "draft" | "published";
  visibleToParents: boolean;
}

// Normalise a class label for tolerant matching — lowercase + strip every
// non-alphanumeric char so "10-A", "10 A", "10a" all collapse to "10a".
const norm = (s: any) => (s ?? "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");

interface ClassMeta { name: string; section: string }

export default function Results() {
  const { teacherData } = useAuth();
  const schoolId  = teacherData?.schoolId;
  const teacherId = teacherData?.id;

  const [myClassIds, setMyClassIds] = useState<Set<string>>(new Set());
  // className+section of every class this teacher teaches — used as a tolerant
  // fallback when the result's classId doesn't equal the teaching class's id.
  const [myClassMeta, setMyClassMeta] = useState<ClassMeta[]>([]);
  const [classIdsLoaded, setClassIdsLoaded] = useState(false);
  const [results, setResults] = useState<ResultDoc[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* Resolve this teacher's classIds from THREE sources unioned together —
     mirrors the same 3-flag pattern used by pre-primary's useTeacherClass:
       (1) teaching_assignments (canonical for K-12 dashboards)
       (2) classes.teacherId == teacher.uid (some schools assign directly on
           the class doc rather than via teaching_assignments)
       (3) classes.teacherEmail / classTeacherEmail == teacher.email
           (legacy + invite-by-email flows)
     Without the (2) + (3) fallbacks, any teacher whose principal didn't
     set up teaching_assignments rows saw an empty Results page even though
     they were assigned to a class via the class doc directly. */
  useEffect(() => {
    if (!schoolId || !teacherId) { setClassIdsLoaded(true); return; }
    (async () => {
      const ids = new Set<string>();
      const email = teacherData?.email?.toLowerCase() || "";
      try {
        const [taSnap, classesSnap] = await Promise.all([
          getDocs(query(
            collection(db, "teaching_assignments"),
            where("schoolId",  "==", schoolId),
            where("teacherId", "==", teacherId),
          )),
          getDocs(query(
            collection(db, "classes"),
            where("schoolId", "==", schoolId),
          )),
        ]);

        // Map every class doc by id so we can resolve name+section for the
        // classIds that teaching_assignments hand us (those rows carry no name).
        const classById = new Map<string, any>();
        classesSnap.docs.forEach(d => classById.set(d.id, d.data()));

        taSnap.docs.forEach(d => {
          const data = d.data();
          if (data.active === false) return;
          if (data.classId) ids.add(data.classId);
        });

        classesSnap.docs.forEach(d => {
          const data = d.data() as any;
          if (data.teacherId === teacherId) ids.add(d.id);
          if (email && (
            (data.teacherEmail || "").toLowerCase() === email
            || (data.classTeacherEmail || "").toLowerCase() === email
          )) ids.add(d.id);
        });

        // Build className+section metadata for the resolved class set.
        const meta: ClassMeta[] = [];
        ids.forEach(id => {
          const c = classById.get(id);
          if (c) meta.push({ name: norm(c.name), section: norm(c.section) });
        });

        setMyClassIds(ids);
        setMyClassMeta(meta);
      } catch (err) {
        console.warn("[teacher results] classId resolution failed:", err);
      } finally {
        setClassIdsLoaded(true);
      }
    })();
  }, [schoolId, teacherId, teacherData?.email]);

  // Subscribe to principal_results scoped to this school. Filter by classId
  // client-side so teacher only sees published results for classes they teach.
  useEffect(() => {
    if (!schoolId || !classIdsLoaded) return;
    const q = query(
      collection(db, "principal_results"),
      where("schoolId", "==", schoolId),
      orderBy("publishedAt", "desc"),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as ResultDoc))
        .filter(r => {
          if (r.status !== "published") return false;
          // (a) class-id match (canonical).
          if (myClassIds.has(r.classId)) return true;
          // (b) className + section fallback — survives a result whose classId
          //     doesn't equal the teaching class's id (id drift across setups).
          //     Require section match only when BOTH sides carry a section.
          const rn = norm(r.className), rs = norm(r.section);
          if (rn && myClassMeta.some(c => c.name === rn && (!c.section || !rs || c.section === rs))) return true;
          return false;
        });
      setResults(docs);
      setLoaded(true);
    }, err => {
      console.warn("[teacher results] subscription error:", err);
      setLoaded(true);
    });
    return () => unsub();
  }, [schoolId, classIdsLoaded, myClassIds, myClassMeta]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#1e3a8a] text-white flex items-center justify-center shadow-lg shadow-blue-900/20">
          <FileText className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#1e294b] tracking-tight">Class Results</h1>
          <p className="text-xs text-slate-500 font-medium">
            Exam result PDFs published by the principal for classes you teach.
          </p>
        </div>
      </header>

      {!loaded ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#1e3a8a]" /></div>
      ) : !classIdsLoaded || myClassIds.size === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-500 mb-1">No classes assigned</p>
          <p className="text-xs text-slate-400">Once the principal assigns you to a class, results for that class will appear here.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <FileText className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-500 mb-1">No results published yet</p>
          <p className="text-xs text-slate-400">Results published by the principal will appear here for {myClassIds.size} class{myClassIds.size !== 1 ? "es" : ""} you teach.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map(r => {
            const open = expandedId === r.id;
            return (
              <article key={r.id} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-lg font-bold text-[#1e294b] mb-1">{r.examName}</h2>
                    <p className="text-xs text-slate-500 font-medium">
                      {r.className}{r.section ? ` · ${r.section}` : ""} · {r.academicYear}
                      {r.examDate && ` · Exam ${format(new Date(r.examDate), "MMM d, yyyy")}`}
                    </p>
                  </div>
                  {r.publishedAt?.toDate && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                      <CalendarIcon className="w-3 h-3" /> {format(r.publishedAt.toDate(), "MMM d, yyyy")}
                    </span>
                  )}
                </div>

                {r.notes && (
                  <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-3">📌 {r.notes}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {r.classPdfUrl && (
                    <a href={r.classPdfUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1e3a8a] text-xs font-bold transition-colors">
                      <Download className="w-3.5 h-3.5" /> Class summary PDF
                    </a>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-50 text-slate-600 text-xs font-bold">
                    <Users className="w-3.5 h-3.5" /> {r.studentResults?.length || 0} student PDF{(r.studentResults?.length || 0) !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Collapsible per-student list */}
                {r.studentResults && r.studentResults.length > 0 && (
                  <>
                    <button
                      onClick={() => setExpandedId(open ? null : r.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-[#1e3a8a] transition-colors mt-1"
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} />
                      {open ? "Hide" : "View"} per-student PDFs
                    </button>
                    {open && (
                      <div className="mt-3 max-h-80 overflow-y-auto space-y-1 pr-1 border-t border-slate-100 pt-3">
                        {r.studentResults.map(sr => (
                          <a key={sr.studentId} href={sr.pdfUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                            <span className="text-xs font-medium text-slate-700 truncate">
                              {sr.rollNumber ? <span className="font-bold text-slate-400 mr-1">#{sr.rollNumber}</span> : null}
                              {sr.studentName}
                            </span>
                            <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
