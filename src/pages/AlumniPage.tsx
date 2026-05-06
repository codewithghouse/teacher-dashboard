/**
 * AlumniPage.tsx (teacher) — read-only list of alumni PDFs uploaded by
 * the principal. Source: `alumni_documents` collection, scoped to the
 * teacher's school + branch.
 */

import { useEffect, useState } from "react";
import { Award, FileText, Eye, Loader2, Calendar } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";

interface AlumniDoc {
  id: string;
  schoolId?: string;
  branchId?: string | null;
  title?: string;
  description?: string;
  year?: number | string;
  fileName?: string;
  fileUrl?: string;
  fileSize?: number;
  uploadedAt?: any;
  uploadedByName?: string;
}

const T = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF",
  CARD: "#FFFFFF",
  T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
  P: "#0055FF",
  RED: "#FF3355",
  VIOLET: "#7B3FF4",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  BDR: "0.5px solid rgba(0,85,255,0.10)",
};

const formatBytes = (n?: number): string => {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

const formatDate = (ts: any): string => {
  if (!ts) return "—";
  const d = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default function AlumniPage() {
  const { teacherData } = useAuth();
  const [docs, setDocs] = useState<AlumniDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const schoolId = teacherData?.schoolId;
    if (!schoolId) { setLoading(false); return; }
    const branchId = teacherData?.branchId as string | undefined;
    const inBranch = (raw: any) => !branchId || !raw?.branchId || raw.branchId === branchId;

    const unsub = onSnapshot(
      query(collection(db, "alumni_documents"), where("schoolId", "==", schoolId)),
      (snap) => {
        const arr = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter(inBranch) as AlumniDoc[];
        arr.sort((a, b) => {
          const ta = a.uploadedAt?.toMillis?.() ?? 0;
          const tb = b.uploadedAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setDocs(arr);
        setLoading(false);
      },
      (err) => {
        console.warn("[AlumniPage] listener failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [teacherData?.schoolId, teacherData?.branchId]);

  return (
    <div style={{ background: T.BG, minHeight: "100vh", padding: "24px 16px 40px", fontFamily: T.FONT }}>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.6px", color: T.T4, margin: "0 0 4px", textTransform: "uppercase" }}>
          School branding
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.8px", color: T.T1, margin: 0, lineHeight: 1.1, display: "flex", alignItems: "center", gap: 10 }}>
          <Award size={26} color={T.VIOLET} />
          Alumni
        </h1>
        <p style={{ fontSize: 12, color: T.T3, fontWeight: 500, marginTop: 6, margin: "6px 0 0", lineHeight: 1.5 }}>
          Newsletters and showcases shared by your school's principal.
        </p>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px" }}>
          <Loader2 className="animate-spin" style={{ color: T.P }} size={28} />
        </div>
      )}

      {!loading && docs.length === 0 && (
        <div style={{
          background: T.CARD, borderRadius: 18, padding: "48px 22px", textAlign: "center",
          boxShadow: T.SH, border: T.BDR,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: "rgba(123,63,244,.10)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
          }}>
            <Award size={26} color={T.VIOLET} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 800, color: T.T1, margin: "0 0 6px" }}>
            No alumni documents yet
          </p>
          <p style={{ fontSize: 12, color: T.T3, fontWeight: 500, margin: 0, lineHeight: 1.55, maxWidth: 400, marginInline: "auto" }}>
            When your principal uploads alumni newsletters or showcase PDFs, they'll appear here.
          </p>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {docs.map((d) => <DocCard key={d.id} d={d} />)}
        </div>
      )}
    </div>
  );
}

const DocCard = ({ d }: { d: AlumniDoc }) => (
  <div style={{
    background: T.CARD, borderRadius: 16, padding: "14px 16px",
    boxShadow: T.SH, border: T.BDR,
    display: "flex", alignItems: "center", gap: 14,
  }}>
    <div style={{
      width: 44, height: 44, borderRadius: 12,
      background: "rgba(255,51,85,.10)",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <FileText size={22} color={T.RED} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.T1, marginBottom: 3, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {d.title || d.fileName || "Alumni document"}
      </div>
      {d.description && (
        <div style={{ fontSize: 11, color: T.T3, fontWeight: 500, marginBottom: 5, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.description}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, fontSize: 10, color: T.T4, fontWeight: 600, flexWrap: "wrap" }}>
        {d.year && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Calendar size={10} /> {String(d.year)}</span>}
        <span>{formatBytes(d.fileSize)}</span>
        <span>{formatDate(d.uploadedAt)}</span>
      </div>
    </div>
    {d.fileUrl && (
      <a
        href={d.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="View PDF"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", borderRadius: 10,
          background: "rgba(0,85,255,.10)", color: T.P,
          textDecoration: "none", border: "0.5px solid rgba(0,85,255,.18)",
          fontSize: 11, fontWeight: 700, fontFamily: T.FONT, flexShrink: 0,
        }}
      >
        <Eye size={13} />
        View
      </a>
    )}
  </div>
);
