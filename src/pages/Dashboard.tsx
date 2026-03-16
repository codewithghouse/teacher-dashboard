import React from 'react';
import { useAuth } from '../lib/AuthContext';

const todaysClasses = [
  { time: "09:00", ampm: "AM", subject: "Mathematics", cls: "Class 8-A", students: 32, isNow: true },
  { time: "10:30", ampm: "AM", subject: "Mathematics", cls: "Class 9-B", students: 28, isNow: false },
  { time: "12:00", ampm: "PM", subject: "Mathematics", cls: "Class 7-C", students: 35, isNow: false },
  { time: "02:00", ampm: "PM", subject: "Mathematics", cls: "Class 10-A", students: 30, isNow: false },
];

const pendingTasks = [
  { task: "Grade Unit Test Papers", detail: "Class 9-B • Due Today", color: "bg-[#ef4444]", bgColor: "bg-[#fef2f2]", textColor: "text-foreground", badge: "8" },
  { task: "Mark Attendance", detail: "Class 8-A • Pending", color: "bg-[#f59e0b]", bgColor: "bg-[#fef9c3]", textColor: "text-foreground" },
  { task: "Review Assignments", detail: "Class 10-A • 4 pending", color: "bg-[#f59e0b]", bgColor: "bg-[#fef9c3]", textColor: "text-foreground" },
  { task: "Parent Meeting", detail: "Rahul's Parents • 4:00 PM", color: "bg-[#64748b]", bgColor: "bg-slate-50", textColor: "text-foreground" },
];

const studentsAttention = [
  { initials: "RK", name: "Rahul Kumar", issue: "3 absences this week", action: "Notify", color: "bg-[#ef4444]", bgColor: "bg-[#fef2f2]", issueColor: "text-[#ef4444]", btnColor: "bg-[#ef4444]" },
  { initials: "SP", name: "Sneha Patel", issue: "Grade dropped 15%", action: "Review", color: "bg-[#f59e0b]", bgColor: "bg-[#fef9c3]", issueColor: "text-[#f59e0b]", btnColor: "bg-[#f59e0b]" },
  { initials: "AM", name: "Amit Mishra", issue: "Missing 2 assignments", action: "Remind", color: "bg-[#f59e0b]", bgColor: "bg-[#fef9c3]", issueColor: "text-[#f59e0b]", btnColor: "bg-[#f59e0b]" },
  { initials: "PR", name: "Priya Reddy", issue: "Struggling with Algebra", action: "Help", color: "bg-[#64748b]", bgColor: "bg-slate-50", issueColor: "text-[#64748b]", btnColor: "bg-[#1e3a8a]" },
];

const Dashboard = () => {
  const { teacherData, user } = useAuth();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1">Welcome back, {teacherData?.name || user?.displayName?.split(' ')[0] || "Teacher"}! Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-card border border-border rounded-xl text-sm font-medium text-foreground shadow-sm">
            Mon, Feb 17, 2025
          </div>
          <div className="w-8 h-8 rounded-full bg-[#ef4444] text-white flex items-center justify-center text-sm font-bold shadow-sm cursor-pointer hover:bg-red-600 transition-colors">
            3
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        {/* Card 1 */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-100" />
            <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200">+2.4%</span>
          </div>
          <h2 className="text-4xl font-black text-foreground mb-1 tracking-tight">94.2%</h2>
          <p className="text-sm font-medium text-muted-foreground">Attendance Rate</p>
        </div>

        {/* Card 2 */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 rounded-xl bg-yellow-100" />
            <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-lg border border-red-200">Urgent</span>
          </div>
          <h2 className="text-4xl font-black text-foreground mb-1 tracking-tight">12</h2>
          <p className="text-sm font-medium text-muted-foreground">Pending Grading</p>
        </div>

        {/* Card 3 */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-100" />
            <span className="px-2.5 py-1 bg-red-100 text-red-600 text-xs font-bold rounded-lg border border-red-200">+3</span>
          </div>
          <h2 className="text-4xl font-black text-foreground mb-1 tracking-tight">8</h2>
          <p className="text-sm font-medium text-muted-foreground">At-Risk Students</p>
        </div>

        {/* Card 4 */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-100" />
            <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200">On Track</span>
          </div>
          <h2 className="text-4xl font-black text-foreground mb-1 tracking-tight">4</h2>
          <p className="text-sm font-medium text-muted-foreground">Classes Today</p>
        </div>
      </div>

      {/* Three Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Classes */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-foreground mb-6">Today's Classes</h2>
          <div className="space-y-4">
            {todaysClasses.map((cls, i) => (
              <div 
                key={i} 
                className={`flex items-start gap-4 p-4 rounded-xl transition-all ${
                  cls.isNow 
                    ? "bg-slate-50 border border-slate-100 shadow-sm relative overflow-hidden" 
                    : "bg-card border border-border"
                }`}
              >
                {cls.isNow && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1e3a8a]" />}
                
                <div className="flex flex-col items-center justify-center min-w-[60px] ml-1">
                  <p className={`text-sm font-bold ${cls.isNow ? 'text-[#1e3a8a]' : 'text-foreground'}`}>{cls.time}</p>
                  <p className={`text-xs font-bold ${cls.isNow ? 'text-[#1e3a8a]/60' : 'text-muted-foreground'}`}>{cls.ampm}</p>
                </div>
                
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-foreground mb-1">{cls.subject}</h3>
                  <p className="text-xs font-medium text-muted-foreground">{cls.cls} • {cls.students} students</p>
                </div>
                
                {cls.isNow && (
                  <span className="px-4 py-1.5 bg-blue-100 text-[#1e3a8a] text-[11px] font-bold rounded-full border border-blue-200 shadow-sm">
                    Now
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-foreground mb-6">Pending Tasks</h2>
          <div className="space-y-4">
            {pendingTasks.map((task, i) => (
              <div key={i} className={`flex items-center gap-5 p-5 rounded-2xl border border-transparent ${task.bgColor}`}>
                <div className={`w-10 h-10 rounded-xl ${task.color} shadow-sm shrink-0`} />
                <div className="flex-1">
                  <h3 className={`text-sm font-bold ${task.textColor} mb-1`}>{task.task}</h3>
                  <p className="text-xs font-medium text-muted-foreground opacity-80">{task.detail}</p>
                </div>
                {task.badge && (
                  <span className={`w-6 h-6 rounded-full ${task.color} text-white text-[10px] font-bold flex items-center justify-center shadow-sm`}>
                    {task.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Students Needing Attention */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-foreground mb-6">Students Needing Attention</h2>
          <div className="space-y-4">
            {studentsAttention.map((student, i) => (
              <div key={i} className={`flex items-center gap-4 p-5 rounded-2xl border border-transparent ${student.bgColor}`}>
                <div className={`w-11 h-11 rounded-full ${student.color} text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0`}>
                  {student.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-foreground mb-1">{student.name}</h3>
                  <p className={`text-xs font-semibold ${student.issueColor} truncate`}>{student.issue}</p>
                </div>
                <button className={`px-4 py-1.5 ${student.btnColor} text-white text-[11px] font-bold rounded-lg shadow-sm hover:opacity-90 transition-opacity`}>
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
