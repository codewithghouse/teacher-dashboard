import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { BookOpen, Users, Clock, ArrowRight, GraduationCap } from "lucide-react";

const MyClasses = () => {
  const navigate = useNavigate();
  const { teacherData } = useAuth();

  // The principal assigns the class to teacherData.classes
  const assignedClass = teacherData?.classes;

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">My Classes</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1">Manage all your assigned grades and students.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-[#1e3a8a]/5 border border-[#1e3a8a]/10 rounded-2xl px-5 py-2.5 flex flex-col items-end">
             <span className="text-[10px] font-bold text-[#1e3a8a] uppercase tracking-widest">Active Status</span>
             <span className="text-sm font-black text-[#1e3a8a] leading-none uppercase">Teaching Online</span>
          </div>
        </div>
      </div>

      {assignedClass ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm hover:shadow-2xl transition-all duration-500 group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-[120px] -mr-12 -mt-12 transition-transform group-hover:scale-110 duration-700" />
            
            <div className="flex justify-between items-start mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-[#3b82f6] flex items-center justify-center text-white shadow-xl shadow-primary/30 transform group-hover:rotate-6 transition-transform">
                <GraduationCap className="w-8 h-8" />
              </div>
              <div className="flex flex-col items-end">
                <span className="bg-green-50 text-green-600 text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border border-green-100 shadow-sm">
                  Live & Assigned
                </span>
                <span className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-tighter">Academic Year 2025-26</span>
              </div>
            </div>

            <div className="relative z-10">
              <h3 className="text-3xl font-black text-slate-900 mb-1 tracking-tight">{assignedClass}</h3>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-8 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                {teacherData?.subject || 'Primary Educator'}
              </p>
              
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 group-hover:bg-white transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Students</span>
                  </div>
                  <p className="text-lg font-black text-slate-900">Active Roster</p>
                </div>
                
                <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 group-hover:bg-white transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Schedule</span>
                  </div>
                  <p className="text-lg font-black text-slate-900">Today's Class</p>
                </div>
              </div>

              <button
                onClick={() => navigate("/students")}
                className="w-full bg-[#1e3a8a] text-white py-4.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-[#1e4fc0] transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-3 group/btn h-14"
              >
                Go to Class Dashboard
                <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-2" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[40px] border border-dashed border-slate-200 shadow-inner">
          <div className="w-24 h-24 bg-slate-50 rounded-3xl flex items-center justify-center mb-6">
            <BookOpen className="w-12 h-12 text-slate-200" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">No Classes Assigned Yet</h2>
          <p className="text-sm font-bold text-slate-400 max-w-sm text-center uppercase tracking-tight leading-relaxed">
            Please wait for the Principal to assign your grade/class from the Management Portal.
          </p>
        </div>
      )}
    </div>
  );
};

export default MyClasses;
