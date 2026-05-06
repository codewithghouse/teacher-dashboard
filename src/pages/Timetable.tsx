/**
 * Timetable.tsx (teacher) — read-only WYSIWYG view of the school's timetable.
 *
 * Source: `timetable_documents/{schoolId}_{branchSeg}` singleton (written by
 * principal-dashboard's TimetableSetup). Renders each sheet exactly as the
 * principal uploaded it — no schema enforcement.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Calendar, Loader2 } from "lucide-react";

// Rows wrapped in {cells} objects to satisfy Firestore's no-nested-arrays rule.
interface TimetableSheet { name: string; headers: string[]; rows: { cells: string[] }[]; }
interface TimetableDoc {
  schoolId?: string;
  branchId?: string | null;
  fileName?: string;
  sheets: TimetableSheet[];
  uploadedAt?: any;
  uploadedByName?: string;
}

const T = {
  FONT: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
  BG: "#EEF4FF", CARD: "#FFFFFF",
  T1: "#001040", T2: "#002080", T3: "#5070B0", T4: "#99AACC",
  P: "#0055FF",
  SH: "0 0 0 0.5px rgba(0,85,255,0.10), 0 4px 16px rgba(0,85,255,0.12), 0 18px 44px rgba(0,85,255,0.15)",
  BDR: "0.5px solid rgba(0,85,255,0.10)",
};

export default function Timetable() {
  const { teacherData } = useAuth();
  const [tt, setTt] = useState<TimetableDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState<string>("");

  useEffect(() => {
    const schoolId = teacherData?.schoolId as string | undefined;
    if (!schoolId) { setLoading(false); return; }
    const branchSeg = (teacherData?.branchId as string | undefined) || "_default";
    const unsub = onSnapshot(
      doc(db, "timetable_documents", `${schoolId}_${branchSeg}`),
      (s) => {
        setTt(s.exists() ? (s.data() as TimetableDoc) : null);
        setLoading(false);
      },
      (err) => {
        console.warn("[Timetable] listener failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [teacherData?.schoolId, teacherData?.branchId]);

  // Default sheet selection — first one
  useEffect(() => {
    if (tt && tt.sheets.length > 0 && !tt.sheets.some(s => s.name === activeSheet)) {
      setActiveSheet(tt.sheets[0].name);
    }
  }, [tt, activeSheet]);

  const current = useMemo(() => tt?.sheets.find(s => s.name === activeSheet) || null, [tt, activeSheet]);
  const myName = String(teacherData?.name || (teacherData as any)?.fullName || "").trim().toLowerCase();

  return (
    <div style={{ background: T.BG, minHeight: "100vh", padding: "24px 16px 40px", fontFamily: T.FONT }}>
      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.6px", color: T.T4, margin: "0 0 4px", textTransform: "uppercase" }}>
          School schedule
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.8px", color: T.T1, margin: 0, lineHeight: 1.1, display: "flex", alignItems: "center", gap: 10 }}>
          <Calendar size={26} color={T.P} />
          Timetable
        </h1>
        <p style={{ fontSize: 12, color: T.T3, fontWeight: 500, marginTop: 6, margin: "6px 0 0", lineHeight: 1.5 }}>
          {tt?.fileName ? <>Published by your school: <strong style={{ color: T.T1 }}>{tt.fileName}</strong></> : <>Your school's published periods.</>}
        </p>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0" }}>
          <Loader2 size={26} className="animate-spin" style={{ color: T.P }} />
        </div>
      )}

      {!loading && !tt && (
        <EmptyState title="No timetable published yet" body="Your principal hasn't uploaded the school timetable yet. It'll appear here automatically once they do." />
      )}

      {!loading && tt && tt.sheets.length === 0 && (
        <EmptyState title="Timetable is empty" body="The published Excel had no sheets with data." />
      )}

      {!loading && tt && tt.sheets.length > 0 && (
        <div style={{ background: T.CARD, borderRadius: 18, padding: 16, boxShadow: T.SH, border: T.BDR }}>
          <SheetTabs sheets={tt.sheets} active={activeSheet} onChange={setActiveSheet} />
          {current && <SheetTable sheet={current} highlightTeacherName={myName} />}
        </div>
      )}
    </div>
  );
}

const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div style={{ background: T.CARD, borderRadius: 18, padding: "44px 22px", textAlign: "center", boxShadow: T.SH, border: T.BDR }}>
    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(0,85,255,.08)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
      <Calendar size={26} color={T.P} />
    </div>
    <p style={{ fontSize: 16, fontWeight: 800, color: T.T1, margin: "0 0 6px" }}>{title}</p>
    <p style={{ fontSize: 12, color: T.T3, fontWeight: 500, margin: 0, lineHeight: 1.55, maxWidth: 380, marginInline: "auto" }}>{body}</p>
  </div>
);

const SheetTabs = ({ sheets, active, onChange }: {
  sheets: TimetableSheet[]; active: string; onChange: (n: string) => void;
}) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
    {sheets.map(s => {
      const isActive = s.name === active;
      return (
        <button key={s.name} onClick={() => onChange(s.name)}
          style={{
            padding: "7px 14px", borderRadius: 999,
            background: isActive ? `linear-gradient(135deg, ${T.P}, #1166FF)` : T.BG,
            color: isActive ? "#fff" : T.T2,
            border: isActive ? "0.5px solid transparent" : T.BDR,
            fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.FONT,
            letterSpacing: "0.04em",
            boxShadow: isActive ? "0 4px 12px rgba(0,85,255,0.28)" : "none",
          }}>
          {s.name}
        </button>
      );
    })}
  </div>
);

// Render a sheet exactly as principal uploaded it. Cells whose text contains
// the teacher's name get a subtle green tint so they can spot their periods.
const SheetTable = ({ sheet, highlightTeacherName }: { sheet: TimetableSheet; highlightTeacherName: string }) => {
  if (sheet.rows.length === 0 && sheet.headers.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: T.T3, fontSize: 12, fontWeight: 600 }}>
        This sheet is empty.
      </div>
    );
  }
  const isMyCell = (cell: string): boolean => {
    if (!highlightTeacherName) return false;
    const c = String(cell || "").toLowerCase();
    return !!c && c.includes(highlightTeacherName);
  };
  return (
    <div style={{ background: "rgba(0,85,255,.04)", border: "0.5px solid rgba(0,85,255,.10)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: T.FONT, minWidth: "max-content" }}>
          {sheet.headers.length > 0 && (
            <thead>
              <tr style={{ background: "rgba(0,85,255,.08)" }}>
                {sheet.headers.map((h, i) => (
                  <th key={i} style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.4px", color: T.T1,
                    padding: "10px 12px", textAlign: "left", borderRight: "0.5px solid rgba(0,85,255,.10)",
                    whiteSpace: "nowrap", textTransform: "uppercase",
                  }}>
                    {h || "—"}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {sheet.rows.map((row, ri) => {
              const cells = row.cells || [];
              return (
                <tr key={ri} style={{ borderTop: "0.5px solid rgba(0,85,255,.06)" }}>
                  {Array.from({ length: Math.max(sheet.headers.length, cells.length) }, (_, ci) => {
                    const cell = String(cells[ci] ?? "");
                    const mine = isMyCell(cell);
                    return (
                      <td key={ci} style={{
                        fontSize: 12, color: mine ? "#005A20" : T.T1,
                        fontWeight: mine ? 700 : 500,
                        padding: "9px 12px",
                        borderRight: "0.5px solid rgba(0,85,255,.06)",
                        background: mine ? "rgba(0,200,83,.10)" : T.CARD,
                        verticalAlign: "top",
                        whiteSpace: "pre-wrap",
                        ...(mine ? { boxShadow: "inset 0 0 0 0.5px rgba(0,200,83,.22)" } : {}),
                      }}>
                        {cell === "" ? <span style={{ color: T.T4 }}>—</span> : cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
