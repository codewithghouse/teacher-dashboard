import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search, Check } from 'lucide-react';

interface EnterScoresProps {
  testName: string;
  onBack: () => void;
}

const studentsData = [
  { id: 1, name: "Aditya Rao", roll: "801", initials: "AR", color: "bg-blue-500", score: "42", grade: "A", percentage: "84%" },
  { id: 2, name: "Bhavya Singh", roll: "802", initials: "BS", color: "bg-green-500", score: "38", grade: "B", percentage: "76%" },
  { id: 3, name: "Divya Verma", roll: "803", initials: "DV", color: "bg-orange-500", score: "28", grade: "C", percentage: "56%" },
  { id: 4, name: "Karthik Menon", roll: "804", initials: "KM", color: "bg-red-500", score: "18", grade: "D", percentage: "36%" },
  { id: 5, name: "Neha Sharma", roll: "805", initials: "NS", color: "bg-purple-500", score: "47", grade: "A", percentage: "94%" },
  { id: 6, name: "Pranav K", roll: "806", initials: "PK", color: "bg-pink-500", score: "35", grade: "B", percentage: "70%" },
  { id: 7, name: "Riya Jain", roll: "807", initials: "RJ", color: "bg-teal-500", score: "41", grade: "A", percentage: "82%" },
  { id: 8, name: "Sanjay K", roll: "808", initials: "SK", color: "bg-orange-600", score: "33", grade: "B", percentage: "66%" },
];

const EnterScores = ({ testName, onBack }: EnterScoresProps) => {
  const [students, setStudents] = useState(studentsData);

  const gradeStats = [
    { label: "A Grade (80%+)", value: "8", color: "text-edu-green" },
    { label: "B Grade (60-79%)", value: "14", color: "text-primary" },
    { label: "C Grade (40-59%)", value: "7", color: "text-edu-yellow" },
    { label: "D Grade (<40%)", value: "3", color: "text-edu-red" },
    { label: "Absent", value: "0", color: "text-muted-foreground" },
  ];

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-start justify-between mb-8">
        <div>
          <button 
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Tests
          </button>
          <h1 className="text-2xl font-bold text-foreground">Enter Test Scores</h1>
          <p className="text-muted-foreground text-sm font-medium mt-1">
            {testName} • Class 8-A • 50 marks
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-white border rounded-lg px-4 py-2 flex items-center gap-3 shadow-sm">
            <span className="text-sm font-medium text-muted-foreground">Class Average:</span>
            <span className="text-sm font-bold text-primary">37.5/50 (75%)</span>
          </div>

          <button 
            onClick={onBack}
            className="bg-edu-green text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:opacity-90 shadow-sm transition-all flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Save Scores
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-8">
        {gradeStats.map((stat, i) => (
          <div key={i} className="bg-white border rounded-xl p-4 text-center shadow-sm hover:border-primary/20 transition-all">
            <p className={`text-2xl font-bold mb-1 ${stat.color}`}>{stat.value}</p>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="content-card border rounded-xl bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-lg font-bold text-foreground">Student Scores</h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Search student..." 
                className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 bg-muted/20"
              />
            </div>
            <button className="flex items-center gap-2 px-6 py-2 border rounded-lg text-sm font-bold text-muted-foreground hover:bg-muted bg-white transition-colors shadow-sm uppercase tracking-wide">
              Import
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {students.map((student) => (
            <div key={student.id} className="border rounded-xl p-5 hover:border-primary/30 transition-all bg-white shadow-sm relative overflow-hidden">
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-10 h-10 rounded-full ${student.color} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                  {student.initials}
                </div>
                <div>
                  <h3 className="font-bold text-foreground leading-none mb-1">{student.name}</h3>
                  <p className="text-[11px] text-muted-foreground font-bold">{student.roll}</p>
                </div>
              </div>
              
              <div className="relative mb-4">
                <input 
                  type="text" 
                  defaultValue={student.score}
                  className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-muted/5 font-bold text-lg"
                />
                <span className="absolute right-[-25px] top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">/50</span>
              </div>

              <div className="flex items-center justify-between mt-6 pt-1">
                <div className={`w-7 h-7 rounded-sm flex items-center justify-center text-xs font-bold ring-1 ring-inset ${
                  student.grade === 'A' ? 'bg-edu-light-green text-edu-green ring-edu-green/20' : 
                  student.grade === 'B' ? 'bg-edu-light-blue text-primary ring-primary/20' :
                  student.grade === 'C' ? 'bg-edu-light-yellow text-edu-orange ring-edu-yellow/20' : 
                  'bg-edu-light-red text-edu-red ring-edu-red/20'
                }`}>
                  {student.grade}
                </div>
                <span className={`text-sm font-bold ${
                   student.grade === 'A' ? 'text-edu-green' : 
                   student.grade === 'B' ? 'text-primary' :
                   student.grade === 'C' ? 'text-edu-yellow' : 
                   'text-edu-red'
                }`}>{student.percentage}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-6 border-t font-medium">
          <p className="text-sm text-muted-foreground">Showing 8 of 32 students</p>
          <div className="flex items-center gap-2">
            <button className="p-2 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map(page => (
                <button 
                  key={page}
                  className={`w-9 h-9 rounded-lg text-sm font-bold flex items-center justify-center transition-all ${
                    page === 1 ? 'bg-primary text-white shadow-sm' : 'hover:bg-muted text-muted-foreground border'
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

export default EnterScores;
