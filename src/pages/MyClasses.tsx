import { useNavigate } from "react-router-dom";

const classes = [
  { name: "Class 8-A", subject: "Mathematics", students: 32, attendance: "96.2%", performance: "78.5%", nextClass: "Today, 09:00 AM", status: "Active" },
  { name: "Class 9-B", subject: "Mathematics", students: 28, attendance: "92.8%", performance: "72.3%", nextClass: "Today, 10:30 AM", status: "Active" },
  { name: "Class 7-C", subject: "Mathematics", students: 35, attendance: "94.5%", performance: "81.2%", nextClass: "Tomorrow, 09:00 AM", status: "Active" },
  { name: "Class 10-A", subject: "Mathematics", students: 30, attendance: "89.3%", performance: "65.8%", nextClass: "Today, 02:00 PM", status: "Attention" },
];

const MyClasses = () => {
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">My Classes</h1>
          <p className="page-subtitle">Manage all your assigned classes and sections.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="border rounded-lg px-4 py-2 text-sm bg-card" placeholder="Search classes..." />
          <button className="border rounded-lg px-4 py-2 text-sm font-medium bg-card">Filter</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {classes.map((cls) => (
          <div key={cls.name} className="content-card">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-xl bg-edu-light-blue" />
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                cls.status === "Active" ? "bg-edu-light-green text-edu-green" : "bg-edu-light-orange text-edu-orange"
              }`}>
                {cls.status}
              </span>
            </div>
            <h3 className="text-xl font-bold text-foreground">{cls.name}</h3>
            <p className="text-sm text-muted-foreground mb-4">{cls.subject} • {cls.students} Students</p>
            
            <div className="space-y-2 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Attendance Rate</span>
                <span className="font-semibold text-edu-green">{cls.attendance}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg. Performance</span>
                <span className="font-semibold text-foreground">{cls.performance}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Next Class</span>
                <span className="font-semibold text-primary">{cls.nextClass}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigate("/my-classes/class-detail")}
                className="flex-1 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                View Class
              </button>
              <button className="flex-1 border py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors">
                Attendance
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MyClasses;
