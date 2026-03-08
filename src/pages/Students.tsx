const students = [
  { initials: "AR", name: "Aditya Rao", cls: "Class 8-A", roll: 801, attendance: "98%", avg: "85.5%", status: "Good", color: "bg-edu-blue" },
  { initials: "BS", name: "Bhavya Singh", cls: "Class 8-A", roll: 802, attendance: "95%", avg: "82.0%", status: "Good", color: "bg-edu-green" },
  { initials: "DV", name: "Divya Verma", cls: "Class 8-A", roll: 803, attendance: "88%", avg: "68.5%", status: "Attention", color: "bg-edu-orange" },
  { initials: "KM", name: "Karthik Menon", cls: "Class 8-A", roll: 804, attendance: "82%", avg: "58.0%", status: "At Risk", color: "bg-edu-red" },
  { initials: "NS", name: "Neha Sharma", cls: "Class 8-A", roll: 805, attendance: "97%", avg: "91.2%", status: "Good", color: "bg-edu-green" },
  { initials: "PK", name: "Pranav K", cls: "Class 8-A", roll: 806, attendance: "94%", avg: "76.8%", status: "Good", color: "bg-edu-red" },
  { initials: "RJ", name: "Riya Jain", cls: "Class 8-A", roll: 807, attendance: "96%", avg: "83.5%", status: "Good", color: "bg-edu-blue" },
  { initials: "SK", name: "Sanjay K", cls: "Class 8-A", roll: 808, attendance: "89%", avg: "69.2%", status: "Attention", color: "bg-edu-orange" },
];

const statusColors: Record<string, string> = {
  Good: "bg-edu-light-green text-edu-green",
  Attention: "bg-edu-light-orange text-edu-orange",
  "At Risk": "bg-edu-light-red text-edu-red",
};

const Students = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">View and manage all your students across classes.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="border rounded-lg px-4 py-2 text-sm bg-card" placeholder="Search students..." />
          <button className="border rounded-lg px-4 py-2 text-sm font-medium bg-card">Filter</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {students.map((s) => (
          <div key={s.roll} className="content-card">
            <div className="flex justify-between items-start mb-3">
              <div className={`avatar-circle w-12 h-12 text-base ${s.color}`}>{s.initials}</div>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColors[s.status]}`}>{s.status}</span>
            </div>
            <h3 className="font-semibold text-foreground">{s.name}</h3>
            <p className="text-sm text-muted-foreground mb-3">{s.cls} • Roll: {s.roll}</p>
            <div className="space-y-1 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Attendance</span>
                <span className="font-semibold text-edu-green">{s.attendance}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg. Score</span>
                <span className="font-semibold text-foreground">{s.avg}</span>
              </div>
            </div>
            <button className="w-full bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:opacity-90">
              View Profile
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-6">
        <p className="text-sm text-muted-foreground">Showing 8 of 125 students</p>
        <div className="flex gap-1">
          <button className="px-3 py-1 text-sm border rounded-lg text-muted-foreground">Previous</button>
          <button className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-lg">1</button>
          <button className="px-3 py-1 text-sm border rounded-lg text-foreground">2</button>
          <button className="px-3 py-1 text-sm border rounded-lg text-foreground">3</button>
          <button className="px-3 py-1 text-sm border rounded-lg text-foreground">Next</button>
        </div>
      </div>
    </div>
  );
};

export default Students;
