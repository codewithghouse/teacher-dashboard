const reports = [
  { title: "Class Performance Report", desc: "Comprehensive analysis of class performance including grades, attendance, and progress trends.", popular: true },
  { title: "Individual Progress Report", desc: "Detailed report for individual students covering all academic metrics and recommendations.", popular: true },
  { title: "Attendance Summary", desc: "Monthly or term-wise attendance report with statistics and absentee analysis.", popular: false },
  { title: "At-Risk Students Report", desc: "List of students with academic or attendance concerns requiring intervention.", popular: false },
];

const Reports = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Generate and download academic reports.</p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {reports.map((r) => (
          <div key={r.title} className="content-card">
            {r.popular && <span className="badge-yellow mb-3 inline-block">Popular</span>}
            <h3 className="text-lg font-semibold text-foreground mb-2">{r.title}</h3>
            <p className="text-sm text-muted-foreground mb-5">{r.desc}</p>
            <div className="flex gap-3">
              <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">Generate</button>
              <button className="border px-4 py-2 rounded-lg text-sm font-medium text-foreground">Preview</button>
            </div>
            <div className="flex gap-2 mt-3">
              <span className="text-xs text-muted-foreground border px-2 py-1 rounded">PDF</span>
              <span className="text-xs text-muted-foreground border px-2 py-1 rounded">Excel</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Reports;
