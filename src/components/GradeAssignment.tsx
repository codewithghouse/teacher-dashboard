import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Download, Check } from 'lucide-react';

interface GradeAssignmentProps {
  assignmentName: string;
  onBack: () => void;
}

const submissionsData = [
  { id: 1, name: "Aditya Rao", roll: "801", initials: "AR", color: "bg-blue-500", submitted: "Feb 16, 09:30 AM", status: "On Time", statusColor: "text-edu-green", attachment: "worksheet.pdf", grade: "", feedback: "" },
  { id: 2, name: "Bhavya Singh", roll: "802", initials: "BS", color: "bg-green-500", submitted: "Feb 17, 11:45 PM", status: "Late", statusColor: "text-edu-red", attachment: "answers.pdf", grade: "", feedback: "" },
  { id: 3, name: "Divya Verma", roll: "803", initials: "DV", color: "bg-orange-500", submitted: "Feb 15, 03:20 PM", status: "On Time", statusColor: "text-edu-green", attachment: "solutions.jpg", grade: "", feedback: "" },
  { id: 4, name: "Karthik Menon", roll: "804", initials: "KM", color: "bg-red-500", submitted: "—", status: "Not Submitted", statusColor: "text-muted-foreground", attachment: "—", grade: "", feedback: "" },
  { id: 5, name: "Neha Sharma", roll: "805", initials: "NS", color: "bg-purple-500", submitted: "Feb 16, 08:15 PM", status: "On Time", statusColor: "text-edu-green", attachment: "homework.pdf", grade: "", feedback: "" },
];

const GradeAssignment = ({ assignmentName, onBack }: GradeAssignmentProps) => {
  const [submissions, setSubmissions] = useState(submissionsData);
  const totalSubmissions = 28;
  const gradedCount = 16;

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-start justify-between mb-8">
        <div>
          <button 
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Assignments
          </button>
          <h1 className="text-2xl font-bold text-foreground">Grade: {assignmentName}</h1>
          <p className="text-muted-foreground text-sm font-medium mt-1">
            Class 8-A • {totalSubmissions} submissions • Due: Feb 17, 2025
          </p>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="bg-white border rounded-lg px-4 py-2 flex items-center gap-4 shadow-sm">
            <span className="text-sm font-medium text-muted-foreground">Progress:</span>
            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-edu-green transition-all duration-1000" 
                style={{ width: `${(gradedCount / totalSubmissions) * 100}%` }}
              ></div>
            </div>
            <span className="text-sm font-bold text-foreground">{gradedCount}/{totalSubmissions}</span>
          </div>

          <button 
            onClick={onBack}
            className="bg-edu-green text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:opacity-90 shadow-sm transition-all flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Save Grades
          </button>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-3">
          <input 
            type="text" 
            placeholder="Search student..." 
            className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 bg-white"
          />
          <select className="px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white">
            <option>All Status</option>
            <option>On Time</option>
            <option>Late</option>
            <option>Not Submitted</option>
          </select>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted bg-white transition-colors shadow-sm">
          <Download className="w-4 h-4" />
          Export Grades
        </button>
      </div>

      <div className="content-card border rounded-xl bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider">Student</th>
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider">Submitted</th>
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider">Attachments</th>
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider w-32">Grade</th>
                <th className="py-4 px-6 text-sm font-bold text-muted-foreground uppercase tracking-wider">Feedback</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {submissions.map((s) => (
                <tr key={s.id} className="hover:bg-muted/10 transition-colors">
                  <td className="py-5 px-6">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-muted-foreground mb-1">{s.initials}</span>
                      <span className="font-bold text-foreground">{s.name}</span>
                      <span className="text-xs text-muted-foreground font-medium">Roll: {s.roll}</span>
                    </div>
                  </td>
                  <td className="py-5 px-6 text-sm font-medium text-foreground">{s.submitted}</td>
                  <td className="py-5 px-6">
                    <span className={`text-sm font-bold ${s.statusColor}`}>{s.status}</span>
                  </td>
                  <td className="py-5 px-6">
                    {s.attachment !== "—" ? (
                      <button className="flex items-center gap-2 text-primary hover:underline text-sm font-medium">
                        <FileText className="w-4 h-4" />
                        {s.attachment}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-5 px-6">
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        placeholder="" 
                        className="w-16 px-2 py-1.5 border rounded-md text-sm font-bold text-center focus:ring-2 focus:ring-primary/20 outline-none"
                      />
                      <span className="text-sm font-bold text-muted-foreground">/100</span>
                    </div>
                  </td>
                  <td className="py-5 px-6">
                    <input 
                      type="text" 
                      placeholder="Add feedback..." 
                      className="w-full px-3 py-1.5 border rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between p-6 border-t bg-muted/10">
          <p className="text-sm text-muted-foreground font-medium">Showing 5 of {totalSubmissions} submissions</p>
          <div className="flex items-center gap-2">
            <button className="p-2 border rounded-lg hover:bg-white transition-colors disabled:opacity-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(page => (
                <button 
                  key={page}
                  className={`w-9 h-9 rounded-lg text-sm font-bold flex items-center justify-center transition-all ${
                    page === 1 ? 'bg-primary text-white shadow-sm' : 'hover:bg-white text-muted-foreground border'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>
            <button className="p-2 border rounded-lg hover:bg-white transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GradeAssignment;
