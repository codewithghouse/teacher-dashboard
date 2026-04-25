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

  // ── Mobile-specific state & helpers ─────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<string>("all"); // 'all' | classId | 'syllabus' | 'notes'
  const [mobileSelClassId, setMobileSelClassId] = useState<string>("");

  const openMobileSheet = (preselectClassId?: string) => {
    if (classes.length === 0) {
      toast.error("No classes assigned yet. Ask your principal to assign classes first.");
      return;
    }
    setMobileSelClassId(preselectClassId || classes[0].classId);
    setSelClassId(preselectClassId || classes[0].classId);
    setTitle("");
    setPickedFile(null);
    setProgress(0);
    setModalOpen(true);
  };

  const keywordMatch = (t: string, kw: string) => (t || "").toLowerCase().includes(kw);
  const totalBytes = docs.reduce((a, d) => a + (d.fileSize || 0), 0);

  const filterDocs = (list: SyllabusDoc[]) => {
    if (activeFilter === "all") return list;
    if (activeFilter === "syllabus") return list.filter(d => keywordMatch(d.title, "syllabus"));
    if (activeFilter === "notes") return list.filter(d => keywordMatch(d.title, "note"));
    return list.filter(d => d.classId === activeFilter);
  };

  const filterChips = [
    { key: "all", label: "All", count: docs.length },
    ...classes.map(c => ({ key: c.classId, label: c.className, count: (docsByClass.get(c.classId) || []).length })),
    { key: "syllabus", label: "Syllabus", count: docs.filter(d => keywordMatch(d.title, "syllabus")).length },
    { key: "notes", label: "Notes", count: docs.filter(d => keywordMatch(d.title, "note")).length },
  ];

  const MOB_CLASS_COLORS = ["#0055FF", "#7B3FF4", "#00C853", "#FF8800", "#C2255C", "#00B8D4", "#6741D9"];
  const classColor = (id: string) => {
    const sum = (id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return MOB_CLASS_COLORS[sum % MOB_CLASS_COLORS.length];
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>

    {/* ═══════════════════ MOBILE VIEW ═══════════════════ */}
    <div
      className="md:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 pt-[10px] pb-7 text-left"
      style={{
        background: "#EEF4FF",
        minHeight: "100vh",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <style>{`
        .syl-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
        @media (hover:hover) { .syl-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); } }
        .syl-card3d:active { transform: translateY(-1px) scale(.99); }
        .syl-press { transition: all 0.3s ease; }
        .syl-press:hover { transform: translateY(-1px); filter: brightness(1.05); }
        .syl-press:active { transform: scale(.94); }
        @keyframes sylFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .syl-enter > * { animation: sylFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
        .syl-enter > *:nth-child(1) { animation-delay: .04s; }
        .syl-enter > *:nth-child(2) { animation-delay: .10s; }
        .syl-enter > *:nth-child(3) { animation-delay: .16s; }
        .syl-enter > *:nth-child(4) { animation-delay: .22s; }
        .syl-enter > *:nth-child(5) { animation-delay: .28s; }
        .syl-enter > *:nth-child(6) { animation-delay: .34s; }
        .syl-chip-scroll::-webkit-scrollbar { display: none; }
        .syl-chip-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes sylSheetIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes sylBackdropIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className="syl-enter" style={{ display: "flex", flexDirection: "column" }}>

        {/* Page header with Upload pill */}
        <div style={{ padding: "8px 2px 14px", display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.8px", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: 2, background: "#0055FF", display: "inline-block" }} />
              Teacher Dashboard · Documents
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#001040", letterSpacing: "-1.1px", lineHeight: 1.05, margin: 0 }}>Syllabus &amp; Documents</h1>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, marginTop: 6, letterSpacing: "-0.15px" }}>
              Upload PDFs — syllabus, notes, resources — for your classes.
            </div>
          </div>
          <button
            type="button"
            onClick={() => openMobileSheet()}
            disabled={loading || classes.length === 0}
            className="syl-press"
            style={{
              height: 34, padding: "0 13px", borderRadius: 11,
              background: "#0055FF", color: "#fff",
              fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
              display: "flex", alignItems: "center", gap: 5, border: "none",
              boxShadow: "0 1px 2px rgba(9,87,247,.2), 0 4px 10px rgba(9,87,247,.3)",
              cursor: loading || classes.length === 0 ? "not-allowed" : "pointer",
              opacity: loading || classes.length === 0 ? 0.5 : 1,
              fontFamily: "inherit", flexShrink: 0,
            }}
          >
            <Upload className="w-3 h-3" strokeWidth={2.8} />
            Upload
          </button>
        </div>

        {/* HERO */}
        <div
          className="syl-card3d"
          role="button"
          tabIndex={0}
          aria-label="Upload a new document"
          onClick={() => { if (!loading && classes.length > 0) openMobileSheet(); }}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !loading && classes.length > 0) { e.preventDefault(); openMobileSheet(); } }}
          style={{
            background: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
            borderRadius: 26, padding: 22, marginBottom: 14,
            position: "relative", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,8,60,.15), 0 12px 32px rgba(0,8,60,.28)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: "rgba(255,255,255,.14)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <FileText className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,.72)", letterSpacing: "1.8px", textTransform: "uppercase" }}>Total Documents</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2, fontWeight: 500, letterSpacing: "-0.1px" }}>Across all classes</div>
              </div>
              <div style={{ marginLeft: "auto", background: "rgba(0,232,102,.18)", border: "0.5px solid rgba(0,232,102,.5)", color: "#6FFFAA", padding: "5px 12px", borderRadius: 100, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.3px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00FF88", boxShadow: "0 0 8px #00FF88" }} />
                Synced
              </div>
            </div>
            <div style={{ fontSize: 56, fontWeight: 800, color: "#fff", letterSpacing: "-2.6px", lineHeight: 1, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              {docs.length}
              <span style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.65)", letterSpacing: "-0.4px" }}>
                {docs.length === 1 ? "document" : "documents"}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.72)", marginBottom: 20, fontWeight: 500, letterSpacing: "-0.15px" }}>
              <b style={{ color: "#fff", fontWeight: 700 }}>{formatBytes(totalBytes)} stored</b>
              {docs.length === 0 ? " — upload your first resource to get started." : " — plenty of space for more resources."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,.1)", borderRadius: 14, padding: 1, overflow: "hidden" }}>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>{classes.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Classes</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#FF9AA9", letterSpacing: "-0.5px" }}>{docs.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>{docs.length === 1 ? "PDF" : "PDFs"}</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.5px" }}>{formatBytes(totalBytes)}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.58)", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 3 }}>Storage</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter chips */}
        <div className="syl-chip-scroll" style={{ display: "flex", gap: 7, overflowX: "auto", margin: "0 -16px 14px", padding: "2px 16px 6px" }}>
          {filterChips.map(ch => {
            const active = activeFilter === ch.key;
            return (
              <button
                key={ch.key}
                type="button"
                onClick={() => setActiveFilter(ch.key)}
                className="syl-press"
                style={{
                  flexShrink: 0, padding: "8px 14px", borderRadius: 100,
                  background: active ? "#0055FF" : "#fff",
                  color: active ? "#fff" : "#5070B0",
                  fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                  boxShadow: active ? "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.3)" : "0 0.5px 1px rgba(9,87,247,.04), 0 2px 6px rgba(9,87,247,.06)",
                  display: "flex", alignItems: "center", gap: 5, border: "none",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {ch.label}
                <span style={{
                  background: active ? "rgba(255,255,255,.22)" : "#F4F7FE",
                  color: active ? "#fff" : "#5070B0",
                  fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 100,
                }}>
                  {ch.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading ? (
          <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "40px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)" }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#5070B0" }} />
            <span style={{ fontSize: 12, color: "#5070B0" }}>Loading documents…</span>
          </div>
        ) : classes.length === 0 ? (
          <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "24px 20px", textAlign: "center", boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)" }}>
            <div style={{
              width: 68, height: 68, borderRadius: 20,
              background: "linear-gradient(145deg, rgba(9,87,247,.08) 0%, rgba(123,63,244,.08) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px", color: "#0055FF",
              boxShadow: "0 0 0 7px rgba(9,87,247,.04), inset 0 1px 0 rgba(255,255,255,.6)",
            }}>
              <Library className="w-7 h-7" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No classes assigned yet</div>
            <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5 }}>
              Once your principal assigns you classes, you'll be able to upload documents here.
            </div>
          </div>
        ) : classes.map(c => {
          const all = docsByClass.get(c.classId) || [];
          const visible = filterDocs(all);
          // Hide a class entirely if the active filter is another class
          const isThisClassFilter = activeFilter === c.classId;
          const isOtherClassFilter = classes.some(cc => cc.classId === activeFilter) && !isThisClassFilter;
          if (isOtherClassFilter) return null;
          // For syllabus/notes/all: if class has no docs AND filter isn't "all", skip unless it's the "all" filter
          if (activeFilter !== "all" && !isThisClassFilter && visible.length === 0) return null;

          const clsColor = classColor(c.classId);

          return (
            <div key={c.classId} style={{ marginBottom: 14 }}>
              {/* Class group head */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 10px" }}>
                <div style={{ width: 30, height: 30, borderRadius: 10, background: clsColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ background: `${clsColor}1F`, color: clsColor, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: "-0.1px" }}>{c.className}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 600, marginTop: 2, letterSpacing: "-0.1px" }}>
                    {all.length} {all.length === 1 ? "document" : "documents"}
                    {all.length > 0 && ` · ${formatBytes(all.reduce((a, d) => a + (d.fileSize || 0), 0))}`}
                  </div>
                </div>
                {activeFilter !== "all" && isThisClassFilter && (
                  <button
                    type="button"
                    onClick={() => setActiveFilter("all")}
                    className="syl-press"
                    style={{
                      fontSize: 11, fontWeight: 700, color: "#0055FF",
                      letterSpacing: "-0.1px", background: "none", border: "none",
                      display: "flex", alignItems: "center", cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    All <span style={{ fontSize: 16, opacity: 0.8, marginLeft: 2, marginTop: -3 }}>›</span>
                  </button>
                )}
              </div>

              {/* Cards */}
              {visible.length === 0 ? (
                <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "24px 20px", textAlign: "center", boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)" }}>
                  <div style={{
                    width: 68, height: 68, borderRadius: 20,
                    background: "linear-gradient(145deg, rgba(9,87,247,.08) 0%, rgba(123,63,244,.08) 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 14px", color: "#0055FF", position: "relative",
                    boxShadow: "0 0 0 7px rgba(9,87,247,.04), inset 0 1px 0 rgba(255,255,255,.6)",
                  }}>
                    <FileText className="w-7 h-7" strokeWidth={2} />
                    <div style={{
                      position: "absolute", top: -4, right: -4,
                      width: 24, height: 24, background: "#0055FF",
                      borderRadius: "50%", border: "3px solid #fff",
                      boxShadow: "0 2px 6px rgba(9,87,247,.35)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 13, fontWeight: 800, lineHeight: 1,
                    }}>+</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", marginBottom: 5, letterSpacing: "-0.3px" }}>No documents yet</div>
                  <div style={{ fontSize: 12, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", lineHeight: 1.5, marginBottom: 12 }}>
                    Upload syllabus or notes for {c.className} class.
                  </div>
                  <button
                    type="button"
                    onClick={() => openMobileSheet(c.classId)}
                    className="syl-press"
                    style={{
                      background: "#0055FF", color: "#fff",
                      padding: "8px 14px", borderRadius: 10,
                      fontSize: 11, fontWeight: 700, border: "none",
                      boxShadow: "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.3)",
                      cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
                      letterSpacing: "-0.2px", fontFamily: "inherit",
                    }}
                  >
                    <Upload className="w-3 h-3" strokeWidth={2.8} />
                    Upload PDF
                  </button>
                </div>
              ) : visible.map(d => (
                <div
                  key={d.id}
                  className="syl-card3d"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${d.title}`}
                  onClick={() => { if (isHttpUrl(d.fileUrl)) window.open(d.fileUrl, '_blank', 'noopener,noreferrer'); }}
                  onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && isHttpUrl(d.fileUrl)) { e.preventDefault(); window.open(d.fileUrl, '_blank', 'noopener,noreferrer'); } }}
                  style={{
                    background: "#fff", borderRadius: 18, padding: 14, marginBottom: 10,
                    position: "relative", overflow: "hidden",
                    boxShadow: "0 0 0 0.5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.12), 0 18px 44px rgba(0,85,255,.15)",
                  }}
                >
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#FF3355" }} />
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    {/* PDF icon */}
                    <div style={{
                      width: 44, height: 52, borderRadius: 10,
                      background: "linear-gradient(145deg, #FFF5F7 0%, #FFE1E6 100%)",
                      border: "0.5px solid rgba(255,51,85,.25)",
                      display: "flex", alignItems: "flex-end", justifyContent: "center",
                      paddingBottom: 6, position: "relative", flexShrink: 0,
                      boxShadow: "0 2px 6px rgba(255,51,85,.1)",
                    }}>
                      <div style={{
                        position: "absolute", top: 0, right: 0,
                        width: 12, height: 12, background: "#fff",
                        borderLeft: "0.5px solid rgba(255,51,85,.25)",
                        borderBottom: "0.5px solid rgba(255,51,85,.25)",
                        borderRadius: "0 10px 0 4px",
                        boxShadow: "-1px 1px 2px rgba(255,51,85,.05)",
                      }} />
                      <div style={{ fontSize: 9, fontWeight: 900, color: "#FF3355", letterSpacing: "0.5px", lineHeight: 1, position: "relative", zIndex: 2 }}>PDF</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#001040", letterSpacing: "-0.3px", lineHeight: 1.25, marginBottom: 4, wordBreak: "break-word" }}>{d.title}</div>
                      <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, letterSpacing: "-0.1px", marginBottom: 6, wordBreak: "break-all", lineHeight: 1.4 }}>{d.fileName}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, color: "#99AACC", letterSpacing: "0.2px" }}>
                        <span style={{ background: "rgba(255,51,85,.08)", color: "#FF3355", padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>{formatBytes(d.fileSize)}</span>
                        <span style={{ color: "#99AACC" }}>·</span>
                        <span>{formatRelative(d.uploadedAt)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display: "flex", gap: 7 }}>
                    {isHttpUrl(d.fileUrl) ? (
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="syl-press"
                        style={{
                          flex: 1, height: 38, borderRadius: 11,
                          background: "#0055FF", color: "#fff",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          textDecoration: "none",
                          boxShadow: "0 1px 2px rgba(9,87,247,.2), 0 3px 10px rgba(9,87,247,.25)",
                        }}
                      >
                        <Eye className="w-3 h-3" strokeWidth={2.6} />
                        View PDF
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        style={{
                          flex: 1, height: 38, borderRadius: 11,
                          background: "#EAF0FB", color: "#99AACC",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          border: "none", cursor: "not-allowed", fontFamily: "inherit",
                        }}
                      >
                        <Eye className="w-3 h-3" /> Invalid URL
                      </button>
                    )}
                    {isHttpUrl(d.fileUrl) && (
                      <a
                        href={d.fileUrl}
                        download={d.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="syl-press"
                        style={{
                          flex: 1, height: 38, borderRadius: 11,
                          background: "#F4F7FE", color: "#002080",
                          fontSize: 12, fontWeight: 700, letterSpacing: "-0.2px",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          textDecoration: "none",
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Save
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleDelete(d); }}
                      aria-label={`Delete ${d.title}`}
                      className="syl-press"
                      style={{
                        flex: "0 0 42px", height: 38, borderRadius: 11,
                        background: "rgba(255,51,85,.08)", color: "#FF3355",
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2.6} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* AI Documents Intelligence */}
        {!loading && classes.length > 0 && (
          <div
            className="syl-card3d"
            role="button"
            tabIndex={0}
            aria-label="Upload a new document"
            onClick={() => openMobileSheet()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMobileSheet(); } }}
            style={{
              background: "linear-gradient(140deg, #000A33 0%, #001A66 28%, #0044CC 64%, #0055FF 100%)",
              borderRadius: 24, padding: 20, marginTop: 14,
              position: "relative", overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,8,60,.18), 0 12px 32px rgba(0,8,60,.3)",
            }}
          >
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.09) 0%, transparent 45%)", pointerEvents: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12, position: "relative", zIndex: 2 }}>
              <div style={{ width: 40, height: 40, borderRadius: 13, background: "rgba(255,255,255,.14)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", border: "0.5px solid rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFDD55", fontSize: 19 }}>⚡</div>
              <div style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,.95)", letterSpacing: "1.8px", textTransform: "uppercase" }}>AI Documents Intelligence</div>
              <div style={{ marginLeft: "auto", background: "rgba(123,63,244,.3)", border: "0.5px solid rgba(155,95,255,.5)", color: "#DCC8FF", padding: "4px 10px", borderRadius: 100, fontSize: 9, fontWeight: 800, letterSpacing: "0.5px" }}>Tip</div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,.85)", letterSpacing: "-0.15px", marginBottom: 14, position: "relative", zIndex: 2 }}>
              {(() => {
                const emptyClasses = classes.filter(c => (docsByClass.get(c.classId) || []).length === 0);
                if (docs.length === 0) return <>You have <strong style={{ color: "#fff", fontWeight: 700 }}>no documents uploaded yet</strong>. Start by uploading a <strong style={{ color: "#fff", fontWeight: 700 }}>syllabus PDF</strong> and <strong style={{ color: "#fff", fontWeight: 700 }}>lesson notes</strong> so students can access learning material anytime.</>;
                if (emptyClasses.length > 0) return <>You have <strong style={{ color: "#fff", fontWeight: 700 }}>{docs.length} document{docs.length === 1 ? "" : "s"}</strong> uploaded. Consider adding a <strong style={{ color: "#fff", fontWeight: 700 }}>syllabus PDF</strong> and lesson notes for <strong style={{ color: "#fff", fontWeight: 700 }}>{emptyClasses.map(c => c.className).join(", ")}</strong> so students there can access learning material.</>;
                return <>All your classes have documents. Great job — keep material fresh by uploading updates as new units begin.</>;
              })()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", background: "rgba(255,255,255,.1)", borderRadius: 12, padding: 1, gap: 1, overflow: "hidden", position: "relative", zIndex: 2 }}>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px" }}>{docs.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Uploaded</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px" }}>{classes.length}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Classes</div>
              </div>
              <div style={{ background: "rgba(0,20,80,.55)", padding: "11px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#6FFFAA", letterSpacing: "-0.4px" }}>{formatBytes(totalBytes)}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.6)", letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>Used</div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Mobile Upload Bottom Sheet ────────────────────────────────── */}
      {modalOpen && (
        <>
          <div
            onClick={() => !uploading && closeModal()}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,10,40,.5)",
              backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
              animation: "sylBackdropIn .35s cubic-bezier(.2,.9,.3,1) both",
            }}
          />
          <div
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
              background: "#fff",
              borderRadius: "26px 26px 0 0",
              maxHeight: "90vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 -20px 60px rgba(0,8,60,.3)",
              animation: "sylSheetIn .45s cubic-bezier(.34,1.56,.64,1) both",
              fontFamily: "inherit",
            }}
          >
            <div style={{ width: 40, height: 5, background: "rgba(9,87,247,.2)", borderRadius: 100, margin: "10px auto 6px", flexShrink: 0 }} />

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px 14px", borderBottom: "0.5px solid rgba(9,87,247,.08)", flexShrink: 0 }}>
              <div style={{ width: 40, height: 40, borderRadius: 13, background: "#0055FF", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Upload className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#001040", letterSpacing: "-0.4px" }}>Upload Document</div>
                <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500, marginTop: 2, letterSpacing: "-0.1px" }}>PDF only · Max 50 MB</div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={uploading}
                className="syl-press"
                aria-label="Close"
                style={{
                  width: 30, height: 30, borderRadius: 10, background: "#F4F7FE",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#002080", flexShrink: 0, cursor: "pointer",
                  border: "none", fontFamily: "inherit",
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                <X className="w-4 h-4" strokeWidth={2.4} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              {/* Class segmented */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
                  Class
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
                </div>
                <div style={{
                  display: "flex", gap: 4,
                  background: "#F4F7FE", padding: 3, borderRadius: 11,
                  flexWrap: classes.length > 3 ? "wrap" : "nowrap",
                }}>
                  {classes.map(c => {
                    const active = mobileSelClassId === c.classId;
                    return (
                      <button
                        key={c.classId}
                        type="button"
                        disabled={uploading}
                        onClick={() => { setMobileSelClassId(c.classId); setSelClassId(c.classId); }}
                        style={{
                          flex: classes.length > 3 ? "1 1 45%" : 1,
                          padding: "9px 10px", borderRadius: 8,
                          fontSize: 13, fontWeight: active ? 800 : 700,
                          color: active ? "#0055FF" : "#5070B0",
                          background: active ? "#fff" : "transparent",
                          boxShadow: active ? "0 1px 2px rgba(0,0,0,.04), 0 2px 6px rgba(9,87,247,.12)" : "none",
                          textAlign: "center", letterSpacing: "-0.2px",
                          border: "none", cursor: uploading ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          transition: "all .22s cubic-bezier(.2,.9,.3,1)",
                        }}
                      >
                        {c.className}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
                  Title
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={100}
                  disabled={uploading}
                  placeholder="e.g. Term 1 Syllabus, Unit 3 Notes"
                  style={{
                    width: "100%", padding: "13px 14px",
                    background: title ? "#fff" : "#F4F7FE",
                    border: "0.5px solid rgba(9,87,247,.08)",
                    borderRadius: 12,
                    fontSize: 14, fontWeight: title ? 600 : 500, color: "#001040",
                    fontFamily: "inherit", letterSpacing: "-0.2px", outline: "none",
                  }}
                />
                <div style={{ fontSize: 10, color: "#99AACC", marginTop: 6, fontWeight: 500, letterSpacing: "-0.1px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>Students will see this title</span>
                  <span style={{ color: "#5070B0", fontWeight: 600 }}>{title.length} / 100</span>
                </div>
              </div>

              {/* File picker / preview */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#5070B0", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
                  PDF File
                  <span style={{ color: "#FF3355", fontSize: 11, fontWeight: 900 }}>*</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={onFileChosen}
                  disabled={uploading}
                  style={{ display: "none" }}
                />
                {pickedFile ? (
                  <div style={{
                    background: "#fff",
                    border: "0.5px solid rgba(255,51,85,.2)",
                    borderRadius: 14, padding: 12,
                    display: "flex", alignItems: "center", gap: 12,
                    boxShadow: "0 0.5px 1px rgba(255,51,85,.04), 0 2px 8px rgba(255,51,85,.06)",
                  }}>
                    <div style={{
                      width: 36, height: 44, borderRadius: 10,
                      background: "linear-gradient(145deg, #FFF5F7 0%, #FFE1E6 100%)",
                      border: "0.5px solid rgba(255,51,85,.25)",
                      display: "flex", alignItems: "flex-end", justifyContent: "center",
                      paddingBottom: 5, position: "relative", flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 8, fontWeight: 900, color: "#FF3355", letterSpacing: "0.5px" }}>PDF</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#001040", letterSpacing: "-0.2px", wordBreak: "break-all", lineHeight: 1.3, marginBottom: 3 }}>{pickedFile.name}</div>
                      <div style={{ fontSize: 10, color: "#5070B0", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: "rgba(0,200,83,.12)", color: "#00C853", padding: "1px 7px", borderRadius: 5, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00C853" }} />
                          {formatBytes(pickedFile.size)}
                        </span>
                        <span>Ready to upload</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="syl-press"
                      style={{
                        fontSize: 11, fontWeight: 700, color: "#0055FF",
                        letterSpacing: "-0.1px", padding: "6px 10px",
                        borderRadius: 9, background: "rgba(9,87,247,.08)",
                        border: "none", cursor: "pointer", fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      width: "100%",
                      border: "1.5px dashed rgba(9,87,247,.3)",
                      background: "rgba(9,87,247,.03)",
                      borderRadius: 14, padding: "22px 14px",
                      textAlign: "center", cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{
                      width: 46, height: 46, borderRadius: 14,
                      background: "rgba(9,87,247,.1)", color: "#0055FF",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      margin: "0 auto 10px",
                    }}>
                      <Upload className="w-5 h-5" strokeWidth={2.2} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#001040", letterSpacing: "-0.2px", marginBottom: 4 }}>Choose PDF file</div>
                    <div style={{ fontSize: 11, color: "#5070B0", fontWeight: 500 }}>Tap to browse · PDF only · max 50 MB</div>
                  </button>
                )}
              </div>

              {/* Upload progress */}
              {uploading && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#5070B0", marginBottom: 6, fontWeight: 600 }}>
                    <span>Uploading…</span>
                    <span style={{ color: "#0055FF", fontWeight: 800 }}>{progress.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 100, background: "#EAF0FB", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #7B3FF4, #0055FF)", transition: "width .2s linear" }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#99AACC", marginTop: 6, fontWeight: 500 }}>Please don't close this sheet.</div>
                </div>
              )}

              {/* Info callout */}
              <div style={{
                background: "rgba(9,87,247,.06)",
                border: "0.5px solid rgba(9,87,247,.18)",
                borderRadius: 14, padding: "12px 14px",
                display: "flex", gap: 10, alignItems: "flex-start",
              }}>
                <div style={{ width: 26, height: 26, borderRadius: 9, background: "#0055FF", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="8"/>
                  </svg>
                </div>
                <div style={{ flex: 1, fontSize: 11, color: "#002080", lineHeight: 1.5, fontWeight: 500, letterSpacing: "-0.1px" }}>
                  <b style={{ color: "#001040", fontWeight: 700 }}>Students will be notified</b> once this document is uploaded. They can view and download it from their portal.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, padding: "14px 18px 18px", borderTop: "0.5px solid rgba(9,87,247,.08)", background: "#fff", flexShrink: 0 }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={uploading}
                className="syl-press"
                style={{
                  flex: "0 0 100px", height: 46, borderRadius: 14,
                  background: "#F4F7FE", color: "#002080",
                  fontSize: 13, fontWeight: 700, border: "none",
                  letterSpacing: "-0.2px", cursor: uploading ? "not-allowed" : "pointer",
                  fontFamily: "inherit", opacity: uploading ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !title.trim() || !pickedFile || !selClassId}
                className="syl-press"
                style={{
                  flex: 1, height: 46, borderRadius: 14,
                  background: "#0055FF", color: "#fff",
                  fontSize: 14, fontWeight: 800, border: "none",
                  letterSpacing: "-0.2px",
                  cursor: (uploading || !title.trim() || !pickedFile || !selClassId) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  boxShadow: "0 1px 2px rgba(9,87,247,.25), 0 6px 16px rgba(9,87,247,.35)",
                  fontFamily: "inherit",
                  opacity: (uploading || !title.trim() || !pickedFile || !selClassId) ? 0.5 : 1,
                }}
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" strokeWidth={2.8} /> Upload</>}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    {/* ═══════════════════ END MOBILE VIEW ═══════════════════ */}

    {/* ═══════════════════ DESKTOP VIEW — Blue Apple DNA ═══════════════════ */}
    <div
      className="hidden md:block text-left -mx-4 sm:-mx-6 md:-mx-8 -mt-4 sm:-mt-6 md:-mt-8 px-8 pt-6 pb-10"
      style={{
        background: '#EEF4FF',
        minHeight: '100vh',
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <style>{`
        .syld-card3d { transition: all 0.3s ease; will-change: transform, box-shadow; cursor: pointer; }
        @media (hover:hover) {
          .syld-card3d:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 0.5px rgba(0,85,255,.14), 0 10px 26px rgba(0,85,255,.18), 0 26px 54px rgba(0,85,255,.22); }
        }
        .syld-card3d:active { transform: translateY(-1px) scale(.99); }
        .syld-tile { transition: all 0.3s ease; cursor: pointer; will-change: transform, box-shadow; }
        @media (hover:hover) {
          .syld-tile:hover { transform: translateY(-4px) scale(1.012); box-shadow: 0 0 0 .5px rgba(255,255,255,.2), 0 18px 44px rgba(0,85,255,.32), 0 6px 16px rgba(0,85,255,.22); }
        }
        .syld-tile:active { transform: translateY(-1px) scale(.99); }
        .syld-btn { transition: all 0.3s ease; }
        .syld-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
        .syld-btn:active { transform: scale(.97); }
        .syld-chip { transition: all 0.3s ease; }
        .syld-chip:hover { transform: translateY(-1px); }
        @keyframes syldFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .syld-enter > * { animation: syldFadeUp .5s cubic-bezier(.34,1.56,.64,1) both; }
        .syld-enter > *:nth-child(1) { animation-delay: .04s; }
        .syld-enter > *:nth-child(2) { animation-delay: .10s; }
        .syld-enter > *:nth-child(3) { animation-delay: .16s; }
        .syld-enter > *:nth-child(4) { animation-delay: .22s; }
        .syld-enter > *:nth-child(5) { animation-delay: .28s; }
        .syld-enter > *:nth-child(6) { animation-delay: .34s; }
        .syld-pulse { animation: syldPulse 2s ease-in-out infinite; }
        @keyframes syldPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
      `}</style>

      <div className="syld-enter max-w-[1600px] mx-auto">

        {/* ═══ Page Head ═══ */}
        <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '1.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="syld-pulse" style={{ width: 6, height: 6, borderRadius: 2, background: '#0055FF', display: 'inline-block' }} />
              Teacher Dashboard · Documents
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 800, color: '#001040', letterSpacing: '-1.2px', lineHeight: 1.05, margin: 0 }}>
              Syllabus &amp; Documents
            </h1>
            <div style={{ fontSize: 13, color: '#5070B0', fontWeight: 500, marginTop: 6, letterSpacing: '-0.15px' }}>
              Upload PDFs — syllabus, notes, resources — for your classes
            </div>
          </div>
          <button
            type="button"
            onClick={openModal}
            disabled={loading || classes.length === 0}
            className="syld-btn"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              height: 44, padding: '0 20px', borderRadius: 14,
              background: (loading || classes.length === 0) ? '#F5F6F9' : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)',
              color: (loading || classes.length === 0) ? '#99AACC' : '#fff',
              fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
              border: 'none', cursor: (loading || classes.length === 0) ? 'not-allowed' : 'pointer',
              boxShadow: (loading || classes.length === 0) ? 'none' : '0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)',
              fontFamily: 'inherit',
            }}
          >
            <Plus className="w-4 h-4" strokeWidth={2.6} />
            Upload Document
          </button>
        </div>

        {/* ═══ Dark Hero Banner ═══ */}
        {!loading && classes.length > 0 && (() => {
          const classesWithDocs = classes.filter(c => (docsByClass.get(c.classId) || []).length > 0).length;
          const recentCount = docs.filter(d => {
            const ts = (d.uploadedAt as { toDate?: () => Date } | undefined);
            const when = ts?.toDate ? ts.toDate() : (d.uploadedAt ? new Date(d.uploadedAt as string | number | Date) : null);
            if (!when) return false;
            return (Date.now() - when.getTime()) < 7 * 24 * 60 * 60 * 1000;
          }).length;
          return (
            <div
              className="syld-card3d"
              role="button"
              tabIndex={0}
              aria-label="Upload a new document"
              onClick={openModal}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); } }}
              style={{
                background: 'linear-gradient(135deg,#000A33 0%,#001A66 32%,#0044CC 68%,#0055FF 100%)',
                borderRadius: 24, padding: '28px 32px', color: '#fff',
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                marginBottom: 22,
              }}
            >
              <div style={{ position: 'absolute', top: -60, right: -40, width: 320, height: 320, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ position: 'absolute', bottom: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(111,255,170,.18) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1, minWidth: 280 }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: 16,
                    background: 'rgba(255,255,255,.16)', border: '0.5px solid rgba(255,255,255,.26)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                  }}>
                    <Library className="w-7 h-7" color="#fff" strokeWidth={2}/>
                  </div>
                  <div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
                      Library Overview
                    </div>
                    <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.9px', margin: 0, color: '#fff', lineHeight: 1.05 }}>
                      {docs.length} document{docs.length !== 1 ? 's' : ''}
                    </h2>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,.78)', fontWeight: 500, margin: '8px 0 0 0', lineHeight: 1.5 }}>
                      <b style={{ color: '#fff', fontWeight: 700 }}>{formatBytes(totalBytes)} stored</b> across <b style={{ color: '#fff', fontWeight: 700 }}>{classesWithDocs} of {classes.length}</b> assigned class{classes.length !== 1 ? 'es' : ''} — keep updating to help your students stay on track.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px,1fr))', gap: 10 }}>
                  {[
                    { label: 'Storage', value: formatBytes(totalBytes), color: '#6FFFAA' },
                    { label: 'Classes', value: `${classesWithDocs}/${classes.length}`, color: '#fff' },
                    { label: 'This Week', value: recentCount.toString(), color: recentCount > 0 ? '#C8A4FF' : 'rgba(255,255,255,.6)' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '12px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.color, margin: 0, letterSpacing: '-0.4px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ═══ Bright KPI Row (4 gradient tiles) ═══ */}
        {!loading && classes.length > 0 && (() => {
          const classesWithDocs = classes.filter(c => (docsByClass.get(c.classId) || []).length > 0).length;
          const syllabusCount = docs.filter(d => keywordMatch(d.title, 'syllabus')).length;
          const notesCount = docs.filter(d => keywordMatch(d.title, 'note')).length;
          const kpis = [
            {
              label: 'Total Documents', value: docs.length.toString(), sub: `${formatBytes(totalBytes)} stored`,
              grad: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)',
              onClick: () => setActiveFilter('all'),
              iconStroke: (<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>),
            },
            {
              label: 'Classes Covered', value: `${classesWithDocs}`, sub: `of ${classes.length} assigned class${classes.length!==1?'es':''}`,
              grad: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)',
              onClick: () => setActiveFilter('all'),
              iconStroke: (<><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></>),
            },
            {
              label: 'Syllabus Files', value: syllabusCount.toString(), sub: syllabusCount > 0 ? 'Curriculum shared' : 'Upload a syllabus',
              grad: 'linear-gradient(135deg,#00C853 0%,#33DD77 100%)',
              onClick: () => syllabusCount > 0 ? setActiveFilter('syllabus') : openModal(),
              iconStroke: (<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>),
            },
            {
              label: 'Notes & Resources', value: notesCount.toString(), sub: notesCount > 0 ? 'Study material live' : 'Share quick notes',
              grad: 'linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)',
              onClick: () => notesCount > 0 ? setActiveFilter('notes') : openModal(),
              iconStroke: (<><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></>),
            },
          ];
          return (
            <div className="grid grid-cols-4 gap-4 mb-6">
              {kpis.map(k => (
                <div
                  key={k.label}
                  className="syld-tile"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${k.label}`}
                  onClick={k.onClick}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); k.onClick(); } }}
                  style={{
                    background: k.grad, borderRadius: 22, padding: '22px 24px', color: '#fff',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: '0 0 0 .5px rgba(255,255,255,.15), 0 14px 38px rgba(0,85,255,.26), 0 4px 12px rgba(0,85,255,.18)',
                  }}
                >
                  <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,255,255,.22) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'relative', zIndex: 1 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.22)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                        {k.iconStroke}
                      </svg>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,.75)', letterSpacing: '.10em', textTransform: 'uppercase', margin: '0 0 6px 0', position: 'relative', zIndex: 1 }}>{k.label}</div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-0.8px', margin: 0, lineHeight: 1.05, position: 'relative', zIndex: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.78)', margin: '8px 0 0 0', position: 'relative', zIndex: 1 }}>{k.sub}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ═══ Filter Chips ═══ */}
        {!loading && classes.length > 0 && docs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {filterChips.map(chip => {
              const active = activeFilter === chip.key;
              const classTone = chip.key !== 'all' && chip.key !== 'syllabus' && chip.key !== 'notes'
                ? classColor(chip.key) : '#0055FF';
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setActiveFilter(chip.key)}
                  className="syld-chip"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 14px', borderRadius: 999,
                    background: active ? `linear-gradient(135deg, ${classTone}, ${classTone}CC)` : '#fff',
                    color: active ? '#fff' : '#5070B0',
                    border: active ? 'none' : '0.5px solid rgba(0,85,255,.12)',
                    boxShadow: active ? `0 6px 18px ${classTone}50, 0 2px 5px rgba(0,0,0,.06)` : '0 1px 2px rgba(0,85,255,.06)',
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {chip.label}
                  <span style={{
                    padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 800,
                    background: active ? 'rgba(255,255,255,.28)' : 'rgba(0,85,255,.08)',
                    color: active ? '#fff' : '#0055FF',
                    letterSpacing: '0',
                  }}>{chip.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ═══ Body ═══ */}
        {loading ? (
          <div style={{ height: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 className="w-9 h-9 animate-spin" color="#0055FF" />
          </div>
        ) : classes.length === 0 ? (
          <div
            className="syld-card3d"
            style={{
              background: '#fff', borderRadius: 22, padding: '60px 32px',
              border: '0.5px solid rgba(0,85,255,.08)',
              boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            }}
          >
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, boxShadow: '0 10px 24px rgba(123,63,244,.28)' }}>
              <Library className="w-8 h-8" color="#fff" strokeWidth={2}/>
            </div>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>No classes assigned yet</p>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#5070B0', maxWidth: 420, margin: '8px 0 0 0', lineHeight: 1.55 }}>
              Once your principal assigns you classes, you'll be able to upload documents here.
            </p>
          </div>
        ) : docs.length === 0 ? (
          <div
            className="syld-card3d"
            style={{
              background: '#fff', borderRadius: 22, padding: '60px 32px',
              border: '0.5px solid rgba(0,85,255,.08)',
              boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            }}
          >
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, boxShadow: '0 10px 24px rgba(0,85,255,.32)' }}>
              <FileText className="w-8 h-8" color="#fff" strokeWidth={2}/>
            </div>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px', margin: 0 }}>No documents uploaded yet</p>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#5070B0', maxWidth: 440, margin: '8px 0 18px 0', lineHeight: 1.55 }}>
              Click "Upload Document" to share syllabus, notes, or any resource with your students.
            </p>
            <button
              type="button"
              onClick={openModal}
              className="syld-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 18px', borderRadius: 12,
                background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', color: '#fff',
                fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)',
              }}
            >
              <Upload className="w-3.5 h-3.5" strokeWidth={2.6} />
              Upload first document
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {classes.map(c => {
              const allClassDocs = docsByClass.get(c.classId) || [];
              const classDocs = filterDocs(allClassDocs);
              if (allClassDocs.length === 0) return null;
              if (classDocs.length === 0) return null;
              const tone = classColor(c.classId);
              return (
                <div key={c.classId}>
                  {/* Class section header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: `linear-gradient(135deg, ${tone}, ${tone}CC)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: `0 6px 14px ${tone}40`,
                    }}>
                      <Library className="w-5 h-5" color="#fff" strokeWidth={2.2}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#001040', letterSpacing: '-0.3px' }}>
                        {c.className}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#99AACC', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                        {classDocs.length} document{classDocs.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 auto', height: 1, minWidth: 40, background: 'linear-gradient(90deg, rgba(0,85,255,.12), transparent)' }}/>
                  </div>

                  {/* Document grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {classDocs.map(d => (
                      <div
                        key={d.id}
                        className="syld-card3d"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${d.title}`}
                        onClick={() => { if (isHttpUrl(d.fileUrl)) window.open(d.fileUrl, '_blank', 'noopener,noreferrer'); }}
                        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && isHttpUrl(d.fileUrl)) { e.preventDefault(); window.open(d.fileUrl, '_blank', 'noopener,noreferrer'); } }}
                        style={{
                          background: '#fff', borderRadius: 18,
                          border: '0.5px solid rgba(0,85,255,.08)',
                          boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08), 0 18px 44px rgba(0,85,255,.10)',
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        {/* Top accent bar */}
                        <div style={{ height: 3, background: `linear-gradient(90deg, ${tone}, ${tone}66)` }}/>
                        <div style={{ padding: '16px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                            <div style={{
                              width: 46, height: 46, borderRadius: 13,
                              background: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                              boxShadow: '0 6px 14px rgba(255,51,85,.28)',
                            }}>
                              <FileText className="w-5 h-5" color="#fff" strokeWidth={2.2}/>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                {d.title}
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 500, color: '#5070B0', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {d.fileName}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontWeight: 700, color: '#5070B0', letterSpacing: '0.04em', marginBottom: 14 }}>
                            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(0,85,255,.06)' }}>{formatBytes(d.fileSize)}</span>
                            <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#99AACC' }}/>
                            <span>{formatRelative(d.uploadedAt)}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {isHttpUrl(d.fileUrl) && (
                              <a
                                href={d.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="syld-btn"
                                style={{
                                  flex: 1,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                  padding: '9px 14px', borderRadius: 11,
                                  background: 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)', color: '#fff',
                                  fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                                  border: 'none', cursor: 'pointer', textDecoration: 'none',
                                  boxShadow: '0 4px 12px rgba(0,85,255,.32), 0 1px 3px rgba(0,85,255,.2)',
                                }}
                              >
                                <Eye className="w-3.5 h-3.5" strokeWidth={2.4}/>
                                View PDF
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDelete(d); }}
                              className="syld-btn"
                              style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '9px 12px', borderRadius: 11,
                                background: 'rgba(255,51,85,.08)', color: '#C92A2A',
                                fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                                border: '0.5px solid rgba(255,51,85,.22)', cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4}/>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {/* If all groups filtered to empty */}
            {classes.every(c => filterDocs(docsByClass.get(c.classId) || []).length === 0) && activeFilter !== 'all' && (
              <div
                style={{
                  background: '#fff', borderRadius: 18, padding: '40px 24px',
                  border: '0.5px solid rgba(0,85,255,.08)',
                  boxShadow: '0 1px 2px rgba(0,85,255,.06), 0 4px 16px rgba(0,85,255,.08)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: '#001040' }}>No documents match this filter.</div>
                <button
                  type="button"
                  onClick={() => setActiveFilter('all')}
                  className="syld-btn"
                  style={{
                    marginTop: 12,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 10,
                    background: '#EEF4FF', color: '#0055FF',
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                    border: '0.5px solid rgba(0,85,255,.18)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Clear filter
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ AI Intelligence Card ═══ */}
        {!loading && classes.length > 0 && docs.length > 0 && (() => {
          const classesWithDocs = classes.filter(c => (docsByClass.get(c.classId) || []).length > 0).length;
          const missingClasses = classes.length - classesWithDocs;
          const emptyNames = classes
            .filter(c => (docsByClass.get(c.classId) || []).length === 0)
            .slice(0, 3)
            .map(c => c.className)
            .join(', ');
          const syllabusCount = docs.filter(d => keywordMatch(d.title, 'syllabus')).length;
          const aiLead = missingClasses > 0
            ? `You've shared ${docs.length} document${docs.length!==1?'s':''} covering ${classesWithDocs} of ${classes.length} classes. Consider uploading resources for ${emptyNames}${missingClasses > 3 ? ` and ${missingClasses - 3} more` : ''}.`
            : `Great work — every assigned class has at least one document. You've shared ${docs.length} file${docs.length!==1?'s':''} totalling ${formatBytes(totalBytes)}.`;
          return (
            <div
              className="syld-card3d"
              role="button"
              tabIndex={0}
              aria-label="Upload a new document"
              onClick={openModal}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); } }}
              style={{
                background: 'linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)',
                borderRadius: 22, padding: '24px 28px', color: '#fff',
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)',
                marginTop: 22,
              }}
            >
              <div style={{ position: 'absolute', bottom: -50, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ position: 'absolute', top: -30, right: -20, width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, position: 'relative', zIndex: 1, marginBottom: 18 }}>
                <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                    AI Library Intelligence
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 }}>
                    Document Coverage Summary
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.82)', lineHeight: 1.55 }}>
                    {aiLead}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, position: 'relative', zIndex: 1 }}>
                {[
                  { label: 'Coverage', value: `${Math.round((classesWithDocs/Math.max(classes.length,1))*100)}%`, sub: `${classesWithDocs}/${classes.length} classes`, valueColor: classesWithDocs === classes.length ? '#6FFFAA' : '#C8A4FF' },
                  { label: 'Curriculum', value: syllabusCount.toString(), sub: syllabusCount > 0 ? 'Syllabus shared' : 'Upload a syllabus', valueColor: syllabusCount > 0 ? '#6FFFAA' : '#FFCC66' },
                  { label: 'Storage', value: formatBytes(totalBytes), sub: `${docs.length} file${docs.length!==1?'s':''} total`, valueColor: '#66CCFF' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(255,255,255,.10)', borderRadius: 14, padding: '14px 16px', border: '0.5px solid rgba(255,255,255,.14)' }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.valueColor, letterSpacing: '-0.4px', lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '6px 0 0 0' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>

      {/* ── Upload Modal (Desktop only) — redesigned ─────────────────── */}
      {modalOpen && (
        <div
          className="hidden md:flex fixed inset-0 z-50 items-center justify-center p-4"
          style={{ background: 'rgba(0,10,40,.48)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 24,
              width: '100%',
              maxWidth: 560,
              boxShadow: '0 32px 80px rgba(0,8,60,.4), 0 0 0 .5px rgba(0,85,255,.1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '90vh',
              fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            {/* Gradient modal header */}
            <div style={{
              background: 'linear-gradient(135deg,#001040 0%,#0033CC 70%,#0055FF 100%)',
              padding: '20px 24px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: -40, right: -20, width: 180, height: 180, background: 'radial-gradient(circle, rgba(255,255,255,.14) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }}/>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 13,
                    background: 'rgba(255,255,255,.18)', border: '0.5px solid rgba(255,255,255,.26)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
                  }}>
                    <Upload className="w-5 h-5" color="#fff" strokeWidth={2.2}/>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px', margin: 0 }}>Upload Document</h3>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)', margin: '3px 0 0 0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>PDF only · Max 50 MB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={uploading}
                  style={{
                    width: 36, height: 36, borderRadius: 11,
                    background: 'rgba(255,255,255,.14)', border: '0.5px solid rgba(255,255,255,.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  <X className="w-4 h-4" color="#fff" strokeWidth={2.4}/>
                </button>
              </div>
            </div>

            {/* Form body */}
            <div style={{ padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', background: '#F8FAFF' }}>
              {/* Class select */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '0.14em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Class *
                </label>
                <select
                  value={selClassId}
                  onChange={(e) => setSelClassId(e.target.value)}
                  disabled={uploading}
                  style={{
                    width: '100%', height: 44, padding: '0 14px',
                    borderRadius: 12, border: '0.5px solid rgba(0,85,255,.14)',
                    background: '#fff', fontSize: 13, fontWeight: 600, color: '#001040',
                    outline: 'none', fontFamily: 'inherit', cursor: uploading ? 'not-allowed' : 'pointer',
                    opacity: uploading ? 0.5 : 1,
                    boxShadow: '0 1px 2px rgba(0,85,255,.05)',
                  }}
                >
                  {classes.map((c) => (
                    <option key={c.classId} value={c.classId}>{c.className}</option>
                  ))}
                </select>
              </div>

              {/* Title input */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '0.14em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={uploading}
                  maxLength={100}
                  placeholder="e.g. Term 1 Syllabus, Important Notes, Unit 3"
                  style={{
                    width: '100%', height: 44, padding: '0 14px',
                    borderRadius: 12, border: '0.5px solid rgba(0,85,255,.14)',
                    background: '#fff', fontSize: 13, fontWeight: 600, color: '#001040',
                    outline: 'none', fontFamily: 'inherit',
                    opacity: uploading ? 0.5 : 1,
                    boxShadow: '0 1px 2px rgba(0,85,255,.05)',
                  }}
                />
                <p style={{ fontSize: 10, fontWeight: 500, color: '#99AACC', margin: '6px 0 0 2px' }}>
                  Students will see this title. {title.length}/100 characters.
                </p>
              </div>

              {/* File picker */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 800, color: '#5070B0', letterSpacing: '0.14em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  PDF File *
                </label>
                <label
                  htmlFor="syl-file-desktop"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    width: '100%', padding: '22px 16px',
                    borderRadius: 14, border: `1.5px dashed rgba(0,85,255,${pickedFile ? '.22' : '.35'})`,
                    background: pickedFile ? '#fff' : 'rgba(0,85,255,.04)',
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    opacity: uploading ? 0.5 : 1,
                    transition: 'all .2s ease',
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#0055FF 0%,#2277FF 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,85,255,.28)' }}>
                    <Upload className="w-4 h-4" color="#fff" strokeWidth={2.4}/>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px' }}>
                      {pickedFile ? 'Change file' : 'Click to choose a PDF'}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#5070B0', marginTop: 3, letterSpacing: '0.04em' }}>
                      PDF only · up to {formatBytes(MAX_BYTES)}
                    </div>
                  </div>
                </label>
                <input
                  id="syl-file-desktop"
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={onFileChosen}
                  disabled={uploading}
                  style={{ display: 'none' }}
                />
                {pickedFile && (
                  <div style={{
                    marginTop: 10,
                    background: '#fff',
                    border: '0.5px solid rgba(0,85,255,.12)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    boxShadow: '0 1px 2px rgba(0,85,255,.05)',
                  }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#FF3355 0%,#FF6677 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 10px rgba(255,51,85,.24)' }}>
                      <FileText className="w-4 h-4" color="#fff" strokeWidth={2.2}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#001040', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickedFile.name}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#5070B0', marginTop: 2 }}>{formatBytes(pickedFile.size)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {uploading && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#5070B0', marginBottom: 8, letterSpacing: '0.04em' }}>
                    <span>Uploading...</span>
                    <span style={{ color: '#0055FF', fontWeight: 800, fontSize: 13 }}>{progress.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: '#EEF4FF', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: 'linear-gradient(90deg,#0055FF,#2277FF,#7B3FF4)',
                        transition: 'width 0.2s ease',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 10, fontWeight: 500, color: '#99AACC', margin: '8px 0 0 0', letterSpacing: '0.04em' }}>
                    Please don't close this tab.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '0.5px solid rgba(0,85,255,.08)',
              background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
            }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={uploading}
                className="syld-btn"
                style={{
                  padding: '10px 18px', borderRadius: 12,
                  background: '#F5F6F9', border: '0.5px solid rgba(0,85,255,.1)',
                  fontSize: 12, fontWeight: 800, color: '#5070B0',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !title.trim() || !pickedFile || !selClassId}
                className="syld-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', borderRadius: 12,
                  background: (uploading || !title.trim() || !pickedFile || !selClassId)
                    ? '#99AACC'
                    : 'linear-gradient(135deg,#0055FF 0%,#1166FF 100%)',
                  color: '#fff',
                  fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  border: 'none',
                  cursor: (uploading || !title.trim() || !pickedFile || !selClassId) ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: (uploading || !title.trim() || !pickedFile || !selClassId)
                    ? 'none'
                    : '0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)',
                }}
              >
                {uploading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3.5 h-3.5" strokeWidth={2.6}/> Upload</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}
    </>
  );
};

export default Syllabus;