/**
 * PushToGradebookModal — flows AI-corrected marks into `test_scores` so they
 * appear in TestsExams, parent dashboard, principal analytics, owner roll-ups.
 *
 * Flow:
 *   1. Teacher picks Class → Test → Student
 *   2. Marks (auto-filled from correction.marksScored) confirmed
 *   3. Write `test_scores/{testId_studentId}` mirroring EnterScores writer
 *   4. If a paper_corrections doc exists, mark its `status: "pushed_to_gradebook"`
 *
 * Cross-dashboard impact (per cross_dashboard_linking_rule):
 *   - WRITER:  this modal — uses canonical `test_scores` shape from EnterScores.tsx
 *   - READERS: TestsExams, ClassDetail, MyClasses, Students, Dashboard,
 *              ConceptMastery (teacher), parent-dashboard TestsPage,
 *              principal-dashboard TeacherPerformance, owner roll-ups
 *   - All readers tolerate the `source: "ai_paper_correction"` additive field
 *
 * Why this separate from auto-save: paper_corrections is the AI artifact;
 * test_scores is the gradebook score. A teacher may correct 5 mock papers
 * (all saved) but only push the final exam to gradebook. Two-stage flow keeps
 * gradebook clean.
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  type QueryConstraint,
} from "firebase/firestore";
import { Loader2, X, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { auditedSet, auditedUpdate } from "../lib/auditedWrites";

interface ClassRow { id: string; name?: string; grade?: string }
interface TestRow {
  id: string;
  testName?: string;
  title?: string;
  subject?: string;
  topic?: string;
  topics?: string[];
  classId?: string;
  className?: string;
  marks?: string | number;
  testDate?: string;
  category?: string;
}
interface StudentRow { id: string; name?: string; email?: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (testId: string) => void;
  correction: {
    marksScored: number;
    totalMarks: number;
    percentage: number;
    gradeBand: string;
    subject: string;
    studentName: string;
    correctionId: string | null;
  };
}

// Safely strip slashes / dots from doc IDs — same defense as EnterScores.
const safeDocId = (raw: string): string => raw.replace(/[/.]/g, "_");

const PushToGradebookModal: React.FC<Props> = ({ open, onClose, onSaved, correction }) => {
  const { teacherData } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [testsLoading, setTestsLoading] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [classId, setClassId] = useState("");
  const [testId, setTestId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [marks, setMarks] = useState(String(correction.marksScored));
  const [saving, setSaving] = useState(false);

  // Reset whenever modal opens — fresh flow each push.
  useEffect(() => {
    if (!open) return;
    setMarks(String(correction.marksScored));
    setClassId("");
    setTestId("");
    setStudentId("");
    setSaving(false);
  }, [open, correction.marksScored]);

  // Load teacher's classes
  useEffect(() => {
    if (!open || !teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];

    setClassesLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "classes"), ...SC, where("teacherId", "==", teacherData.id)),
      (snap) => {
        const cls = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as ClassRow[];
        setClasses(cls);
        setClassesLoading(false);
      },
      (err) => {
        console.error("[PushToGradebookModal] classes listener failed", err);
        setClassesLoading(false);
      },
    );
    return () => unsub();
  }, [open, teacherData?.id, teacherData?.schoolId]);

  // Load tests for the picked class
  useEffect(() => {
    if (!open || !classId || !teacherData?.schoolId) {
      setTests([]);
      setTestId("");
      return;
    }
    setTestsLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, "tests"),
        where("schoolId", "==", teacherData.schoolId),
        where("classId", "==", classId),
      ),
      (snap) => {
        const ts = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id })) as TestRow[];
        // Sort newest-first by testDate
        ts.sort((a, b) => String(b.testDate || "").localeCompare(String(a.testDate || "")));
        setTests(ts);
        setTestsLoading(false);
      },
      (err) => {
        console.error("[PushToGradebookModal] tests listener failed", err);
        setTestsLoading(false);
      },
    );
    return () => unsub();
  }, [open, classId, teacherData?.schoolId]);

  // Load students enrolled in picked class
  useEffect(() => {
    if (!open || !classId || !teacherData?.schoolId) {
      setStudents([]);
      setStudentId("");
      return;
    }
    setStudentsLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, "enrollments"),
        where("schoolId", "==", teacherData.schoolId),
        where("classId", "==", classId),
      ),
      (snap) => {
        const list: StudentRow[] = snap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: String(data.studentId ?? d.id),
            name: typeof data.studentName === "string" ? data.studentName : "",
            email: typeof data.studentEmail === "string" ? (data.studentEmail as string).toLowerCase() : "",
          };
        });
        // Dedup by studentId in case of multi-class enrollments
        const seen = new Set<string>();
        const dedup = list.filter(s => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        // Sort alphabetically
        dedup.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setStudents(dedup);
        setStudentsLoading(false);
      },
      (err) => {
        console.error("[PushToGradebookModal] students listener failed", err);
        setStudentsLoading(false);
      },
    );
    return () => unsub();
  }, [open, classId, teacherData?.schoolId]);

  const selectedTest = useMemo(() => tests.find(t => t.id === testId), [tests, testId]);
  const selectedStudent = useMemo(() => students.find(s => s.id === studentId), [students, studentId]);

  const handleSave = async () => {
    if (!classId)        return toast.error("Please select a class.");
    if (!testId)         return toast.error("Please select a test.");
    if (!studentId)      return toast.error("Please select a student.");
    if (!teacherData?.id) return toast.error("You are signed out. Please sign in again.");
    const scoreNum = Number(marks);
    if (!Number.isFinite(scoreNum) || scoreNum < 0) {
      return toast.error("Marks must be a valid non-negative number.");
    }
    if (!selectedTest) return toast.error("Selected test could not be loaded.");

    // Test's max score — fall back to correction.totalMarks when test doc is silent.
    const maxScore = Number(selectedTest.marks) || correction.totalMarks || 0;
    if (maxScore <= 0) return toast.error("Test has no max marks defined. Edit the test first.");
    if (scoreNum > maxScore) {
      return toast.error(`Marks cannot exceed test max of ${maxScore}.`);
    }

    // Confirmation if a score already exists for this student+test combo —
    // prevents silent overwrite of a manually entered or earlier AI score.
    const scoreDocRef = doc(db, "test_scores", safeDocId(`${testId}_${studentId}`));
    let isAlreadyGraded = false;
    try {
      const existing = await getDoc(scoreDocRef);
      if (existing.exists()) {
        const exData = existing.data() as { score?: unknown };
        if (exData.score != null) {
          isAlreadyGraded = true;
          const ok = window.confirm(
            `${selectedStudent?.name || "This student"} already has a score for ${selectedTest.testName || selectedTest.title || "this test"}.\n\nReplace existing marks with AI-corrected ${scoreNum}/${maxScore}?`,
          );
          if (!ok) return;
        }
      }
    } catch (e) {
      // Read failure is non-fatal — fall through to write attempt; if write
      // also fails the catch below surfaces a clearer error.
      console.warn("[PushToGradebookModal] existing score read failed", e);
    }

    setSaving(true);
    try {
      // Inherit subject/topic from the test doc — same canonical pattern as
      // EnterScores.tsx so the analytics page groups scores under real topics
      // instead of "General topics" fallback.
      const inheritedSubject = (selectedTest.subject || correction.subject || "").trim();
      const firstArrayTopic = Array.isArray(selectedTest.topics) && selectedTest.topics.length > 0
        ? String(selectedTest.topics[0] || "").trim() : "";
      const inheritedTopic = (firstArrayTopic || selectedTest.topic || selectedTest.subject || selectedTest.title || "").trim();
      const inheritedClassName = (selectedTest.className || "").toLowerCase().trim();

      const pct = (scoreNum / maxScore) * 100;
      const grade = correction.gradeBand || "-";

      // merge:true so any external fields on the doc (e.g. teacher comment
      // from another flow) survive the AI push.
      await auditedSet(
        scoreDocRef,
        {
          testId,
          testName: selectedTest.testName || selectedTest.title || "",
          studentId,
          studentName: selectedStudent?.name || "",
          studentEmail: selectedStudent?.email || "",
          classId,
          className: inheritedClassName,
          subject: inheritedSubject,
          topic: inheritedTopic,
          teacherId: teacherData.id,
          schoolId: teacherData.schoolId || "",
          branchId: teacherData.branchId || "",
          score: scoreNum,
          maxScore,
          percentage: pct,
          grade,
          isAbsent: false,
          timestamp: serverTimestamp(),
          source: "ai_paper_correction",
          correctionId: correction.correctionId || "",
        },
        { merge: true },
      );

      // Update paper_corrections status if we have an id
      if (correction.correctionId) {
        try {
          await updateDoc(doc(db, "paper_corrections", correction.correctionId), {
            status: "pushed_to_gradebook",
            pushedToGradebookAt: serverTimestamp(),
            pushedTestId: testId,
            pushedStudentId: studentId,
          });
        } catch (e) {
          // Non-fatal — gradebook write succeeded; status update best-effort.
          console.warn("[PushToGradebookModal] correction status update failed", e);
        }
      }

      // Sync `tests` doc status when this push completes the class — mirrors
      // EnterScores's bulk-save final step. Counts post-write so the doc we
      // just wrote is included in the tally.
      try {
        const [scoredSnap, enrolledSnap] = await Promise.all([
          getDocs(query(
            collection(db, "test_scores"),
            where("schoolId", "==", teacherData.schoolId),
            where("testId", "==", testId),
          )),
          getDocs(query(
            collection(db, "enrollments"),
            where("schoolId", "==", teacherData.schoolId),
            where("classId", "==", classId),
          )),
        ]);
        if (enrolledSnap.size > 0 && scoredSnap.size >= enrolledSnap.size) {
          await auditedUpdate(doc(db, "tests", testId), { status: "Completed" });
        }
      } catch (e) {
        console.warn("[PushToGradebookModal] tests status update failed", e);
      }

      toast.success(isAlreadyGraded ? "Marks updated in gradebook." : "Marks pushed to gradebook.");
      onSaved(testId);
    } catch (e) {
      console.error("[PushToGradebookModal] save failed", e);
      const code = (e as { code?: string })?.code;
      if (code === "permission-denied") {
        toast.error("Permission denied — Firestore rules not deployed yet.");
      } else {
        toast.error("Failed to push marks.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Push to Gradebook"
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,8,40,0.42)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl overflow-hidden bg-white"
        style={{ boxShadow: "0 0 0 0.5px rgba(0,8,40,0.12), 0 8px 28px rgba(0,8,40,0.25), 0 30px 70px rgba(0,8,40,0.32)" }}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-slate-100">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Save AI marks
            </div>
            <h2 className="text-[20px] font-medium text-slate-900 mt-[3px]">Push to Gradebook</h2>
            <div className="text-[12px] text-slate-500 mt-[4px]">
              Attach this correction to a test &amp; student. Marks become visible in TestsExams, parent dashboard, and analytics.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <Field label="Class">
            {classesLoading ? (
              <Loading text="Loading classes…" />
            ) : classes.length === 0 ? (
              <Empty text="No classes assigned to you. Ask the principal to assign you a class first." />
            ) : (
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
              >
                <option value="">— Select class —</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            )}
          </Field>

          <Field label="Test">
            {!classId ? (
              <Empty text="Pick a class first." muted />
            ) : testsLoading ? (
              <Loading text="Loading tests…" />
            ) : tests.length === 0 ? (
              <Empty text="No tests for this class yet. Create one in Tests &amp; Exams." />
            ) : (
              <select
                value={testId}
                onChange={(e) => setTestId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
              >
                <option value="">— Select test —</option>
                {tests.map(t => (
                  <option key={t.id} value={t.id}>
                    {(t.testName || t.title || "Untitled")} {t.testDate ? `· ${t.testDate}` : ""} {t.marks ? `· ${t.marks}m` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Student">
            {!classId ? (
              <Empty text="Pick a class first." muted />
            ) : studentsLoading ? (
              <Loading text="Loading students…" />
            ) : students.length === 0 ? (
              <Empty text="No students enrolled in this class." />
            ) : (
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
              >
                <option value="">— Select student —</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name || s.email || s.id}</option>)}
              </select>
            )}
          </Field>

          <Field label="Marks scored (editable)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                min={0}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:border-[#1e3272] focus:ring-2 focus:ring-[#1e3272]/15 outline-none text-[13px]"
              />
              <div className="text-[12px] text-slate-500 whitespace-nowrap">
                / {selectedTest?.marks || correction.totalMarks || "—"}
              </div>
            </div>
          </Field>

          <div className="rounded-xl bg-slate-50 px-3 py-2.5 flex items-center justify-between">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-medium">AI percentage · grade</div>
            <div className="text-[12px] font-medium text-slate-900">
              {Number.isFinite(correction.percentage) ? correction.percentage.toFixed(1) : "—"}% · {correction.gradeBand}
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-[13px] font-medium text-slate-700 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !classId || !testId || !studentId}
              className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[13px] font-medium inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><BookmarkPlus className="w-4 h-4" /> Push marks</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <div className="text-[12px] font-medium text-slate-700 mb-1.5">{label}</div>
    {children}
  </label>
);

const Loading: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 text-[12px] text-slate-500">
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
    {text}
  </div>
);

const Empty: React.FC<{ text: string; muted?: boolean }> = ({ text, muted }) => (
  <div
    className={`px-3 py-2 rounded-xl text-[12px] font-medium ${
      muted
        ? "bg-slate-50 text-slate-500"
        : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
    }`}
  >
    {text}
  </div>
);

export default PushToGradebookModal;
