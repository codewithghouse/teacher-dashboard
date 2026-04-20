import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "../lib/AuthContext";
import { db, storage, auth } from "../lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
  doc, serverTimestamp,
} from "firebase/firestore";
import { auditedAdd, auditedDelete } from "../lib/auditedWrites";

// Reject non-http(s) URLs before using them as an <a href>. Prevents
// `javascript:` / `data:` URLs from a misconfigured Firestore record.
const isHttpUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
};
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from "firebase/storage";
import {
  Loader2, Upload, FileText, Trash2, Eye, Library, Plus, X,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
type ClassOption = {
  classId: string;
  className: string;
};

type SyllabusDoc = {
  id: string;
  schoolId: string;
  branchId: string;
  classId: string;
  className: string;
  title: string;
  fileUrl: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedByTeacherId: string;
  uploadedAt?: any;
  isActive?: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const MAX_BYTES = 50 * 1024 * 1024;

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "doc";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
};

const formatRelative = (ts: unknown): string => {
  if (!ts) return "just now";
  const maybeTs = ts as { toDate?: () => Date };
  const date: Date = maybeTs.toDate ? maybeTs.toDate() : new Date(ts as string | number | Date);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

const currentAcademicYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
};

// ── Component ─────────────────────────────────────────────────────────────────
const Syllabus = () => {
  const { teacherData } = useAuth();

  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [docs, setDocs] = useState<SyllabusDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selClassId, setSelClassId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Load teacher's assigned classes ─────────────────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    const schoolId = teacherData.schoolId;
    let cancelled = false;
    setLoading(true);

    const qAssign = query(
      collection(db, "teaching_assignments"),
      where("schoolId", "==", schoolId),
      where("teacherId", "==", teacherData.id),
      where("status", "==", "active"),
    );

    const unsub = onSnapshot(
      qAssign,
      async (snap) => {
        try {
          const classIds = Array.from(
            new Set(snap.docs.map((d) => d.data().classId).filter(Boolean))
          ) as string[];

          const nameMap = new Map<string, string>();
          if (classIds.length > 0) {
            const classSnaps = await Promise.all(
              classIds.map((cid) =>
                getDocs(query(
                  collection(db, "classes"),
                  where("schoolId", "==", schoolId),
                  where("__name__", "==", cid),
                )),
              ),
            );
            classSnaps.forEach((s) => {
              s.docs.forEach((d) => {
                const data = d.data() as any;
                nameMap.set(d.id, data.name || data.className || "Class");
              });
            });
          }

          const opts: ClassOption[] = classIds.map((cid) => ({
            classId: cid,
            className: nameMap.get(cid) || "Class",
          }));
          opts.sort((a, b) => a.className.localeCompare(b.className));

          if (!cancelled) {
            setClasses(opts);
            setLoading(false);
          }
        } catch (err) {
          console.error("Failed to load classes:", err);
          if (!cancelled) {
            setLoading(false);
            toast.error("Failed to load your classes.");
          }
        }
      },
      (err) => {
        console.error("teaching_assignments listener error:", err);
        if (!cancelled) {
          setLoading(false);
          toast.error("Failed to load your classes.");
        }
      },
    );

    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // ── Live listener on docs this teacher uploaded ─────────────────────────────
  useEffect(() => {
    if (!teacherData?.id || !teacherData?.schoolId) return;
    let cancelled = false;

    const qDocs = query(
      collection(db, "syllabi"),
      where("schoolId", "==", teacherData.schoolId),
      where("uploadedByTeacherId", "==", teacherData.id),
    );

    const unsub = onSnapshot(
      qDocs,
      (snap) => {
        if (cancelled) return;
        const list: SyllabusDoc[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.isActive === false) return;
          list.push({ id: d.id, ...data } as SyllabusDoc);
        });
        list.sort((a, b) => {
          const am = (a.uploadedAt as any)?.toMillis?.() ?? 0;
          const bm = (b.uploadedAt as any)?.toMillis?.() ?? 0;
          return bm - am;
        });
        setDocs(list);
      },
      (err) => {
        console.error("syllabi listener error:", err);
        toast.error("Failed to load your documents.");
      },
    );

    return () => { cancelled = true; unsub(); };
  }, [teacherData?.id, teacherData?.schoolId, teacherData?.branchId]);

  // Group docs by class for display
  const docsByClass = useMemo(() => {
    const m = new Map<string, SyllabusDoc[]>();
    docs.forEach((d) => {
      if (!m.has(d.classId)) m.set(d.classId, []);
      m.get(d.classId)!.push(d);
    });
    return m;
  }, [docs]);

  // ── Modal helpers ───────────────────────────────────────────────────────────
  const openModal = () => {
    if (classes.length === 0) {
      toast.error("No classes assigned yet. Ask your principal to assign classes first.");
      return;
    }
    setSelClassId(classes[0].classId);
    setTitle("");
    setPickedFile(null);
    setProgress(0);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (uploading) return;
    setModalOpen(false);
    setSelClassId("");
    setTitle("");
    setPickedFile(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) { setPickedFile(null); return; }

    const nameLower = file.name.toLowerCase();
    if (file.type !== "application/pdf" || !nameLower.endsWith(".pdf")) {
      toast.error("Only PDF files are allowed.");
      e.target.value = "";
      setPickedFile(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large. Maximum size is 50 MB.");
      e.target.value = "";
      setPickedFile(null);
      return;
    }
    if (file.size === 0) {
      toast.error("Selected file is empty.");
      e.target.value = "";
      setPickedFile(null);
      return;
    }

    setPickedFile(file);
  };

  // ── Upload flow ─────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    const trimmedTitle = title.trim();
    if (!selClassId) { toast.error("Please select a class."); return; }
    if (!trimmedTitle) { toast.error("Please enter a title."); return; }
    if (trimmedTitle.length > 100) { toast.error("Title is too long (max 100 characters)."); return; }
    if (!pickedFile) { toast.error("Please pick a PDF file."); return; }

    const uid = auth.currentUser?.uid;
    if (!uid) { toast.error("You must be signed in to upload."); return; }
    if (!teacherData?.schoolId || !teacherData?.branchId) {
      toast.error("Missing school/branch info. Please contact your principal.");
      return;
    }

    const chosenClass = classes.find((c) => c.classId === selClassId);
    if (!chosenClass) { toast.error("Selected class not found."); return; }

    setUploading(true);
    setProgress(0);

    const titleSlug = slugify(trimmedTitle);
    const filePath =
      `syllabi/${teacherData.schoolId}/${teacherData.branchId}/` +
      `${selClassId}/${titleSlug}/${Date.now()}_${pickedFile.name}`;

    const storageRef = ref(storage, filePath);
    const task = uploadBytesResumable(storageRef, pickedFile, { contentType: "application/pdf" });

    task.on(
      "state_changed",
      (snap) => {
        const pct = snap.totalBytes > 0 ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
        setProgress(pct);
      },
      (err) => {
        console.error("Upload failed:", err);
        toast.error(err.message || "Upload failed.");
        setUploading(false);
        setProgress(0);
      },
      async () => {
        try {
          const fileUrl = await getDownloadURL(task.snapshot.ref);
          try {
            await auditedAdd(collection(db, "syllabi"), {
              schoolId:            teacherData.schoolId,
              branchId:            teacherData.branchId,
              classId:             chosenClass.classId,
              className:           chosenClass.className,
              title:               trimmedTitle,
              academicYear:        currentAcademicYear(),
              fileUrl,
              filePath,
              fileName:            pickedFile.name,
              fileSize:            pickedFile.size,
              uploadedBy:          uid,
              uploadedByName:      teacherData.name || "Teacher",
              uploadedByTeacherId: teacherData.id,
              uploadedAt:          serverTimestamp(),
              isActive:            true,
            });
          } catch (dbErr: any) {
            console.error("Firestore write failed, cleaning up storage:", dbErr);
            try { await deleteObject(ref(storage, filePath)); } catch {}
            throw dbErr;
          }
          toast.success("Document uploaded.");
          closeModal();
        } catch (err: unknown) {
          console.error("[Syllabus] finalize failed:", err);
          toast.error(err instanceof Error ? err.message : "Failed to save document.");
          setUploading(false);
          setProgress(0);
        }
      },
    );
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (d: SyllabusDoc) => {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    try {
      try { await deleteObject(ref(storage, d.filePath)); }
      catch (err) { console.warn("Storage delete failed:", err); }
      await auditedDelete(doc(db, "syllabi", d.id));
      toast.success("Document deleted.");
    } catch (err: unknown) {
      console.error("[Syllabus] delete failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete document.");
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="text-left min-h-[60vh]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[26px] md:text-[28px] font-bold text-slate-900 leading-tight tracking-tight">
            Syllabus & Documents
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload PDFs (syllabus, notes, resources) for your classes
          </p>
        </div>
        <button
          onClick={openModal}
          disabled={loading || classes.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3272] text-white text-sm font-semibold hover:bg-[#162552] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Plus className="w-4 h-4" /> Upload Document
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#1e3272] animate-spin" />
        </div>
      ) : classes.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl text-center px-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <Library className="w-6 h-6 text-indigo-500" />
          </div>
          <p className="text-slate-700 font-semibold text-sm mb-1">No classes assigned yet</p>
          <p className="text-slate-400 text-xs max-w-sm">
            Once your principal assigns you classes, you'll be able to upload documents here.
          </p>
        </div>
      ) : docs.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl text-center px-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <FileText className="w-6 h-6 text-indigo-500" />
          </div>
          <p className="text-slate-700 font-semibold text-sm mb-1">No documents uploaded yet</p>
          <p className="text-slate-400 text-xs max-w-sm mb-4">
            Click "Upload Document" to share syllabus, notes, or any resource with your students.
          </p>
          <button
            onClick={openModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3272] text-white text-xs font-semibold hover:bg-[#162552] transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Upload first document
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {classes.map((c) => {
            const classDocs = docsByClass.get(c.classId) || [];
            if (classDocs.length === 0) return null;
            return (
              <div key={c.classId} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Library className="w-4 h-4 text-indigo-500" />
                    {c.className}
                    <span className="text-xs font-semibold text-slate-400 normal-case tracking-normal">
                      · {classDocs.length} document{classDocs.length !== 1 ? "s" : ""}
                    </span>
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  {classDocs.map((d) => (
                    <div
                      key={d.id}
                      className="clickable-card bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-start gap-3"
                    >
                      <div className="w-11 h-11 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-rose-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold text-slate-900 leading-tight truncate">
                          {d.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{d.fileName}</p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1.5">
                          <span>{formatBytes(d.fileSize)}</span>
                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                          <span>{formatRelative(d.uploadedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          {isHttpUrl(d.fileUrl) && (
                            <a
                              href={d.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e3272] text-white text-[11px] font-semibold hover:bg-[#162552] transition-colors"
                            >
                              <Eye className="w-3 h-3" /> View PDF
                            </a>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(d); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-[11px] font-semibold hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Upload Modal ─────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Upload Document</h3>
                  <p className="text-[11px] text-slate-500">PDF only · Max 50 MB</p>
                </div>
              </div>
              <button
                onClick={closeModal}
                disabled={uploading}
                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              {/* Class select */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Class *
                </label>
                <select
                  value={selClassId}
                  onChange={(e) => setSelClassId(e.target.value)}
                  disabled={uploading}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 disabled:opacity-50"
                >
                  {classes.map((c) => (
                    <option key={c.classId} value={c.classId}>{c.className}</option>
                  ))}
                </select>
              </div>

              {/* Title input */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={uploading}
                  maxLength={100}
                  placeholder="e.g. Term 1 Syllabus, Important Notes, Unit 3"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 disabled:opacity-50"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Students will see this title. {title.length}/100 characters.
                </p>
              </div>

              {/* File picker */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">
                  PDF File *
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={onFileChosen}
                  disabled={uploading}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 file:cursor-pointer"
                />
                {pickedFile && (
                  <div className="mt-2 bg-slate-50 border border-slate-100 rounded-xl p-2.5 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-700 truncate">{pickedFile.name}</p>
                      <p className="text-[10px] text-slate-500">{formatBytes(pickedFile.size)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {uploading && (
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                    <span className="font-medium">Uploading...</span>
                    <span className="font-bold text-[#1e3272]">{progress.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    Please don't close this tab.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                onClick={closeModal}
                disabled={uploading}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !title.trim() || !pickedFile || !selClassId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3272] text-white text-xs font-semibold hover:bg-[#162552] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3.5 h-3.5" /> Upload</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Syllabus;