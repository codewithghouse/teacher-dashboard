const masteryData = [
  { initials: "AR", name: "Aditya Rao", concepts: [92, 88, 75, 85, 90, 87, 72, 89, 68] },
  { initials: "BS", name: "Bhavya Singh", concepts: [85, 82, 70, 88, 86, 74, 68, 84, 72] },
  { initials: "DV", name: "Divya Verma", concepts: [72, 68, 45, 70, 82, 76, 65, 85, 70] },
  { initials: "KM", name: "Karthik Menon", concepts: [48, 42, 38, 55, 62, 48, 58, 68, 45] },
  { initials: "NS", name: "Neha Sharma", concepts: [95, 92, 88, 94, 91, 89, 87, 93, 85] },
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
  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">Concept Mastery</h1>
        <p className="page-subtitle">Track student understanding across mathematical concepts.</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-edu-light-green border border-edu-green" /> Mastered (80%+)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-edu-light-yellow border border-edu-yellow" /> Developing (50-79%)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-edu-light-red border border-edu-red" /> Weak (&lt;50%)</div>
      </div>

      <div className="content-card overflow-x-auto mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-3 text-sm font-semibold text-muted-foreground min-w-[140px]">Student</th>
              {conceptHeaders.map((h) => (
                <th key={h} className="text-center py-3 px-2 text-xs font-semibold text-muted-foreground min-w-[90px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {masteryData.map((s) => (
              <tr key={s.initials} className="border-b">
                <td className="py-3 px-3">
                  <p className="text-xs text-muted-foreground">{s.initials}</p>
                  <p className="font-medium text-foreground text-sm">{s.name}</p>
                </td>
                {s.concepts.map((c, i) => (
                  <td key={i} className="py-3 px-2 text-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${cellColor(c)}`}>{c}%</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Weak Concepts */}
      <div className="content-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Weak Concepts Requiring Attention</h2>
        <div className="space-y-3">
          {weakConcepts.map((w, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-edu-light-red">
              <span className="font-medium text-foreground text-sm">{w.concept}</span>
              <span className="text-sm font-semibold text-edu-red">Class Avg: {w.avg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConceptMastery;
