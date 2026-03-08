const alerts = [
  {
    initials: "RK", name: "Rahul Kumar", severity: "Critical", cls: "Class 9-B", color: "bg-edu-red",
    issue: "Attendance dropped to 72% - 8 absences in last 3 weeks",
    details: ["Last present: 3 days ago", "Pattern: Mondays & Fridays"],
    actions: ["Contact Parent", "Mark Resolved"],
  },
  {
    initials: "KM", name: "Karthik Menon", severity: "Critical", cls: "Class 8-A", color: "bg-edu-red",
    issue: "Grade average dropped 22% in last month - from 72% to 50%",
    details: ["Trend: Declining", "At risk of failing"],
    actions: ["Schedule Meeting", "View Profile"],
  },
  {
    initials: "SP", name: "Sneha Patel", severity: "High Priority", cls: "Class 10-A", color: "bg-edu-orange",
    issue: "Missing 4 assignments - last submission 2 weeks ago",
    details: ["Overdue: Algebra, Geometry", "Grade impact: -15%"],
    actions: ["Send Reminder", "Extend Deadline"],
  },
  {
    initials: "AM", name: "Amit Mishra", severity: "High Priority", cls: "Class 7-C", color: "bg-edu-yellow",
    issue: "Frequently late to class - 6 late arrivals this month",
    details: [],
    actions: ["Talk to Student", "Notify Parent"],
  },
];

const severityColors: Record<string, string> = {
  Critical: "bg-edu-light-red text-edu-red",
  "High Priority": "bg-edu-light-orange text-edu-orange",
};

const tabs = ["All Alerts (16)", "Attendance (4)", "Grades (6)", "Submissions (3)", "Behavior (3)"];

const RisksAlerts = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">Risks & Alerts</h1>
        <p className="page-subtitle">Monitor and respond to student concerns.</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="stat-card"><div><p className="text-3xl font-bold text-edu-red">3</p><p className="text-sm text-muted-foreground">Critical</p></div></div>
        <div className="stat-card"><div><p className="text-3xl font-bold text-edu-orange">5</p><p className="text-sm text-muted-foreground">High Priority</p></div></div>
        <div className="stat-card"><div><p className="text-3xl font-bold text-edu-yellow">8</p><p className="text-sm text-muted-foreground">Medium Priority</p></div></div>
        <div className="stat-card"><div><p className="text-3xl font-bold text-edu-green">12</p><p className="text-sm text-muted-foreground">Resolved This Week</p></div></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map((t, i) => (
          <button key={t} className={`px-4 py-2 text-sm rounded-lg font-medium ${i === 0 ? "bg-primary text-primary-foreground" : "border text-foreground"}`}>{t}</button>
        ))}
      </div>

      {/* Alert Cards */}
      <div className="space-y-4">
        {alerts.map((a, i) => (
          <div key={i} className="content-card">
            <div className="flex items-start gap-4">
              <div className={`avatar-circle w-12 h-12 text-base ${a.color}`}>{a.initials}</div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-foreground">{a.name}</h3>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${severityColors[a.severity]}`}>{a.severity}</span>
                  <span className="text-xs text-muted-foreground">{a.cls}</span>
                </div>
                <p className="text-sm text-foreground mb-1">{a.issue}</p>
                {a.details.map((d, j) => (
                  <p key={j} className="text-xs text-muted-foreground">{d}</p>
                ))}
              </div>
              <div className="flex gap-2">
                {a.actions.map((act) => (
                  <button key={act} className="border text-sm px-3 py-1.5 rounded-lg font-medium text-foreground hover:bg-muted">{act}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RisksAlerts;
