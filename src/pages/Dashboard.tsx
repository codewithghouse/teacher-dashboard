import StatCard from "@/components/StatCard";
import { Bell } from "lucide-react";

const todaysClasses = [
  { time: "09:00 AM", subject: "Mathematics", cls: "Class 8-A", students: 32, isNow: true },
  { time: "10:30 AM", subject: "Mathematics", cls: "Class 9-B", students: 28, isNow: false },
  { time: "12:00 PM", subject: "Mathematics", cls: "Class 7-C", students: 35, isNow: false },
  { time: "02:00 PM", subject: "Mathematics", cls: "Class 10-A", students: 30, isNow: false },
];

const pendingTasks = [
  { task: "Grade Unit Test Papers", detail: "Class 9-B • Due Today", color: "bg-edu-red", count: 8 },
  { task: "Mark Attendance", detail: "Class 8-A • Pending", color: "bg-edu-yellow" },
  { task: "Review Assignments", detail: "Class 10-A • 4 pending", color: "bg-edu-orange" },
  { task: "Parent Meeting", detail: "Rahul's Parents • 4:00 PM", color: "bg-muted-foreground" },
];

const studentsAttention = [
  { initials: "RK", name: "Rahul Kumar", issue: "3 absences this week", action: "Notify", color: "bg-edu-red" },
  { initials: "SP", name: "Sneha Patel", issue: "Grade dropped 15%", action: "Review", color: "bg-edu-green" },
  { initials: "AM", name: "Amit Mishra", issue: "Missing 2 assignments", action: "Remind", color: "bg-muted-foreground" },
  { initials: "PR", name: "Priya Reddy", issue: "Struggling with Algebra", action: "Help", color: "bg-edu-yellow" },
];

const Dashboard = () => {
  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border rounded-lg px-4 py-2 text-sm text-foreground bg-card">
            Mon, Feb 17, 2025
          </div>
          <div className="relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <span className="absolute -top-1.5 -right-1.5 bg-edu-red text-primary-foreground text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">3</span>
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="text-sm font-semibold text-muted-foreground mb-3">Overview</div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="94.2%" label="Attendance Rate" badge="+2.4%" badgeVariant="green" iconColor="blue" />
        <StatCard value="12" label="Pending Grading" badge="Urgent" badgeVariant="red" iconColor="yellow" />
        <StatCard value="8" label="At-Risk Students" badge="+3" badgeVariant="red" iconColor="red" />
        <StatCard value="4" label="Classes Today" badge="On Track" badgeVariant="green" iconColor="blue" />
      </div>

      {/* Three Column Section */}
      <div className="grid grid-cols-3 gap-4">
        {/* Today's Classes */}
        <div className="content-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Today's Classes</h2>
          <div className="space-y-3">
            {todaysClasses.map((cls, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className="border-l-4 border-primary pl-3">
                  <p className="text-sm font-semibold text-foreground">{cls.time}</p>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">{cls.subject}</p>
                  <p className="text-sm text-muted-foreground">{cls.cls} • {cls.students} students</p>
                </div>
                {cls.isNow && (
                  <span className="badge-blue">Now</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="content-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Pending Tasks</h2>
          <div className="space-y-3">
            {pendingTasks.map((task, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className={`w-10 h-10 rounded-lg ${task.color} opacity-80`} />
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{task.task}</p>
                  <p className="text-xs text-muted-foreground">{task.detail}</p>
                </div>
                {task.count && (
                  <span className="bg-primary text-primary-foreground text-xs w-6 h-6 rounded-full flex items-center justify-center font-medium">
                    {task.count}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Students Needing Attention */}
        <div className="content-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Students Needing Attention</h2>
          <div className="space-y-3">
            {studentsAttention.map((student, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-edu-light-yellow">
                <div className={`avatar-circle ${student.color}`}>{student.initials}</div>
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{student.name}</p>
                  <p className="text-xs text-edu-red">{student.issue}</p>
                </div>
                <button className="text-xs font-medium bg-edu-light-yellow border border-edu-yellow text-edu-orange px-3 py-1 rounded-full">
                  {student.action}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
