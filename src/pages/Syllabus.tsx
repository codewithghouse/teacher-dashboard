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

  const MOB_CLASS_COLORS = ["#0957F7", "#7B3FF4", "#00C853", "#FF8800", "#C2255C", "#00B8D4", "#6741D9"];
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
        .syl-card3d { transition: transform .35s cubic-bezier(.2,.9,.3,1), box-shadow .35s cubic-bezier(.2,.9,.3,1); transform-style: preserve-3d; will-change: transform; }
        @media (hover:hover) { .syl-card3d:hover { transform: translateY(-4px) rotateX(4deg) rotateY(-3deg) scale(1.012); box-shadow: 0 1px 2px rgba(9,87,247,.08), 0 24px 44px rgba(9,87,247,.18), 0 8px 16px rgba(9,87,247,.1); } }
        .syl-card3d:active { transform: translateY(-1px) scale(.985); box-shadow: 0 1px 2px rgba(9,87,247,.1), 0 6px 16px rgba(9,87,247,.14); }
        .syl-press { transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
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
              <span style={{ width: 5, height: 5, borderRadius: 2, background: "#0957F7", display: "inline-block" }} />
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
              background: "#0957F7", color: "#fff",
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
          style={{
            background: "linear-gradient(135deg, #000820 0%, #001466 32%, #0033CC 68%, #0957F7 100%)",
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
                  background: active ? "#0957F7" : "#fff",
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
          <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "40px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)" }}>
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#5070B0" }} />
            <span style={{ fontSize: 12, color: "#5070B0" }}>Loading documents…</span>
          </div>
        ) : classes.length === 0 ? (
          <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "24px 20px", textAlign: "center", boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)" }}>
            <div style={{
              width: 68, height: 68, borderRadius: 20,
              background: "linear-gradient(145deg, rgba(9,87,247,.08) 0%, rgba(123,63,244,.08) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px", color: "#0957F7",
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
                      fontSize: 11, fontWeight: 700, color: "#0957F7",
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
                <div className="syl-card3d" style={{ background: "#fff", borderRadius: 20, padding: "24px 20px", textAlign: "center", boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)" }}>
                  <div style={{
                    width: 68, height: 68, borderRadius: 20,
                    background: "linear-gradient(145deg, rgba(9,87,247,.08) 0%, rgba(123,63,244,.08) 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 14px", color: "#0957F7", position: "relative",
                    boxShadow: "0 0 0 7px rgba(9,87,247,.04), inset 0 1px 0 rgba(255,255,255,.6)",
                  }}>
                    <FileText className="w-7 h-7" strokeWidth={2} />
                    <div style={{
                      position: "absolute", top: -4, right: -4,
                      width: 24, height: 24, background: "#0957F7",
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
                      background: "#0957F7", color: "#fff",
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
                  style={{
                    background: "#fff", borderRadius: 18, padding: 14, marginBottom: 10,
                    position: "relative", overflow: "hidden",
                    boxShadow: "0 0.5px 1px rgba(9,87,247,.04), 0 4px 14px rgba(9,87,247,.08)",
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
                        className="syl-press"
                        style={{
                          flex: 1, height: 38, borderRadius: 11,
                          background: "#0957F7", color: "#fff",
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
                      onClick={() => handleDelete(d)}
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
            style={{
              background: "linear-gradient(140deg, #000820 0%, #001888 28%, #0033CC 64%, #0957F7 100%)",
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
              <div style={{ width: 40, height: 40, borderRadius: 13, background: "#0957F7", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                          color: active ? "#0957F7" : "#5070B0",
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
                        fontSize: 11, fontWeight: 700, color: "#0957F7",
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
                      background: "rgba(9,87,247,.1)", color: "#0957F7",
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
                    <span style={{ color: "#0957F7", fontWeight: 800 }}>{progress.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 100, background: "#EAF0FB", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #7B3FF4, #0957F7)", transition: "width .2s linear" }} />
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
                <div style={{ width: 26, height: 26, borderRadius: 9, background: "#0957F7", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                  background: "#0957F7", color: "#fff",
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

    {/* ═══════════════════ DESKTOP VIEW ═══════════════════ */}
    <div className="hidden md:block text-left min-h-[60vh]">
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
        <button type="button"
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
          <button type="button"
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
                          <button type="button"
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

      {/* ── Upload Modal (Desktop only) ─────────────────────────────── */}
      {modalOpen && (
        <div
          className="hidden md:flex fixed inset-0 z-50 bg-black/50 items-center justify-center p-4"
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
              <button type="button"
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
              <button type="button"
                onClick={closeModal}
                disabled={uploading}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button type="button"
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
    {/* ═══════════════════ END DESKTOP VIEW ═══════════════════ */}
    </>
  );
};

export default Syllabus;