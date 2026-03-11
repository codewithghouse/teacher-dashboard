import { useState } from "react";
import ConceptMasteryDetail from "@/components/ConceptMasteryDetail";
import { AlertCircle } from "lucide-react";

const masteryData = [
  { initials: "AR", name: "Aditya Rao", roll: 801, cls: "Class 8-A", color: "bg-edu-blue", concepts: [92, 88, 75, 85, 90, 87, 72, 89, 68] },
  { initials: "BS", name: "Bhavya Singh", roll: 802, cls: "Class 8-A", color: "bg-edu-green", concepts: [85, 82, 70, 88, 86, 74, 68, 84, 72] },
  { initials: "DV", name: "Divya Verma", roll: 803, cls: "Class 8-A", color: "bg-edu-orange", concepts: [72, 68, 45, 70, 82, 76, 65, 85, 70] },
  { initials: "KM", name: "Karthik Menon", roll: 804, cls: "Class 8-A", color: "bg-edu-red", concepts: [48, 42, 38, 55, 62, 48, 58, 68, 45] },
  { initials: "NS", name: "Neha Sharma", roll: 805, cls: "Class 8-A", color: "bg-edu-green", concepts: [95, 92, 88, 94, 91, 89, 87, 93, 85] },
];

const conceptHeaders = [
  "Algebraic Expressions", "Linear Equations", "Quadratic Equations", "Polynomials Basics",
  "Geometry", "Triangles", "Circles", "Statistics", "Probability"
];

const cellColor = (pct: number) => {
  if (pct >= 80) return "bg-edu-light-green text-edu-green";
  if (pct >= 50) return "bg-edu-light-yellow text-edu-orange";
  return "bg-edu-light-red text-edu-red";
};

const weakConcepts = [
  { concept: "Quadratic Equations", avg: "68%" },
  { concept: "Trigonometry", avg: "54%" },
  { concept: "Linear Equations", avg: "74%" },
];

const ConceptMastery = () => {
  const [selectedStudent, setSelectedStudent] = useState<typeof masteryData[0] | null>(null);

  if (selectedStudent) {
    return <ConceptMasteryDetail student={selectedStudent} onBack={() => setSelectedStudent(null)} />;
  }

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-6">
        <h1 className="page-title">Concept Mastery</h1>
        <p className="page-subtitle text-sm font-medium">Track student understanding across mathematical concepts.</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-edu-green shadow-sm" /> Mastered (80%+)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-edu-yellow shadow-sm" /> Developing (50-79%)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-edu-red shadow-sm" /> Weak (&lt;50%)</div>
      </div>

      <div className="content-card border rounded-2xl overflow-hidden mb-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left py-4 px-6 text-xs font-bold text-muted-foreground uppercase tracking-wider min-w-[200px]">Student</th>
                {conceptHeaders.map((h) => (
                  <th key={h} className="text-center py-4 px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider min-w-[100px] leading-tight">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-muted/10">
              {masteryData.map((s) => (
                <tr 
                  key={s.initials} 
                  className="hover:bg-muted/5 transition-colors cursor-pointer"
                  onClick={() => setSelectedStudent(s)}
                >
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg ${s.color} flex items-center justify-center text-white text-[10px] font-bold shadow-sm`}>
                        {s.initials}
                      </div>
                      <div>
                        <p className="font-bold text-foreground text-sm">{s.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Roll: {s.roll}</p>
                      </div>
                    </div>
                  </td>
                  {s.concepts.map((c, i) => (
                    <td key={i} className="py-4 px-2 text-center">
                      <span className={`text-[11px] font-bold px-3 py-1 rounded-full shadow-sm ${cellColor(c)}`}>{c}%</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weak Concepts */}
      <div className="bg-card border rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground mb-4">Weak Concepts Requiring Attention</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {weakConcepts.map((w, i) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-xl border-l-4 border-l-edu-red bg-edu-light-red/10 group hover:shadow-md transition-all">
              <div>
                <span className="font-bold text-foreground text-sm block mb-1">{w.concept}</span>
                <span className="text-[11px] font-bold text-edu-red uppercase">Class Avg: {w.avg}</span>
              </div>
              <button className="p-2 rounded-lg bg-edu-light-red/20 text-edu-red opacity-0 group-hover:opacity-100 transition-opacity">
                <AlertCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConceptMastery;

