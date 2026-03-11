import { useState } from "react";
import StatCard from "@/components/StatCard";
import CreateAssignment from "@/components/CreateAssignment";
import GradeAssignment from "@/components/GradeAssignment";

const assignmentsData = [
  { name: "Algebraic Expressions", sub: "Chapter 5 Exercise", cls: "Class 8-A", due: "Today", submissions: "28/32", status: "Due Today", statusColor: "bg-edu-light-red text-edu-red", actions: ["Grade", "Edit"] },
  { name: "Geometry Basics", sub: "Worksheet 3", cls: "Class 9-B", due: "Tomorrow", submissions: "18/28", status: "Active", statusColor: "bg-edu-light-green text-edu-green", actions: ["View", "Edit"] },
  { name: "Linear Equations", sub: "Problem Set 2", cls: "Class 10-A", due: "2 days ago", submissions: "28/30", status: "12 Pending", statusColor: "bg-edu-light-yellow text-edu-orange", actions: ["Grade", "Extend"] },
  { name: "Data Interpretation", sub: "Graph Analysis", cls: "Class 7-C", due: "Feb 20, 2025", submissions: "0/35", status: "Upcoming", statusColor: "bg-edu-light-blue text-edu-blue", actions: ["View", "Edit"] },
  { name: "Percentage Problems", sub: "Word Problems", cls: "Class 8-A", due: "Feb 15, 2025", submissions: "32/32", status: "Graded", statusColor: "bg-edu-light-green text-edu-green", actions: ["Results"] },
];

const Assignments = () => {
  const [view, setView] = useState<'list' | 'create' | 'grade'>('list');
  const [selectedAssignment, setSelectedAssignment] = useState<string>("");

  const handleAction = (action: string, assignmentName: string) => {
    if (action === "Grade") {
      setSelectedAssignment(assignmentName);
      setView('grade');
    }
  };

  if (view === 'create') {
    return (
      <CreateAssignment 
        onCancel={() => setView('list')} 
        onCreate={() => setView('list')} 
      />
    );
  }

  if (view === 'grade') {
    return (
      <GradeAssignment 
        assignmentName={selectedAssignment} 
        onBack={() => setView('list')} 
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Assignments</h1>
          <p className="page-subtitle">Create, manage, and grade student assignments.</p>
        </div>
        <button 
          onClick={() => setView('create')}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Create Assignment
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="24" label="Total Active" iconColor="blue" />
        <StatCard value="8" label="Due This Week" iconColor="yellow" />
        <StatCard value="12" label="Pending Grading" iconColor="red" />
        <StatCard value="76%" label="Avg. Submission" iconColor="green" />
      </div>

      <div className="content-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Assignment</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Class</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Due Date</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Submissions</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignmentsData.map((a, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/5 transition-colors">
                  <td className="py-4 px-4">
                    <p className="font-medium text-foreground text-sm">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.sub}</p>
                  </td>
                  <td className="py-4 px-4 text-sm text-foreground font-medium">{a.cls}</td>
                  <td className="py-4 px-4 text-sm text-foreground">{a.due}</td>
                  <td className="py-4 px-4 text-sm text-foreground">{a.submissions}</td>
                  <td className="py-4 px-4">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${a.statusColor}`}>{a.status}</span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex gap-2">
                      {a.actions.map((act) => (
                        <button 
                          key={act} 
                          onClick={() => handleAction(act, a.name)}
                          className="text-sm text-primary font-bold hover:underline"
                        >
                          {act}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground font-medium">Showing 5 of 24 assignments</p>
          <div className="flex gap-1">
            <button className="px-3 py-1.5 text-sm border rounded-lg text-muted-foreground font-medium hover:bg-muted">Previous</button>
            <button className="w-9 h-9 text-sm bg-primary text-white rounded-lg font-bold">1</button>
            <button className="w-9 h-9 text-sm border rounded-lg text-foreground font-medium hover:bg-muted">2</button>
            <button className="w-9 h-9 text-sm border rounded-lg text-foreground font-medium hover:bg-muted">3</button>
            <button className="px-3 py-1.5 text-sm border rounded-lg text-foreground font-medium hover:bg-muted">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Assignments;


