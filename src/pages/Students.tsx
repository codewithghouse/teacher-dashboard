import { useState } from "react";
import StudentProfile from "@/components/StudentProfile";

const studentsData = [
  { initials: "AR", name: "Aditya Rao", cls: "Class 8-A", roll: 801, attendance: "98%", avg: "85.5%", status: "Good", color: "bg-edu-blue" },
  { initials: "BS", name: "Bhavya Singh", cls: "Class 8-A", roll: 802, attendance: "95%", avg: "82.0%", status: "Good", color: "bg-edu-green" },
  { initials: "DV", name: "Divya Verma", cls: "Class 8-A", roll: 803, attendance: "88%", avg: "68.5%", status: "Attention", color: "bg-edu-orange" },
  { initials: "KM", name: "Karthik Menon", cls: "Class 8-A", roll: 804, attendance: "82%", avg: "58.0%", status: "At Risk", color: "bg-edu-red" },
  { initials: "NS", name: "Neha Sharma", cls: "Class 8-A", roll: 805, attendance: "97%", avg: "91.2%", status: "Good", color: "bg-edu-green" },
  { initials: "PK", name: "Pranav K", cls: "Class 8-A", roll: 806, attendance: "94%", avg: "76.8%", status: "Good", color: "bg-[#ec4899]" },
  { initials: "RJ", name: "Riya Jain", cls: "Class 8-A", roll: 807, attendance: "96%", avg: "83.5%", status: "Good", color: "bg-[#14b8a6]" },
  { initials: "SK", name: "Sanjay K", cls: "Class 8-A", roll: 808, attendance: "89%", avg: "69.2%", status: "Attention", color: "bg-[#ea580c]" },
];

const statusColors: Record<string, string> = {
  Good: "bg-edu-light-green text-edu-green",
  Attention: "bg-edu-light-orange text-edu-orange",
  "At Risk": "bg-edu-light-red text-edu-red",
};

const Students = () => {
  const [selectedStudent, setSelectedStudent] = useState<typeof studentsData[0] | null>(null);

  if (selectedStudent) {
    return <StudentProfile student={selectedStudent} onBack={() => setSelectedStudent(null)} />;
  }

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">View and manage all your students across classes.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input 
              className="border rounded-lg pl-9 pr-4 py-2 text-sm bg-card w-64 focus:outline-none focus:ring-2 focus:ring-primary/20" 
              placeholder="Search students..." 
            />
            <svg className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button className="border rounded-lg px-4 py-2 text-sm font-bold bg-card flex items-center gap-2 hover:bg-muted transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filter
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {studentsData.map((s) => (
          <div key={s.roll} className="content-card border rounded-2xl p-5 hover:border-primary/30 transition-all bg-white shadow-sm flex flex-col h-full">
            <div className="flex justify-between items-start mb-5">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-sm ${s.color}`}>{s.initials}</div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${statusColors[s.status]}`}>{s.status}</span>
            </div>
            <h3 className="font-bold text-foreground text-lg leading-tight mb-0.5">{s.name}</h3>
            <p className="text-xs text-muted-foreground mb-6 font-medium">{s.cls} • Roll: {s.roll}</p>
            
            <div className="space-y-3 mb-8 flex-grow">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-muted-foreground">Attendance</span>
                <span className="text-edu-green">{s.attendance}</span>
              </div>
              <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-edu-green" style={{ width: s.attendance }} />
              </div>
              
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-muted-foreground">Avg. Score</span>
                <span className="text-foreground">{s.avg}</span>
              </div>
              <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: s.avg }} />
              </div>
            </div>
            
            <button 
              onClick={() => setSelectedStudent(s)}
              className="w-full bg-primary/5 text-primary border border-primary/10 py-2.5 rounded-xl text-xs font-bold hover:bg-primary hover:text-white transition-all shadow-sm uppercase tracking-wide"
            >
              View Profile
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-8 pt-6 border-t">
        <p className="text-sm text-muted-foreground font-medium">Showing 8 of 125 students</p>
        <div className="flex items-center gap-2">
          <button className="p-2 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map(page => (
              <button 
                key={page}
                className={`w-9 h-9 rounded-lg text-sm font-bold flex items-center justify-center transition-all ${
                  page === 1 ? 'bg-primary text-white shadow-sm' : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                {page}
              </button>
            ))}
          </div>
          <button className="p-2 border rounded-lg hover:bg-muted transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Students;

