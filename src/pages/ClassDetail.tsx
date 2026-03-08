import StatCard from "@/components/StatCard";

const students = [
  { initials: "AR", name: "Aditya Rao", email: "aditya.rao@school.edu", roll: 801, attendance: "98%", avg: "85.5%", status: "Good Standing" },
  { initials: "BS", name: "Bhavya Singh", email: "bhavya.singh@school.edu", roll: 802, attendance: "95%", avg: "82.0%", status: "Good Standing" },
  { initials: "DV", name: "Divya Verma", email: "divya.verma@school.edu", roll: 803, attendance: "88%", avg: "68.5%", status: "Needs Attention" },
  { initials: "KM", name: "Karthik Menon", email: "karthik.menon@school.edu", roll: 804, attendance: "82%", avg: "58.0%", status: "At Risk" },
  { initials: "NS", name: "Neha Sharma", email: "neha.sharma@school.edu", roll: 805, attendance: "97%", avg: "91.2%", status: "Good Standing" },
];

const statusColors: Record<string, string> = {
  "Good Standing": "text-edu-green",
  "Needs Attention": "text-edu-orange",
  "At Risk": "text-edu-red",
};

const ClassDetail = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Class 8-A</h1>
          <p className="page-subtitle">Mathematics • 32 Students • Mon-Fri 09:00 AM</p>
        </div>
        <button className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium">
          Mark Attendance
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b pb-3">
        {["Students", "Attendance", "Assignments", "Tests", "Performance"].map((t, i) => (
          <button key={t} className={`px-4 py-2 text-sm font-medium ${i === 0 ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}>{t}</button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="32" label="Total Students" iconColor="blue" />
        <StatCard value="96.2%" label="Attendance" iconColor="green" />
        <StatCard value="78.5%" label="Avg. Score" iconColor="blue" />
        <StatCard value="2" label="At Risk" iconColor="red" />
      </div>

      {/* Student List */}
      <div className="content-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Student List</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Student</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Roll No</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Attendance</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Avg. Score</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Status</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.roll} className="border-b last:border-0">
                <td className="py-4 px-4">
                  <div className="flex items-center gap-3">
                    <div className="avatar-circle bg-primary">{s.initials}</div>
                    <div>
                      <p className="font-medium text-foreground text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 text-sm text-foreground">{s.roll}</td>
                <td className="py-4 px-4 text-sm font-medium text-foreground">{s.attendance}</td>
                <td className="py-4 px-4 text-sm font-medium text-foreground">{s.avg}</td>
                <td className={`py-4 px-4 text-sm font-medium ${statusColors[s.status]}`}>{s.status}</td>
                <td className="py-4 px-4">
                  <button className="text-sm text-primary font-medium hover:underline">View Profile</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">Showing 5 of 32 students</p>
          <div className="flex gap-1">
            <button className="px-3 py-1 text-sm border rounded-lg text-muted-foreground">Previous</button>
            <button className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-lg">1</button>
            <button className="px-3 py-1 text-sm border rounded-lg text-foreground">2</button>
            <button className="px-3 py-1 text-sm border rounded-lg text-foreground">3</button>
            <button className="px-3 py-1 text-sm border rounded-lg text-foreground">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClassDetail;
