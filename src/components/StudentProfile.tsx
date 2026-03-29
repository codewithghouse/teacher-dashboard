import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { 
  ChevronLeft, Loader2, Calendar, Phone, Mail, User, Info, Star, Activity, 
  AlertCircle, CheckCircle, Trophy, AlertTriangle, Clock, BookOpen, 
  HandHeart, Lightbulb 
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, onSnapshot, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useAuth } from '../lib/AuthContext';

interface StudentProfileProps {
  student: any;
  onBack: () => void;
}

export default function StudentProfile({ student, onBack }: StudentProfileProps) {
  const { teacherData } = useAuth();
  const [activeTab, setActiveTab] = useState('Overview');
  const [recentTests, setRecentTests] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [conceptMastery, setConceptMastery] = useState<any[]>([]);
  const [masterProfile, setMasterProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Growth Feedback states
  const [feedbackContent, setFeedbackContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pastFeedbacks, setPastFeedbacks] = useState<any[]>([]);

  // Behaviour Note states
  const [positiveNote, setPositiveNote] = useState("");
  const [improvementNote, setImprovementNote] = useState("");
  const [manualRating, setManualRating] = useState(5);
  const [isSubmittingBehaviour, setIsSubmittingBehaviour] = useState(false);
  const [pastBehaviours, setPastBehaviours] = useState<any[]>([]);

  // Derive initial stats
  const attPct = student.attendancePct || 100;
  const avgPct = student.avgScorePct || 0;

  useEffect(() => {
    if (!student.id) return;
    setLoading(true);

    // 1. Fetch Real Master Profile (DOB, Contact, etc.)
    const unsubMaster = onSnapshot(doc(db, "students", student.id), (docS) => {
        if (docS.exists()) setMasterProfile(docS.data());
    });

    // 2. Fetch Real Metrics
    const fetchData = async () => {
        try {
            const qScores = query(collection(db, "test_scores"), where("studentId", "==", student.id));
            const snapScores = await getDocs(qScores);
            const scores = snapScores.docs.map(d => ({id: d.id, ...(d.data() as any)}));
            scores.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            setRecentTests(scores.slice(0, 5));

            const activityArray = scores.slice(0, 3).map(s => ({
                type: 'test',
                title: `Scored ${s.percentage?.toFixed(0) || 0}% in ${s.testName || 'Assessment'}`,
                subtitle: `${s.subject || 'Standard'} • ${s.timestamp ? new Date(s.timestamp.seconds * 1000).toLocaleDateString() : 'Recent Session'}`,
                color: "bg-blue-100",
                icon: Star
            }));

            if (activityArray.length === 0) {
                activityArray.push({ type: 'alert', title: 'Session Initialized', subtitle: 'Academic Log Started', color: "bg-slate-100", icon: Activity });
            }
            setRecentActivity(activityArray);

            const uniqueTestIds = [...new Set(scores.map(s => s.testId).filter(Boolean))];
            if (uniqueTestIds.length > 0) {
                const testsPromises = uniqueTestIds.map(uid => getDoc(doc(db, "tests_registry", uid as string)));
                const testsSnap = await Promise.all(testsPromises);
                const testsData = testsSnap.map(t => ({id: t.id, ...(t.data() as any)}));
                const topicsMap = new Map();

                scores.forEach(s => {
                    const matchedTest = testsData.find(t => t.id === s.testId);
                    if (matchedTest?.topics?.length > 0) {
                        matchedTest.topics.forEach((topic: string) => {
                            if(!topicsMap.has(topic)) topicsMap.set(topic, { totalPts: 0, count: 0 });
                            const curr = topicsMap.get(topic);
                            curr.totalPts += (s.percentage || 0);
                            curr.count += 1;
                        });
                    }
                });

                setConceptMastery(Array.from(topicsMap.keys()).map(k => {
                    const v = topicsMap.get(k);
                    return { name: k, score: Number((v.totalPts / v.count).toFixed(0)) };
                }).sort((a,b) => b.score - a.score).slice(0, 4));
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    fetchData();
    return () => unsubMaster();
  }, [student.id]);

  useEffect(() => {
    if (activeTab === 'Feedback' && student.id) {
        const qF = query(collection(db, "performance_feedback"), where("studentId", "==", student.id));
        const unsub = onSnapshot(qF, (snap) => {
            const data = snap.docs.map(d => ({id: d.id, ...d.data()}));
            data.sort((a:any, b:any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            setPastFeedbacks(data);
        });
        return () => unsub();
    }
    if (activeTab === 'Behaviour' && student.id) {
        const qB = query(collection(db, "parent_notes"), where("studentId", "==", student.id));
        const unsub = onSnapshot(qB, (snap) => {
            const data = snap.docs.map(d => ({id: d.id, ...d.data()}));
            data.sort((a:any, b:any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setPastBehaviours(data);
        });
        return () => unsub();
    }
  }, [activeTab, student.id]);

  const handleSaveFeedback = async () => {
      if (!feedbackContent.trim()) return;
      setIsSubmitting(true);
      try {
          await addDoc(collection(db, "performance_feedback"), {
              studentId: student.id,
              studentEmail: student.email || "",
              studentName: student.name,
              teacherId: teacherData?.id || "unknown",
              teacherName: teacherData?.name || "Institutional Faculty",
              subject: student.className || "General curriculum",
              content: feedbackContent.trim(),
              timestamp: serverTimestamp()
          });
          setFeedbackContent("");
          alert("Pedagogical Feedback Dispatched!");
      } catch (e) {
          console.error(e);
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleSaveBehaviour = async () => {
      if (!positiveNote.trim() && !improvementNote.trim()) return;
      setIsSubmittingBehaviour(true);
      try {
          // 1. Save Positive Note if exists
          if (positiveNote.trim()) {
              await addDoc(collection(db, "parent_notes"), {
                  teacherId: teacherData?.id || "unknown",
                  teacherName: teacherData?.name || "Institutional Faculty",
                  studentId: student.id, 
                  studentName: student.name,
                  parentName: `Parent of ${student.name}`, 
                  subject: student.className || "General",
                  content: positiveNote.trim(),
                  category: "positive",
                  status: "Sent", 
                  from: "teacher", 
                  createdAt: serverTimestamp()
              });
          }

          // 2. Save Improvement Note if exists
          if (improvementNote.trim()) {
              await addDoc(collection(db, "parent_notes"), {
                  teacherId: teacherData?.id || "unknown",
                  teacherName: teacherData?.name || "Institutional Faculty",
                  studentId: student.id, 
                  studentName: student.name,
                  parentName: `Parent of ${student.name}`, 
                  subject: student.className || "General",
                  content: improvementNote.trim(),
                  category: "improvement",
                  status: "Sent", 
                  from: "teacher", 
                  createdAt: serverTimestamp()
              });
          }

          // 3. Update Manual Rating in Enrollment
          const qEnroll = query(
            collection(db, "enrollments"), 
            where("studentId", "==", student.id),
            where("teacherId", "==", teacherData?.id)
          );
          const enrollSnap = await getDocs(qEnroll);
          if (!enrollSnap.empty) {
            await updateDoc(doc(db, "enrollments", enrollSnap.docs[0].id), {
              manualBehaviourRating: manualRating,
              lastBehaviourUpdate: serverTimestamp()
            });
          }

          setPositiveNote("");
          setImprovementNote("");
          alert("Behaviour Audit Dispatched to Parent Dashboard!");
      } catch (e) {
          console.error(e);
      } finally {
          setIsSubmittingBehaviour(false);
      }
  };

  const tabs = ['Overview', 'Academic', 'Attendance', 'Assignments', 'Concepts', 'Feedback', 'Behaviour'];
  const getBarColor = (score: number) => score >= 85 ? "bg-[#1e3a8a]" : score >= 65 ? "bg-emerald-500" : "bg-rose-500";

  return (
    <div className="animate-in fade-in duration-500 text-left bg-transparent pb-20">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
         <div className="flex items-center gap-6">
            <button onClick={onBack} className="w-14 h-14 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 hover:text-[#1e3a8a] hover:shadow-xl transition-all shadow-sm">
              <ChevronLeft size={24} />
            </button>
            <div className="flex items-center gap-6">
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center text-white text-3xl font-black shadow-2xl ${student.color || 'bg-[#1e3a8a]'}`}>
                    {student.initials}
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mb-1">Authenticated Trace Log</p>
                   <h1 className="text-4xl font-black text-slate-900 leading-none tracking-tighter mb-2 italic uppercase">{student.name}</h1>
                   <p className="text-sm font-bold text-slate-400 capitalize">Class {student.className} • Roll Number {student.rollNo}</p>
                </div>
            </div>
         </div>
         <div className="flex gap-4 mt-6 md:mt-0">
            <button className="h-14 px-8 bg-white border border-slate-200 text-slate-700 text-sm font-black uppercase tracking-widest rounded-2xl shadow-sm hover:shadow-xl transition-all">Message Parent</button>
            <button className="h-14 px-8 bg-[#1e3a8a] text-white text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-900/20 hover:scale-105 transition-all">Direct Call</button>
         </div>
      </div>

      <nav className="flex gap-8 border-b border-slate-100 mb-10 overflow-x-auto no-scrollbar">
         {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`pb-5 px-1 text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'text-[#1e3a8a] border-b-4 border-[#1e3a8a]' : 'text-slate-300 hover:text-slate-500'}`}>{t}</button>
         ))}
      </nav>

      {activeTab === 'Overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
             
             <div className="lg:col-span-4 space-y-10">
                 <div className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8 border-l-4 border-indigo-400 pl-4 leading-none uppercase">Identity Matrix</h3>
                    <div className="space-y-6">
                        <IdentityBit icon={User} label="Full Identity" value={student.name} />
                        <IdentityBit icon={Calendar} label="Date of Birth" value={masterProfile?.dob || 'Record Missing'} />
                        <IdentityBit icon={CheckCircle} label="Blood Group" value={masterProfile?.bloodGroup || 'Record Missing'} />
                        <IdentityBit icon={Phone} label="Emergency Contact" value={masterProfile?.parentPhone || masterProfile?.contact || student.email} />
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-6">
                    <div className="bg-slate-900 rounded-[2.5rem] p-8 text-center text-white shadow-2xl">
                       <h4 className="text-4xl font-black tracking-tighter mb-1">{attPct.toFixed(0)}%</h4>
                       <p className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-300">Attendance</p>
                    </div>
                    <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 text-center shadow-sm">
                       <h4 className="text-4xl font-black tracking-tighter mb-1 text-slate-900">{avgPct > 0 ? `${avgPct.toFixed(0)}%` : 'N/A'}</h4>
                       <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Avg. Mastery</p>
                    </div>
                 </div>
             </div>

             <div className="lg:col-span-5 bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm">
                <div className="flex items-center justify-between mb-10">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-l-4 border-emerald-400 pl-4 leading-none uppercase">Assessment Timeline</h3>
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                </div>
                {loading ? <Loader2 className="w-8 h-8 animate-spin text-slate-200 mx-auto py-20" /> : (
                   <div className="space-y-8">
                      {recentTests.length > 0 ? recentTests.map((t, i) => (
                         <div key={i} className="group cursor-default">
                            <div className="flex justify-between items-end mb-2">
                               <span className="text-sm font-black text-slate-800 uppercase italic tracking-tight">{t.testName}</span>
                               <span className="text-sm font-black text-slate-900">{t.percentage?.toFixed(0)}%</span>
                            </div>
                            <div className="h-3 w-full bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                               <div className={`h-full ${getBarColor(t.percentage)} rounded-full shadow-inner transition-all duration-1000`} style={{ width: `${t.percentage || 0}%` }} />
                            </div>
                         </div>
                      )) : (
                         <div className="py-20 text-center opacity-20 flex flex-col items-center">
                            <Star size={48} className="mb-4" />
                            <p className="text-[10px] font-black uppercase tracking-widest">No Scholastic Records Located</p>
                         </div>
                      )}
                   </div>
                )}
             </div>

             <div className="lg:col-span-3 space-y-10">
                <div className="bg-white border border-slate-100 rounded-[3rem] p-8 shadow-sm">
                   <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8 border-l-4 border-amber-400 pl-4 leading-none uppercase">Recent Activity</h3>
                   <div className="space-y-6">
                      {recentActivity.map((act, i) => (
                         <div key={i} className="flex gap-4 items-start group">
                            <div className={`w-10 h-10 rounded-xl ${act.color} flex items-center justify-center group-hover:rotate-12 transition-transform shadow-sm`}>
                               <act.icon size={16} className="text-slate-800" />
                            </div>
                            <div>
                               <p className="text-xs font-black text-slate-900 leading-tight mb-1">{act.title}</p>
                               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{act.subtitle}</p>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
                
                <div className="bg-emerald-50 border border-emerald-100 rounded-[3.5rem] p-10 text-center">
                   <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <CheckCircle className="text-emerald-500 w-8 h-8" />
                   </div>
                   <h4 className="text-xl font-black text-emerald-900 italic mb-2 tracking-tighter uppercase">High Stability</h4>
                   <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest leading-relaxed">Engagement and behavior metrics are successfully synchronized.</p>
                </div>
             </div>

          </div>
      )}

      {activeTab === 'Feedback' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
               <div className="lg:col-span-7 bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm">
                  <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-8 italic border-l-4 border-[#1e3a8a] pl-6 leading-none">Pedagogical Synthesis</h3>
                  <textarea 
                    value={feedbackContent}
                    onChange={(e) => setFeedbackContent(e.target.value)}
                    placeholder="Enter strategic growth feedback (Professional Narrative)..."
                    className="w-full h-80 bg-slate-50/50 border border-slate-100 rounded-[2.5rem] p-8 text-lg font-black italic tracking-tighter uppercase focus:ring-4 focus:ring-blue-50 transition-all resize-none mb-8 placeholder:text-slate-300"
                  />
                  <button 
                    onClick={handleSaveFeedback}
                    disabled={isSubmitting || !feedbackContent.trim()}
                    className="w-full h-20 bg-[#1e3a8a] text-white rounded-[1.8rem] text-sm font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:shadow-2xl hover:shadow-blue-900/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : <Star size={20} />}
                    Broadcast Feedback Trace
                  </button>
               </div>

               <div className="lg:col-span-5 flex flex-col gap-10">
                  <div className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl overflow-hidden relative">
                      <h3 className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-8 border-l-4 border-indigo-500 pl-4 leading-none uppercase">Chronological Feed</h3>
                      <div className="space-y-6 max-h-[500px] overflow-y-auto no-scrollbar">
                         {pastFeedbacks.length === 0 ? (
                             <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest py-20 text-center italic">No legacy feedback located.</p>
                         ) : pastFeedbacks.map((fb, idx) => (
                             <div key={idx} className="p-6 bg-white/5 border border-white/5 rounded-3xl">
                                <p className="text-sm font-bold italic leading-relaxed uppercase tracking-tight mb-4 text-slate-200">"{fb.content}"</p>
                                <div className="flex justify-between items-center text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                   <span>{fb.subject} • {fb.teacherName}</span>
                                   <span>{fb.timestamp?.toDate ? fb.timestamp.toDate().toLocaleDateString() : 'Syncing...'}</span>
                                </div>
                             </div>
                         ))}
                      </div>
                  </div>
               </div>
          </div>
      )}

      {activeTab === 'Behaviour' && (() => {
          const pNotes = pastBehaviours.filter(b => b.category === "positive");
          const iNotes = pastBehaviours.filter(b => b.category === "improvement");
          const calcRating = pastBehaviours.length === 0 ? 5.0 : 
              Math.min(5.0, Math.max(1.0, 5.0 - (iNotes.length * 0.3) + (pNotes.length * 0.1)));
          const finalRating = manualRating || calcRating;

          // Generate dynamic chart data from join date to now
          const getTrendData = () => {
             const months: any = {};
             const now = new Date();
             
             // 1. Determine Start Date (Join Date)
             let startDate = new Date(now.getFullYear(), now.getMonth() - 4, 1); // default 5 months
             
             const rawJoinDate = masterProfile?.enrolledAt || masterProfile?.createdAt || student?.enrolledAt;
             if (rawJoinDate) {
                const jDate = rawJoinDate.toDate ? rawJoinDate.toDate() : new Date(rawJoinDate);
                // Clamp to not go too far back if data is huge, but usually joining is fine
                startDate = new Date(jDate.getFullYear(), jDate.getMonth(), 1);
             } else if (pastBehaviours.length > 0) {
                // Fallback to first note date
                const firstNoteDate = pastBehaviours.reduce((earliest, current) => {
                   const d = current.createdAt?.toDate ? current.createdAt.toDate() : new Date();
                   return d < earliest ? d : earliest;
                }, new Date());
                startDate = new Date(firstNoteDate.getFullYear(), firstNoteDate.getMonth(), 1);
             }

             // 2. Generate all months between start and now
             let tempDate = new Date(startDate);
             while (tempDate <= now) {
                const mName = tempDate.toLocaleString('default', { month: 'short' });
                const mYear = tempDate.getFullYear().toString().slice(-2);
                const key = `${mName} ${mYear}`;
                months[key] = { m: mName, key: key, pos: 0, improv: 0, count: 0, date: new Date(tempDate) };
                tempDate.setMonth(tempDate.getMonth() + 1);
             }

             // 3. Populate Data
             pastBehaviours.forEach(n => {
                const date = n.createdAt?.toDate ? n.createdAt.toDate() : new Date();
                const mName = date.toLocaleString('default', { month: 'short' });
                const mYear = date.getFullYear().toString().slice(-2);
                const key = `${mName} ${mYear}`;
                if (months[key]) {
                   if (n.category === "positive") months[key].pos++;
                   else months[key].improv++;
                   months[key].count++;
                }
             });

             return Object.values(months).map((data: any) => {
                const curM = now.toLocaleString('default', { month: 'short' });
                const curY = now.getFullYear().toString().slice(-2);
                const isCurrentMonth = data.m === curM && data.key.includes(curY);
                
                const calculatedScore = data.count === 0 ? 5.0 : 
                   Math.min(5.0, Math.max(1.0, 5.0 - (data.improv * 0.3) + (data.pos * 0.1)));

                return {
                   m: data.m,
                   key: data.key,
                   score: isCurrentMonth && manualRating ? manualRating : calculatedScore
                };
             });
          };

          const tData = getTrendData();

          return (
          <div className="flex flex-col gap-10">
               {/* TOP RATING SELECTOR */}
               <div className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm flex flex-col md:flex-row items-center justify-between gap-8">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-[2rem] bg-amber-50 flex items-center justify-center text-amber-500 shadow-inner">
                        <Star size={32} fill={finalRating > 0 ? "currentColor" : "none"} />
                    </div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 tracking-tighter italic uppercase">Manual Behaviour Rating</h3>
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Status: {manualRating ? "MANUAL OVERRIDE" : "ACTIVE AUDIT"}</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button 
                        key={star}
                        onClick={() => setManualRating(star)}
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${finalRating >= star ? 'bg-amber-400 text-white shadow-lg shadow-amber-200 ring-4 ring-amber-50' : 'bg-slate-50 text-slate-300 hover:bg-slate-100'}`}
                      >
                        <Star size={24} fill={finalRating >= star ? "currentColor" : "none"} />
                      </button>
                    ))}
                  </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                   {/* POSITIVE INPUT */}
                   <div className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm relative overflow-hidden group">
                      <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-100/30 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                      <div className="relative z-10">
                         <div className="flex items-center gap-4 mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                               <Trophy size={20} />
                            </div>
                            <p className="text-sm font-black text-slate-800 uppercase italic tracking-tight">Positive Highlights</p>
                         </div>
                         <textarea 
                           value={positiveNote}
                           onChange={(e) => setPositiveNote(e.target.value)}
                           placeholder="What went well? (e.g. 'Highly engaged in group project')"
                           className="w-full h-48 bg-slate-50 border border-slate-100 rounded-[2rem] p-8 text-lg font-black italic tracking-tighter uppercase focus:ring-8 focus:ring-emerald-50 transition-all resize-none mb-4 placeholder:text-slate-200 outline-none"
                         />
                      </div>
                   </div>

                   {/* IMPROVEMENT INPUT */}
                   <div className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm relative overflow-hidden group">
                      <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-100/30 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                      <div className="relative z-10">
                         <div className="flex items-center gap-4 mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
                               <AlertTriangle size={20} />
                            </div>
                            <p className="text-sm font-black text-slate-800 uppercase italic tracking-tight">Areas for Improvement</p>
                         </div>
                         <textarea 
                           value={improvementNote}
                           onChange={(e) => setImprovementNote(e.target.value)}
                           placeholder="What needs focus? (e.g. 'Needs more focus during labs')"
                           className="w-full h-48 bg-slate-50 border border-slate-100 rounded-[2rem] p-8 text-lg font-black italic tracking-tighter uppercase focus:ring-8 focus:ring-amber-50 transition-all resize-none mb-4 placeholder:text-slate-200 outline-none"
                         />
                      </div>
                   </div>
               </div>

               <button 
                  onClick={handleSaveBehaviour}
                  disabled={isSubmittingBehaviour || (!positiveNote.trim() && !improvementNote.trim())}
                  className="w-full h-24 bg-slate-900 text-white rounded-[2rem] text-sm font-black uppercase tracking-[0.4em] flex items-center justify-center gap-4 hover:shadow-2xl hover:scale-[1.01] transition-all active:scale-95 disabled:opacity-50"
               >
                  {isSubmittingBehaviour ? <Loader2 className="animate-spin" /> : <Star size={24} />}
                  SYNC BEHAVIOUR AUDIT TO PARENT DASHBOARD
               </button>

               {/* BEHAVIOR TREND CHART */}
               <div className="bg-white border border-slate-100 rounded-[3rem] p-10 shadow-sm relative overflow-hidden group">
                  <div className="flex items-center gap-4 mb-10">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                      <TrendingUp size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-800 uppercase italic tracking-tight">Behavior Trend</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Live Analytics from institutional audit traces</p>
                    </div>
                  </div>
                  
                  <div className="h-[300px] w-full mt-4">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={tData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                           <defs>
                              <linearGradient id="colorScoreTeacher" x1="0" y1="0" x2="1" y2="1">
                                 <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                                 <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                                 <stop offset="95%" stopColor="#10b981" stopOpacity={0.4}/>
                              </linearGradient>
                              <linearGradient id="lineGradientTeacher" x1="0" y1="0" x2="1" y2="0">
                                 <stop offset="0%" stopColor="#6366f1" />
                                 <stop offset="50%" stopColor="#8b5cf6" />
                                 <stop offset="100%" stopColor="#10b981" />
                              </linearGradient>
                              <filter id="glowTeacher" x="-20%" y="-20%" width="140%" height="140%">
                                 <feGaussianBlur stdDeviation="3" result="blur" />
                                 <feComposite in="SourceGraphic" in2="blur" operator="over" />
                              </filter>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                           <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 800, fill: '#cbd5e1' }} dy={10} />
                           <YAxis domain={[1, 5]} axisLine={false} tickLine={false} tick={{ fontSize: 13, fontWeight: 800, fill: '#cbd5e1' }} dx={-10} />
                           <Tooltip 
                              contentStyle={{ borderRadius: '2rem', border: 'none', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic', fontSize: '10px', background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(10px)' }} 
                              labelStyle={{ color: '#6366f1', marginBottom: '4px' }}
                           />
                           <Area 
                              type="monotone" 
                              dataKey="score" 
                              stroke="url(#lineGradientTeacher)" 
                              fillOpacity={1} 
                              fill="url(#colorScoreTeacher)" 
                              strokeWidth={5} 
                              dot={{ r: 6, fill: '#6366f1', strokeWidth: 3, stroke: '#fff' }}
                              activeDot={{ r: 8, strokeWidth: 0, fill: '#10b981' }}
                              filter="url(#glowTeacher)"
                           />
                        </AreaChart>
                     </ResponsiveContainer>
                  </div>
               </div>

               <div className="bg-slate-900 rounded-[3.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                     <Star size={100} className="rotate-12" />
                  </div>
                  
                  <div className="relative z-10">
                     <div className="flex items-center gap-4 mb-10 pb-6 border-b border-white/5">
                        <Clock className="w-6 h-6 text-emerald-400" />
                        <h3 className="text-[10px] font-black text-indigo-300 uppercase tracking-widest leading-none">AUDIT LOG ARCHIVE</h3>
                     </div>
                     
                     <div className="space-y-6 max-h-[400px] overflow-y-auto no-scrollbar pr-2">
                        {pastBehaviours.length === 0 ? (
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest py-10 text-center italic">No behavioural traces located.</p>
                        ) : pastBehaviours.map((b, idx) => {
                            const isImprov = b.category === "improvement" || (b.content || "").toLowerCase().includes("late") || (b.content || "").toLowerCase().includes("miss");
                            return (
                               <div key={idx} className={`p-6 bg-white/5 border border-white/5 rounded-[2rem] group hover:bg-white/10 transition-all ${isImprov ? 'border-amber-500/10 hover:border-amber-500/30' : 'border-emerald-500/10 hover:border-emerald-500/30'}`}>
                                  <div className="flex items-start gap-5">
                                     <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isImprov ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                        {isImprov ? <AlertTriangle size={18} /> : <Trophy size={18} />}
                                     </div>
                                     <div className="flex-1 min-w-0">
                                        <p className={`text-[14px] font-black italic leading-snug uppercase tracking-tight mb-3 ${isImprov ? 'text-amber-100' : 'text-emerald-100'}`}>"{b.content}"</p>
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString() : 'Syncing...'}</span>
                                     </div>
                                  </div>
                               </div>
                            );
                        })}
                     </div>
                  </div>
               </div>
          </div>
          );
      })()}

      {['Academic', 'Attendance', 'Assignments', 'Concepts'].includes(activeTab) && (
          <div className="py-40 text-center opacity-30 flex flex-col items-center">
             <AlertCircle size={48} className="mb-4" />
             <p className="text-[11px] font-black uppercase tracking-[0.4em]">Section Encryption Underway...</p>
          </div>
      )}

    </div>
  );
}

const IdentityBit = ({ icon: Icon, label, value }: any) => (
   <div className="flex items-start gap-4 group">
      <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center group-hover:bg-slate-100 transition-colors">
         <Icon size={14} className="text-slate-300" />
      </div>
      <div>
         <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-none mb-1.5">{label}</p>
         <p className="text-sm font-black text-slate-800 uppercase tracking-tight italic">{value}</p>
      </div>
   </div>
);

const TrendingUp = ({ className, size }: any) => (
   <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
   </svg>
);

