/**
 * SaveAsTestModal — persists an AI-generated exam paper as a real `tests/{id}`
 * Firestore doc so it appears in TestsExams + ClassDetail and links to the
 * downstream EnterScores → results flow.
 *
 * Doc shape mirrors `CreateTest.tsx` (the canonical writer for `tests`):
 *   title / testName / classId / className / subject / testDate / duration /
 *   marks / category / teacherId / schoolId / branchId / status / topics /
 *   questionTypes / settings / blueprintUrl / createdAt
 *
 * Plus a new `paper: GeneratedPaper` field embedding the AI-generated paper
 * (questions + answers + sections + general instructions). Existing readers
 * (TestsExams, ClassDetail, parent-dashboard TestsPage) ignore unknown fields
 * — safe to add. Future enhancement: TestsExams can render a "View Paper"
 * pill for tests that carry this field.
 *
 * Cross-dashboard impact (per cross_dashboard_linking_rule):
 *   - WRITER:  this modal (new)
 *   - READERS: teacher TestsExams (where teacherId), teacher ClassDetail
 *              (where schoolId+classId), parent-dashboard TestsPage
 *   - All readers tolerate unknown fields, so the new `paper` blob is safe.
 *   - classId/teacherId/schoolId/branchId/testDate are the load-bearing
 *     fields readers actually filter on — these match CreateTest exactly.
 */

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, serverTimestamp, type QueryConstraint } from "firebase/firestore";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { auditedAdd } from "../lib/auditedWrites";
import type { GeneratedPaper } from "../pages/exam-types";

const DEFAULT_EXAM_CATEGORIES = ["Unit Test", "Mid-term", "Final"];

interface ClassRow { id: string; name?: string; grade?: string }

interface FormSnapshot {
  subject: string;
  grade: string;
  topics: string;
  duration: string;
  totalMarks: number;
  numQuestions: number;
  types: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful write — typically navigates to /tests. */
  onSaved: (testId: string) => void;
  paper: GeneratedPaper;
  formSnapshot: FormSnapshot;
}

const todayPlusDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const SaveAsTestModal: React.FC<Props> = ({ open, onClose, onSaved, paper, formSnapshot }) => {
  const { teacherData } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [examCategories, setExamCategories] = useState<string[]>(DEFAULT_EXAM_CATEGORIES);

  const [classId, setClassId] = useState("");
  const [className, setClassName] = useState("");
  const [testName, setTestName] = useState("");
  const [testDate, setTestDate] = useState(todayPlusDays(7));
  const [category, setCategory] = useState(DEFAULT_EXAM_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);

  // Reset / pre-fill on open
  useEffect(() => {
    if (!open) return;
    setTestName(paper.title || `${formSnapshot.subject} — ${formSnapshot.grade}`);
    setTestDate(todayPlusDays(7));
    setSaving(false);
  }, [open, paper.title, formSnapshot.subject, formSnapshot.grade]);

  // Load teacher's own classes for the picker — same pattern as CreateTest.tsx
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
        setClassId(prev => prev || (cls[0]?.id ?? ""));
        setClassName(prev => prev || (cls[0]?.name ?? ""));
      },
      (err) => {
        console.error("[SaveAsTestModal] classes listener failed", err);
        setClassesLoading(false);
      },
    );
    return () => unsub();
  }, [open, teacherData?.id, teacherData?.schoolId]);

  // Load principal-configured exam_structure categories — same pattern as CreateTest.tsx
  useEffect(() => {
    if (!open || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const inBranch = (raw: { branchId?: string }) => !branchId || !raw?.branchId || raw.branchId === branchId;

    const unsub = onSnapshot(
      query(collection(db, "exam_structure"), where("schoolId", "==", schoolId)),
      (snap) => {
        const docs = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter(inBranch);
        if (docs.length === 0) {
          setExamCategories(DEFAULT_EXAM_CATEGORIES);
          return;
        }
        const seen = new Set<string>();
        const names: string[] = [];
        docs.forEach((d: { name?: unknown }) => {
          const name = String(d.name || "").trim();
          if (!name || seen.has(name)) return;
          seen.add(name);
          names.push(name);
        });
        setExamCategories(names.length > 0 ? names : DEFAULT_EXAM_CATEGORIES);
        setCategory(prev => names.includes(prev) ? prev : (names[0] ?? DEFAULT_EXAM_CATEGORIES[0]));
      },
      (err) => console.warn("[SaveAsTestModal] exam_structure listener failed:", err),
    );
    return () => unsub();
  }, [open, teacherData?.schoolId, teacherData?.branchId]);

  const handleClassPick = (id: string) => {
    setClassId(id);
    const cls = classes.find(c => c.id === id);
    setClassName(cls?.name || "");
  };

  const handleSave = async () => {
    if (!testName.trim()) return toast.error("Test name is required.");
    if (!classId) return toast.error("Please select a class.");
    if (!testDate) return toast.error("Test date is required.");
    if (!teacherData?.id) return toast.error("You are signed out. Please sign in again.");

    setSaving(true);
    try {
      const docRef = await auditedAdd(collection(db, "tests"), {
        title: testName.trim(),
        testName: testName.trim(),
        description: "",
        classId,
        className,
        subject: formSnapshot.subject,
        testDate,
        duration: formSnapshot.duration,
        marks: String(formSnapshot.totalMarks),
        category,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        branchId: teacherData.branchId || "",
        status: "Upcoming",
        topics: formSnapshot.topics
          .split(/[,\n]/)
          .map(t => t.trim())
          .filter(Boolean),
        questionTypes: formSnapshot.types,
        settings: {
          immediateResults: true,
          allowRetake: false,
          shuffleQuestions: true,
        },
        blueprintUrl: "",
        // Embed the full AI-generated paper for future "View Paper" / reuse.
        // Existing readers ignore this field — safe additive write.
        paper,
        source: "ai_exam_generator",
        createdAt: serverTimestamp(),
      });
      toast.success("Test saved.");
      onSaved(docRef.id);
    } catch (e) {
      console.error("[SaveAsTestModal] save failed", e);
      toast.error("Failed to save test.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save as Test"
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,8,40,0.42)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        className="w-full max-w-[440px] rounded-[20px] overflow-hidden"
        style={{
          background: "#FFFFFF",
          boxShadow: "0 0 0 0.5px rgba(0,85,255,0.12), 0 8px 28px rgba(0,8,60,0.25), 0 30px 70px rgba(0,8,60,0.32)",
          fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase" style={{ color: "#5070B0", letterSpacing: "1.6px" }}>
              Save AI Paper
            </div>
            <h2 className="text-[20px] font-bold mt-[3px]" style={{ color: "#001040", letterSpacing: "-0.5px" }}>
              Save as Test
            </h2>
            <div className="text-[12px] font-medium mt-[4px]" style={{ color: "#5070B0", letterSpacing: "-0.1px" }}>
              Attach this paper to a class so it shows up in Tests &amp; Exams.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "#F4F7FE", color: "#5070B0", border: "none", cursor: saving ? "not-allowed" : "pointer" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-3">
          <Field label="Test Name">
            <input
              type="text"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="e.g. Mathematics — Class 10 Mock"
              className="w-full rounded-[10px] px-[12px] py-[10px] text-[13px] font-medium outline-none"
              style={{ background: "#F4F7FE", color: "#001040", border: "1px solid transparent" }}
            />
          </Field>

          <Field label="Class">
            {classesLoading ? (
              <div className="flex items-center gap-2 px-[12px] py-[10px] rounded-[10px] text-[12px]"
                style={{ background: "#F4F7FE", color: "#5070B0" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading classes…
              </div>
            ) : classes.length === 0 ? (
              <div className="px-[12px] py-[10px] rounded-[10px] text-[12px] font-medium"
                style={{ background: "#FFF5F5", color: "#C92A2A", border: "1px solid #FFD8D8" }}>
                No classes assigned to you. Ask the principal to assign you a class first.
              </div>
            ) : (
              <select
                value={classId}
                onChange={(e) => handleClassPick(e.target.value)}
                className="w-full rounded-[10px] px-[12px] py-[10px] text-[13px] font-medium outline-none"
                style={{ background: "#F4F7FE", color: "#001040", border: "1px solid transparent" }}
              >
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name || c.id}</option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Test Date">
              <input
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                min={todayPlusDays(0)}
                className="w-full rounded-[10px] px-[12px] py-[10px] text-[13px] font-medium outline-none"
                style={{ background: "#F4F7FE", color: "#001040", border: "1px solid transparent" }}
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-[10px] px-[12px] py-[10px] text-[13px] font-medium outline-none"
                style={{ background: "#F4F7FE", color: "#001040", border: "1px solid transparent" }}
              >
                {examCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex items-center justify-between mt-1 px-[12px] py-[8px] rounded-[10px]"
            style={{ background: "#EAF0FB", border: "1px solid rgba(0,85,255,0.08)" }}>
            <div className="text-[10px] font-bold uppercase" style={{ color: "#5070B0", letterSpacing: "1px" }}>Subject · Marks · Questions</div>
            <div className="text-[11px] font-bold" style={{ color: "#001040" }}>
              {formSnapshot.subject || "—"} · {formSnapshot.totalMarks}m · {formSnapshot.numQuestions}q
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 h-[44px] rounded-[12px] text-[13px] font-bold"
              style={{ background: "#F4F7FE", color: "#42475A", border: "none", cursor: saving ? "not-allowed" : "pointer" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || classesLoading || classes.length === 0}
              className="flex-1 h-[44px] rounded-[12px] flex items-center justify-center gap-2 text-[13px] font-bold text-white"
              style={{
                background: saving || classes.length === 0 ? "#99AACC" : "#0055FF",
                border: "none",
                boxShadow: saving || classes.length === 0 ? "none" : "0 1px 2px rgba(9,87,247,0.2), 0 6px 16px rgba(9,87,247,0.32)",
                cursor: saving || classes.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                "Save Test"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[10px] font-bold uppercase mb-[5px]" style={{ color: "#5070B0", letterSpacing: "0.8px" }}>{label}</div>
    {children}
  </div>
);

export default SaveAsTestModal;
