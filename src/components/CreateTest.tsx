import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, storage } from "../lib/firebase";
import {
  collection, query, where, serverTimestamp, onSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auditedAdd } from "../lib/auditedWrites";
import { Loader2, UploadCloud, X, FileText } from 'lucide-react';
import { toast } from "sonner";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const sanitizeStorageName = (name: string): string =>
  name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

export default function CreateTest({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) {
  const { user, teacherData } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
     title: "",
     description: "",
     classId: "",
     className: "",
     subject: "",
     testDate: "",
     duration: "",
     marks: "",
     category: "Unit Test",
  });

  const [topics, setTopics] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [qTypes, setQTypes] = useState<string[]>(['MCQ', 'Short Answer', 'Long Answer']);
  
  const [settings, setSettings] = useState({
     immediateResults: true,
     allowRetake: false,
     shuffleQuestions: true
  });

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId as string;
    const branchId = teacherData.branchId as string | undefined;
    const SC: QueryConstraint[] = [where("schoolId", "==", schoolId)];
    if (branchId) SC.push(where("branchId", "==", branchId));

    const q = query(collection(db, "classes"), ...SC, where("teacherId", "==", teacherData.id));
    const unsub = onSnapshot(q, (snap) => {
      const cls = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
      setClasses(cls);
      // Use the functional setter so we read the *latest* classId, not the
      // one captured in this effect's closure. Prevents the auto-select from
      // clobbering a user choice when the snapshot re-fires later.
      setFormData(prev =>
        prev.classId || cls.length === 0
          ? prev
          : { ...prev, classId: cls[0].id as string, className: (cls[0] as { name?: string }).name || "" }
      );
    });
    return () => unsub();
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  const handleSave = async () => {
    const title = formData.title.trim();
    if (!title || !formData.classId) return toast.error("Test Name and Class are required.");

    if (pdfFile) {
      if (pdfFile.size > MAX_UPLOAD_BYTES) {
        return toast.error(`Attachment exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`);
      }
      if (pdfFile.type && !ALLOWED_UPLOAD_TYPES.has(pdfFile.type)) {
        return toast.error("Unsupported file type. Allowed: PDF, Word, PNG, JPEG.");
      }
    }

    setIsSaving(true);

    try {
      let pdfUrl = "";
      if (pdfFile) {
         // Storage rules require the filename prefix to be the caller's
         // auth.uid — not `teacherData.id` (Firestore teachers doc ID).
         if (!user?.uid) {
           toast.error("You are signed out. Please sign in again.");
           setIsSaving(false);
           return;
         }
         toast.info("Uploading Blueprint PDF...");
         const safeName = sanitizeStorageName(pdfFile.name);
         const fileRef = ref(storage, `test_blueprints/${user.uid}_${Date.now()}_${safeName}`);
         await uploadBytes(fileRef, pdfFile);
         pdfUrl = await getDownloadURL(fileRef);
      }

      await auditedAdd(collection(db, "tests"), {
        ...formData,
        title,
        testName: title,
        teacherId: teacherData.id,
        schoolId: teacherData.schoolId || "",
        branchId: teacherData.branchId || "",
        status: "Upcoming",
        topics,
        questionTypes: qTypes,
        settings,
        blueprintUrl: pdfUrl,
        createdAt: serverTimestamp()
      });

      toast.success("Test completely set up and published globally!");
      onCreate();
    } catch (e) {
      console.error("[CreateTest] save failed", e);
      toast.error("Failed to publish test.");
    } finally {
      setIsSaving(false);
    }
  };

  // Design tokens
  const T = {
    ink0: '#08090C', ink1: '#42475A', ink2: '#8C92A4',
    s0: '#FFFFFF', s1: '#F5F6F9', s2: '#ECEEF4', bdr: '#E2E5EE',
    blue: '#3B5BDB', blueL: '#EDF2FF', blueB: '#BAC8FF',
    green2: '#2F9E44', greenL: '#EBFBEE',
    red: '#C92A2A',
  };

  const inp = {
    width: '100%', padding: '10px 12px', borderRadius: 11,
    border: `1px solid ${T.bdr}`, background: T.s1,
    fontSize: 13, color: T.ink1, fontFamily: 'inherit', outline: 'none',
  };
  const lbl = {
    fontSize: 10, fontWeight: 500, color: T.ink2,
    letterSpacing: '0.07em', textTransform: 'uppercase',
    display: 'flex', alignItems: 'center', gap: 4,
  };
  const divider = <div style={{ height: 1, background: T.s2, margin: '0 -14px' }} />;
  const section = (children: React.ReactNode) => (
    <div style={{ padding: 14 }}>{children}</div>
  );

  return (
    <div style={{ background: T.s1, fontFamily: 'inherit', minHeight: '100vh' }} className="text-left pb-10">

      {/* ── Dark Hero ─────────────────────────────────────────────────────── */}
      <div
        className="-mx-4 sm:-mx-6 md:-mx-8 md:-mt-8 px-[22px] pb-5 bg-[#162E93] md:bg-[#08090C]"
      >
        {/* Back link */}
        <button type="button"
          onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.blue} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,2 4,7 9,12"/>
          </svg>
          <span style={{ fontSize: 12, color: T.blue }}>Back to tests</span>
        </button>

        <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
          New test
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', lineHeight: 1.1 }}>
          Create<br />test
        </h1>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>
          Set up a new test and publish to your class.
        </p>

        {/* Hero actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button"
            onClick={onCancel}
            style={{
              padding: '9px 16px', borderRadius: 11,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            aria-label={isSaving ? "Creating test" : "Create test"}
            type="button"
            style={{
              flex: 1, padding: '9px 14px', borderRadius: 11,
              background: T.blue, border: 'none',
              color: '#fff', fontSize: 12, fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="1.5,6.5 4.5,10 10.5,2.5"/>
                </svg>
                Create test
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-0 pt-4 flex flex-col gap-3">

        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 18, overflow: 'hidden', padding: 0 }}>

          {/* Select class */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Select class</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {classes.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.ink2, padding: '10px 0' }}>
                    No classes assigned yet. Contact your principal to be added to a class.
                  </div>
                ) : (
                  classes.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, classId: c.id, className: c.name })}
                      aria-pressed={formData.classId === c.id}
                      style={{
                        padding: '7px 14px', borderRadius: 20, fontSize: 12,
                        fontWeight: formData.classId === c.id ? 500 : 400,
                        border: `1px solid ${formData.classId === c.id ? T.ink0 : T.bdr}`,
                        background: formData.classId === c.id ? T.ink0 : T.s1,
                        color: formData.classId === c.id ? '#fff' : T.ink2,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          {divider}

          {/* Test name */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>
                Test name <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
              </div>
              <input style={inp} type="text" placeholder="e.g. Chapter 5 Unit Test"
                value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
            </div>
          )}
          {divider}

          {/* Description */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Description</div>
              <textarea
                style={{ ...inp, resize: 'none', minHeight: 72, lineHeight: 1.5 }}
                placeholder="Describe the test scope and instructions..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          )}
          {divider}

          {/* Category + Subject */}
          {section(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>Category</div>
                <div style={{ position: 'relative' }}>
                  <select
                    style={{ ...inp, appearance: 'none', WebkitAppearance: 'none', paddingRight: 28 }}
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    aria-label="Test category"
                  >
                    <option value="Unit Test">Unit Test</option>
                    <option value="Mid-term">Mid-term</option>
                    <option value="Final">Final</option>
                  </select>
                  <svg style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={T.ink2} strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="3,5 7,9 11,5"/>
                  </svg>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>Subject</div>
                <input style={inp} type="text" placeholder="e.g. English"
                  value={formData.subject} onChange={e => setFormData({ ...formData, subject: e.target.value })} />
              </div>
            </div>
          )}
          {divider}

          {/* Total marks + Duration */}
          {section(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>
                  Total marks <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
                </div>
                <input style={inp} type="number" placeholder="e.g. 100"
                  value={formData.marks} onChange={e => setFormData({ ...formData, marks: e.target.value })} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={lbl}>
                  Duration <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
                </div>
                <input style={inp} type="text" placeholder="e.g. 45 mins"
                  value={formData.duration} onChange={e => setFormData({ ...formData, duration: e.target.value })} />
              </div>
            </div>
          )}
          {divider}

          {/* Test date */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>
                Test date <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.red }} />
              </div>
              <input style={inp} type="date"
                value={formData.testDate} onChange={e => setFormData({ ...formData, testDate: e.target.value })} />
            </div>
          )}
          {divider}

          {/* PDF upload */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Attach paper (PDF · optional)</div>
              <div style={{ position: 'relative' }}>
                <input
                  type="file" accept=".pdf,.doc,.docx,image/png,image/jpeg"
                  aria-label="Upload test blueprint"
                  onChange={e => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }}
                />
                <div style={{
                  border: `1.5px dashed ${T.bdr}`, borderRadius: 13, padding: '20px 14px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                  background: pdfFile ? T.greenL : T.s1,
                  borderColor: pdfFile ? T.green2 : T.bdr,
                }}>
                  {pdfFile ? (
                    <>
                      <FileText size={20} style={{ color: T.green2 }} aria-hidden="true" />
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.green2 }}>{pdfFile.name}</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>Document attached</div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 36, height: 36, borderRadius: 11, background: T.blueL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <UploadCloud size={15} style={{ color: T.blue }} aria-hidden="true" />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: T.blue }}>Upload blueprint</div>
                      <div style={{ fontSize: 10, color: T.ink2 }}>PDF / Word / image · Max 10 MB</div>
                    </>
                  )}
                </div>
                {pdfFile && (
                  <button
                    type="button"
                    aria-label="Remove blueprint"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPdfFile(null); }}
                    style={{ position: 'absolute', right: 10, top: 10, zIndex: 20, background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 8, padding: 4, cursor: 'pointer' }}
                  >
                    <X size={12} style={{ color: T.red }} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
          {divider}

          {/* Topics */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={lbl}>Topics covered</div>
              <div style={{ display: 'flex', gap: 7 }}>
                <input
                  style={{ ...inp, flex: 1 }} type="text" placeholder="Add new topic..."
                  value={newTopic} onChange={e => setNewTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(''); } }}
                />
                <button type="button"
                  onClick={() => { if (newTopic.trim()) { setTopics([...topics, newTopic.trim()]); setNewTopic(''); } }}
                  style={{ padding: '10px 14px', borderRadius: 11, background: T.ink0, border: 'none', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  Add
                </button>
              </div>

              {/* Question type tags + topic tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {qTypes.map((q, idx) => (
                  <div key={idx} style={{
                    padding: '5px 10px', borderRadius: 20, background: T.blueL, color: T.blue,
                    fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5,
                    border: `1px solid ${T.blueB}`,
                  }}>
                    {q}
                    <button type="button" onClick={() => setQTypes(qTypes.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <X size={9} style={{ color: T.blue }} />
                    </button>
                  </div>
                ))}
                {topics.map((t, idx) => (
                  <div key={idx} style={{
                    padding: '5px 10px', borderRadius: 20, background: T.blueL, color: T.blue,
                    fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5,
                    border: `1px solid ${T.blueB}`,
                  }}>
                    {t}
                    <button type="button" onClick={() => setTopics(topics.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      <X size={9} style={{ color: T.blue }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {divider}

          {/* Settings */}
          {section(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ ...lbl as any, marginBottom: 10 }}>Additional settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { key: 'immediateResults', label: 'Show results to students immediately' },
                  { key: 'allowRetake',      label: 'Allow retake for failed students' },
                  { key: 'shuffleQuestions', label: 'Shuffle questions for each student' },
                ].map(({ key, label }) => {
                  const on = (settings as any)[key];
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => setSettings({ ...settings, [key]: !on })}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5,
                        border: `1.5px solid ${on ? T.blue : T.bdr}`,
                        background: on ? T.blue : T.s1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {on && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5,5.5 4,8.5 8.5,2"/>
                          </svg>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: T.ink2 }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Publish footer */}
        <div style={{ background: T.s0, border: `1px solid ${T.bdr}`, borderRadius: 16, padding: '13px 14px', display: 'flex', gap: 8 }}>
          <button type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              flex: 1, padding: 11, borderRadius: 11, background: T.blue, border: 'none',
              color: '#fff', fontSize: 13, fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: isSaving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,7 5.5,11 11.5,2.5"/>
                </svg>
                Create &amp; publish
              </>
            )}
          </button>
          <button type="button"
            onClick={onCancel}
            style={{
              padding: '11px 14px', borderRadius: 11, background: T.s1,
              border: `1px solid ${T.bdr}`, color: T.ink2,
              fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Save draft
          </button>
        </div>

      </div>
    </div>
  );
}
