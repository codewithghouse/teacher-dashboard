import React, { useState } from 'react';
import { ChevronLeft, MessageSquare, Phone, TrendingUp, CheckCircle2, AlertCircle, Clock, BookOpen } from 'lucide-react';

interface StudentProfileProps {
  student: {
    initials: string;
    name: string;
    cls: string;
    roll: number;
    color: string;
  };
  onBack: () => void;
}

const StudentProfile = ({ student, onBack }: StudentProfileProps) => {
  const [activeTab, setActiveTab] = useState('Overview');

  const tabs = ['Overview', 'Academic', 'Attendance', 'Assignments', 'Concepts'];

  const academicData = [
    { label: 'Unit Test 1', value: 78, color: 'bg-[#1e3a8a]' },
    { label: 'Unit Test 2', value: 82, color: 'bg-[#1e3a8a]' },
    { label: 'Mid Term', value: 88, color: 'bg-edu-green' },
    { label: 'Unit Test 3', value: 85, color: 'bg-[#1e3a8a]' },
    { label: 'Unit Test 4', value: 90, color: 'bg-edu-green' },
    { label: 'Recent Test', value: 84, color: 'bg-[#1e3a8a]' },
  ];

  const recentActivity = [
    { type: 'Submitted assignment', title: 'Algebraic Expressions', time: '2 days ago', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
    { type: 'Scored 84% in test', title: 'Unit Test: Algebra', time: '1 week ago', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
    { type: 'Missed assignment', title: 'Geometry Worksheet', time: '2 weeks ago', iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' },
  ];

  const conceptMastery = [
    { label: 'Algebra', value: 92, color: 'text-edu-green' },
    { label: 'Geometry', value: 85, color: 'text-edu-green' },
    { label: 'Statistics', value: 76, color: 'text-edu-yellow' },
    { label: 'Trigonometry', value: 68, color: 'text-edu-orange' },
  ];

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-6">
        <button 
          onClick={onBack}
          className="p-2 border rounded-lg hover:bg-muted transition-colors shadow-sm"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-4 flex-1">
          <div className={`${student.color} w-16 h-16 rounded-xl flex items-center justify-center text-white text-2xl font-bold shadow-sm`}>
            {student.initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{student.name}</h1>
            <p className="text-muted-foreground text-sm font-medium">
              Class {student.cls} • Roll: {student.roll} • {student.name.toLowerCase().replace(' ', '.')}@school.edu
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-6 py-2.5 rounded-lg border bg-white text-sm font-bold text-foreground hover:bg-muted transition-colors shadow-sm">
            Message
          </button>
          <button className="px-6 py-2.5 rounded-lg bg-[#1e3a8a] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-sm">
            Contact Parent
          </button>
        </div>
      </div>

      <div className="flex border-b mb-8">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-3 text-sm font-bold transition-all relative ${
              activeTab === tab ? 'text-[#1e3a8a]' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1e3a8a] rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column */}
        <div className="space-y-8">
          <div className="bg-card border rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-foreground mb-6">Personal Information</h3>
            <div className="space-y-4">
              {[
                { label: 'Full Name', value: student.name },
                { label: 'Roll Number', value: student.roll.toString() },
                { label: 'Class', value: student.cls },
                { label: 'Date of Birth', value: 'May 15, 2011' },
                { label: 'Parent Contact', value: '+91 98765 43210' },
              ].map((info, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">{info.label}</span>
                  <span className="text-foreground font-bold">{info.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-foreground mb-6">Quick Stats</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Attendance', value: '98%', color: 'text-edu-green' },
                { label: 'Avg. Score', value: '85.5%', color: 'text-[#1e3a8a]' },
                { label: 'Submission', value: '95%', color: 'text-edu-green' },
                { label: 'Tests Taken', value: '12', color: 'text-[#1e3a8a]' },
              ].map((stat, i) => (
                <div key={i} className="bg-muted/10 rounded-xl p-4 text-center border border-muted/20">
                  <p className={`text-2xl font-bold mb-1 ${stat.color}`}>{stat.value}</p>
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Middle Column */}
        <div className="bg-card border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-foreground">Academic Performance</h3>
            <span className="text-[10px] uppercase font-bold text-muted-foreground">Last 6 months</span>
          </div>
          <p className="text-xs text-muted-foreground mb-8">Performance trend across recent assessments</p>
          
          <div className="space-y-6">
            {academicData.map((data, i) => (
              <div key={i}>
                <div className="flex justify-between items-center text-xs font-bold mb-2">
                  <span className="text-muted-foreground">{data.label}</span>
                  <span className="text-foreground">{data.value}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${data.color} transition-all duration-1000`} 
                    style={{ width: `${data.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-8 border-t flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Overall Trend</span>
            <div className="flex items-center gap-1.5 text-edu-green font-bold">
              <TrendingUp className="w-4 h-4" />
              <span>+6.2%</span>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-8">
          <div className="bg-card border rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-foreground mb-6">Recent Activity</h3>
            <div className="space-y-6">
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex gap-4">
                  <div className={`w-10 h-10 rounded-xl ${activity.iconBg} flex items-center justify-center shrink-0`}>
                    {i === 0 ? <CheckCircle2 className={`w-5 h-5 ${activity.iconColor}`} /> : 
                     i === 1 ? <TrendingUp className={`w-5 h-5 ${activity.iconColor}`} /> : 
                     <Clock className={`w-5 h-5 ${activity.iconColor}`} />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground leading-tight">{activity.type}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{activity.title} • {activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-foreground mb-4">Concept Mastery</h3>
            <div className="space-y-3">
              {conceptMastery.map((concept, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-bold">
                  <span className="text-muted-foreground">{concept.label}</span>
                  <span className={concept.color}>{concept.value}%</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2.5 rounded-xl border font-bold text-primary hover:bg-muted transition-colors text-xs uppercase tracking-wide">
              View Full Analysis
            </button>
          </div>

          <div className="bg-edu-light-green/40 border border-edu-green/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-edu-green flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-bold text-foreground">No Risk Alerts</h3>
            </div>
            <p className="text-sm font-medium text-muted-foreground">Student is performing well across all metrics.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentProfile;
