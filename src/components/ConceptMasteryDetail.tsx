import React from 'react';
import { ChevronLeft, MessageSquare, Phone, BookOpen, AlertCircle, CheckCircle2, Search } from 'lucide-react';

interface ConceptMasteryDetailProps {
  student: {
    initials: string;
    name: string;
    roll: number;
    cls: string;
    color: string;
  };
  onBack: () => void;
}

const ConceptMasteryDetail = ({ student, onBack }: ConceptMasteryDetailProps) => {
  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onBack}
          className="p-2 border rounded-lg hover:bg-muted transition-colors shadow-sm"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-4 flex-1">
          <div className={`bg-edu-red w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-sm`}>
            {student.initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">{student.name}</h1>
            <p className="text-muted-foreground text-sm font-medium">
              Class {student.cls} • Roll: {student.roll} • Concept Mastery Analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-6 py-2.5 rounded-lg border bg-white text-sm font-bold text-foreground hover:bg-muted transition-colors shadow-sm">
            View Profile
          </button>
          <button className="px-6 py-2.5 rounded-lg bg-[#1e3a8a] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-sm">
            Contact Parent
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Mastered Column */}
        <div className="bg-card border rounded-2xl p-6 shadow-sm flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-edu-green flex items-center justify-center shadow-sm">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Mastered</h2>
          </div>
          
          <div className="space-y-4">
            {[
              { title: "Data Interpretation", score: 88, desc: "Strong understanding of graphs and charts" },
              { title: "Basic Arithmetic", score: 85, desc: "Good grasp of fundamental operations" },
              { title: "Number Systems", score: 72, desc: "Understands integers and fractions" }
            ].map((c, i) => (
              <div key={i} className="bg-edu-light-green/20 border border-edu-green/10 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2 font-bold">
                  <span className="text-sm text-foreground">{c.title}</span>
                  <span className="text-edu-green">{c.score}%</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-edu-green" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-[11px] font-medium text-edu-green/80">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Developing Column */}
        <div className="bg-card border rounded-2xl p-6 shadow-sm flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-edu-yellow flex items-center justify-center shadow-sm">
              <TrendingUpIcon className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Developing</h2>
          </div>
          
          <div className="space-y-4">
            {[
              { title: "Polynomials", score: 55, desc: "Needs practice with factorization" },
              { title: "Geometry Basics", score: 62, desc: "Improving with shapes and angles" },
              { title: "Circles", score: 58, desc: "Struggling with theorems" }
            ].map((c, i) => (
              <div key={i} className="bg-edu-light-yellow/30 border border-edu-yellow/10 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2 font-bold">
                  <span className="text-sm text-foreground">{c.title}</span>
                  <span className="text-edu-orange">{c.score}%</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-edu-yellow" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-[11px] font-medium text-edu-orange/80">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Weak Column */}
        <div className="bg-card border rounded-2xl p-6 shadow-sm flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-edu-red flex items-center justify-center shadow-sm">
              <AlertCircle className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Weak Areas</h2>
          </div>
          
          <div className="space-y-4">
            {[
              { title: "Quadratic Equations", score: 38, desc: "Major gap - needs intensive support" },
              { title: "Trigonometry", score: 35, desc: "Fundamental concepts unclear" },
              { title: "Linear Equations", score: 42, desc: "Difficulty with word problems" }
            ].map((c, i) => (
              <div key={i} className="bg-edu-light-red/30 border border-edu-red/10 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2 font-bold">
                  <span className="text-sm text-foreground">{c.title}</span>
                  <span className="text-edu-red">{c.score}%</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-edu-red" style={{ width: `${c.score}%` }} />
                </div>
                <p className="text-[11px] font-medium text-edu-red/80 mb-3">{c.desc}</p>
                <button className="w-full py-1.5 bg-edu-red text-white rounded-lg text-xs font-bold hover:opacity-90 transition-opacity">
                  Assign Remedial
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recommended Actions */}
      <div className="bg-[#eff6ff] border border-blue-100 rounded-2xl p-8 flex items-center justify-between shadow-sm">
        <div className="flex-1 border-r border-blue-200 pr-8">
          <h3 className="font-bold text-[#1e3a8a] mb-2 text-sm uppercase tracking-wider">Recommended Actions</h3>
          <p className="text-sm font-medium text-muted-foreground leading-relaxed">Schedule 1-on-1 tutoring sessions for Quadratic Equations</p>
        </div>
        <div className="flex-1 border-r border-blue-200 px-8">
           <p className="text-sm font-medium text-muted-foreground leading-relaxed mt-6">Assign additional practice worksheets for Trigonometry basics</p>
        </div>
        <div className="flex-1 pl-8">
           <p className="text-sm font-medium text-muted-foreground leading-relaxed mt-6">Contact parents to discuss home support strategies</p>
        </div>
      </div>
    </div>
  );
};

const TrendingUpIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-9 9-4-4-6 6" />
  </svg>
);

export default ConceptMasteryDetail;
