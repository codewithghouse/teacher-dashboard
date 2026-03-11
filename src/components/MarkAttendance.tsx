import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

const studentsData = [
  { id: 1, name: "Aditya Rao", roll: "801", initials: "AR", color: "bg-blue-500", status: "present" },
  { id: 2, name: "Bhavya Singh", roll: "802", initials: "BS", color: "bg-green-500", status: "present" },
  { id: 3, name: "Divya Verma", roll: "803", initials: "DV", color: "bg-orange-500", status: "absent" },
  { id: 4, name: "Karthik Menon", roll: "804", initials: "KM", color: "bg-red-500", status: "late" },
  { id: 5, name: "Neha Sharma", roll: "805", initials: "NS", color: "bg-purple-500", status: "none" },
  { id: 6, name: "Pranav K", roll: "806", initials: "PK", color: "bg-pink-500", status: "present" },
  { id: 7, name: "Riya Jain", roll: "807", initials: "RJ", color: "bg-teal-500", status: "present" },
  { id: 8, name: "Sanjay K", roll: "808", initials: "SK", color: "bg-orange-600", status: "present" },
];

const MarkAttendance = ({ onBack }: { onBack: () => void }) => {
  const [students, setStudents] = useState(studentsData);

  const stats = {
    present: students.filter(s => s.status === 'present').length,
    absent: students.filter(s => s.status === 'absent').length,
    late: students.filter(s => s.status === 'late').length,
  };

  const toggleStatus = (id: number, status: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: s.status === status ? 'none' : status } : s));
  };

  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
  };

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button 
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Overview
          </button>
          <h1 className="page-title text-2xl font-bold text-foreground">Mark Attendance</h1>
          <p className="page-subtitle text-sm text-muted-foreground">Class 8-A • Monday, February 17, 2025</p>
        </div>
        <button 
          onClick={onBack}
          className="bg-edu-green text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm transition-all focus:ring-2 focus:ring-edu-green/20"
        >
          Save Attendance
        </button>
      </div>

      <div className="bg-card border rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Quick Actions:</span>
          <button 
            onClick={markAllPresent}
            className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors bg-white shadow-sm"
          >
            Mark All Present
          </button>
          <button className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors bg-white shadow-sm">
            Copy from Yesterday
          </button>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-edu-green"></div>
            <span className="text-sm font-medium">Present: <span className="font-bold">{stats.present}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-edu-red"></div>
            <span className="text-sm font-medium">Absent: <span className="font-bold">{stats.absent}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-edu-orange"></div>
            <span className="text-sm font-medium">Late: <span className="font-bold">{stats.late}</span></span>
          </div>
        </div>
      </div>

      <div className="content-card border rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6 pb-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Student Attendance</h2>
            <p className="text-sm text-muted-foreground">32 students • Click to toggle status</p>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search student..." 
              className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 bg-muted/30"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {students.map((student) => (
            <div key={student.id} className="border rounded-xl p-4 transition-all hover:border-primary/30 bg-white">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full ${student.color} flex items-center justify-center text-white font-bold text-lg`}>
                  {student.initials}
                </div>
                <div>
                  <h3 className="font-bold text-foreground">{student.name}</h3>
                  <p className="text-xs text-muted-foreground font-medium">Roll: {student.roll}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <button 
                  onClick={() => toggleStatus(student.id, 'present')}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all border ${
                    student.status === 'present' 
                      ? 'bg-edu-green text-white border-edu-green' 
                      : 'bg-white text-muted-foreground border-muted hover:border-edu-green'
                  }`}
                >
                  Present
                </button>
                <button 
                  onClick={() => toggleStatus(student.id, 'absent')}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all border ${
                    student.status === 'absent' 
                      ? 'bg-edu-red text-white border-edu-red' 
                      : 'bg-white text-muted-foreground border-muted hover:border-edu-red'
                  }`}
                >
                  Absent
                </button>
                <button 
                  onClick={() => toggleStatus(student.id, 'late')}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all border ${
                    student.status === 'late' 
                      ? 'bg-edu-orange text-white border-edu-orange' 
                      : 'bg-white text-muted-foreground border-muted hover:border-edu-orange'
                  }`}
                >
                  Late
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground font-medium">Showing 8 of 32 students</p>
          <div className="flex items-center gap-2">
            <button className="p-2 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map(page => (
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
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarkAttendance;
