const gradebookData = [
  { initials: "AR", name: "Aditya Rao", hw1: 18, hw2: 19, hw3: 20, q1: 9, q2: 10, ut1: 39, ut2: 41, mid: 88, proj: 45, total: 289, grade: "A" },
  { initials: "BS", name: "Bhavya Singh", hw1: 17, hw2: 18, hw3: 19, q1: 8, q2: 9, ut1: 37, ut2: 38, mid: 82, proj: 42, total: 270, grade: "B" },
  { initials: "DV", name: "Divya Verma", hw1: 14, hw2: 15, hw3: 16, q1: 7, q2: 6, ut1: 28, ut2: 30, mid: 68, proj: 35, total: 219, grade: "C" },
  { initials: "KM", name: "Karthik Menon", hw1: 10, hw2: 12, hw3: 11, q1: 5, q2: 4, ut1: 18, ut2: 20, mid: 58, proj: 28, total: 166, grade: "D" },
  { initials: "NS", name: "Neha Sharma", hw1: 20, hw2: 20, hw3: 19, q1: 10, q2: 10, ut1: 45, ut2: 47, mid: 92, proj: 48, total: 311, grade: "A+" },
];

const classAvg = { hw1: 15.8, hw2: 16.2, hw3: 16.5, q1: 7.5, q2: 7.8, ut1: 32.5, ut2: 34.2, mid: 75.8, proj: 38.5, total: 244.8, grade: "B" };

const gradeColor = (grade: string) => {
  if (grade === "A+" || grade === "A") return "text-edu-green";
  if (grade === "B") return "text-edu-blue";
  if (grade === "C") return "text-edu-yellow";
  return "text-edu-red";
};

const scoreColor = (score: number, max: number) => {
  const pct = (score / max) * 100;
  if (pct >= 90) return "text-edu-green";
  if (pct >= 70) return "text-edu-blue";
  if (pct >= 50) return "text-edu-yellow";
  return "text-edu-red";
};

const headers = ["HW1", "HW2", "HW3", "Quiz1", "Quiz2", "UT1", "UT2", "Mid", "Proj"];
const maxMarks = [20, 20, 20, 10, 10, 50, 50, 100, 50];

const Gradebook = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Gradebook</h1>
          <p className="page-subtitle">Complete academic record for Class 8-A</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="border rounded-lg px-4 py-2 text-sm bg-card" placeholder="Search..." />
          <button className="border rounded-lg px-4 py-2 text-sm font-medium bg-card">Export</button>
        </div>
      </div>

      <div className="content-card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-3 text-sm font-semibold text-muted-foreground">Student</th>
              {headers.map((h) => (
                <th key={h} className="text-center py-3 px-3 text-sm font-semibold text-muted-foreground">{h}</th>
              ))}
              <th className="text-center py-3 px-3 text-sm font-semibold text-muted-foreground bg-edu-light-blue">Total</th>
              <th className="text-center py-3 px-3 text-sm font-semibold text-muted-foreground bg-edu-light-blue">Grade</th>
            </tr>
          </thead>
          <tbody>
            {gradebookData.map((s) => {
              const scores = [s.hw1, s.hw2, s.hw3, s.q1, s.q2, s.ut1, s.ut2, s.mid, s.proj];
              return (
                <tr key={s.initials} className="border-b">
                  <td className="py-4 px-3">
                    <p className="text-xs text-muted-foreground">{s.initials}</p>
                    <p className="font-medium text-foreground text-sm">{s.name}</p>
                  </td>
                  {scores.map((sc, i) => (
                    <td key={i} className={`text-center py-4 px-3 text-sm font-semibold ${scoreColor(sc, maxMarks[i])}`}>{sc}</td>
                  ))}
                  <td className="text-center py-4 px-3 text-sm font-bold bg-edu-light-blue/30">{s.total}</td>
                  <td className={`text-center py-4 px-3 text-sm font-bold bg-edu-light-blue/30 ${gradeColor(s.grade)}`}>{s.grade}</td>
                </tr>
              );
            })}
            {/* Class Average */}
            <tr className="bg-muted/50 font-semibold">
              <td className="py-4 px-3 text-sm font-bold text-foreground">Class Avg</td>
              {[classAvg.hw1, classAvg.hw2, classAvg.hw3, classAvg.q1, classAvg.q2, classAvg.ut1, classAvg.ut2, classAvg.mid, classAvg.proj].map((v, i) => (
                <td key={i} className="text-center py-4 px-3 text-sm text-foreground">{v}</td>
              ))}
              <td className="text-center py-4 px-3 text-sm font-bold bg-edu-light-blue/30">{classAvg.total}</td>
              <td className={`text-center py-4 px-3 text-sm font-bold bg-edu-light-blue/30 ${gradeColor(classAvg.grade)}`}>{classAvg.grade}</td>
            </tr>
          </tbody>
        </table>

        {/* Legend */}
        <div className="flex items-center gap-6 mt-6 pt-4 border-t text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-edu-green" /> Excellent (90%+)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-edu-blue" /> Good (70-89%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-edu-yellow" /> Average (50-69%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-edu-red" /> At Risk (&lt;50%)</div>
          <span>Max marks: HW (20), Quiz (10), UT (50), Mid (100), Proj (50)</span>
        </div>
      </div>
    </div>
  );
};

export default Gradebook;
