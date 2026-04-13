import { useState, useEffect, useRef, useMemo } from "react";
import {
  Loader2, Send, CheckCheck, MessageSquare, Mail, Search, Smile,
  ChevronLeft, User, GraduationCap, Trash2
} from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, writeBatch, updateDoc, doc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const ParentNotes = () => {
  const { teacherData } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [allNotes, setAllNotes]               = useState<any[]>([]);
  const [roster, setRoster]                   = useState<any[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [searchQuery, setSearchQuery]         = useState("");
  const [messageContent, setMessageContent]   = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!teacherData?.id) return;

    const q1 = query(collection(db, "enrollments"), where("teacherId", "==", teacherData.id));
    const unsub1 = onSnapshot(q1, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const map = new Map();
      docs.forEach((d: any) => {
        const key = (d.studentId || d.studentEmail || d.id).toLowerCase();
        if (!map.has(key)) map.set(key, d);
      });
      setRoster(Array.from(map.values()));
    });

    const q2 = query(collection(db, "parent_notes"), where("teacherId", "==", teacherData.id));
    const unsub2 = onSnapshot(q2, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setAllNotes(data);
      setLoading(false);
    });

    return () => { unsub1(); unsub2(); };
  }, [teacherData?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allNotes, selectedStudent]);

  // Mark unread parent messages as read when conversation is opened
  useEffect(() => {
    if (!selectedStudent) return;
    const sId    = selectedStudent.studentId?.toLowerCase();
    const sEmail = selectedStudent.studentEmail?.toLowerCase();
    allNotes.forEach(n => {
      const match = (sId && n.studentId?.toLowerCase() === sId) || (sEmail && n.studentEmail?.toLowerCase() === sEmail);
      if (match && n.from === "parent" && n.read !== true) {
        updateDoc(doc(db, "parent_notes", n.id), { read: true }).catch(() => {});
      }
    });
  }, [selectedStudent?.id]);

  const lastMessages = useMemo(() => {
    const map = new Map();
    [...allNotes].reverse().forEach(n => {
      const key = (n.studentId || n.studentEmail)?.toLowerCase();
      if (key && !map.has(key)) map.set(key, n);
    });
    return map;
  }, [allNotes]);

  const unreadCounts = useMemo(() => {
    const map = new Map<string, number>();
    allNotes.forEach(n => {
      if (n.from === "parent" && n.read !== true) {
        const key = (n.studentId || n.studentEmail)?.toLowerCase();
        if (key) map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [allNotes]);

  const filteredRoster = useMemo(() => {
    return roster
      .filter(s => s.studentName?.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const keyA = (a.studentId || a.studentEmail)?.toLowerCase();
        const keyB = (b.studentId || b.studentEmail)?.toLowerCase();
        return (lastMessages.get(keyB)?.createdAt?.toMillis?.() || 0) - (lastMessages.get(keyA)?.createdAt?.toMillis?.() || 0);
      });
  }, [roster, searchQuery, lastMessages]);

  const studentMessages = useMemo(() => {
    if (!selectedStudent) return [];
    const sId    = selectedStudent.studentId?.toLowerCase();
    const sEmail = selectedStudent.studentEmail?.toLowerCase();
    return allNotes.filter(n =>
      (sId    && n.studentId?.toLowerCase()    === sId) ||
      (sEmail && n.studentEmail?.toLowerCase() === sEmail)
    );
  }, [allNotes, selectedStudent]);

  const stats = useMemo(() => ({
    total:        allNotes.length,
    parentReplies: allNotes.filter(n => n.from === "parent").length,
    students:     new Set(allNotes.map(n => n.studentId || n.studentEmail)).size,
  }), [allNotes]);

  const handleSend = async () => {
    if (!selectedStudent || !messageContent.trim()) return;
    const content = messageContent.trim();
    setMessageContent("");
    try {
      await addDoc(collection(db, "parent_notes"), {
        teacherId:   teacherData?.id   || "",
        teacherName: teacherData?.name || "Teacher",
        studentId:   selectedStudent.studentId    || "",
        studentEmail: selectedStudent.studentEmail?.toLowerCase() || "",
        studentName: selectedStudent.studentName  || "",
        parentName:  `Parent of ${selectedStudent.studentName}`,
        content, from: "teacher", status: "Sent",
        createdAt: serverTimestamp(),
      });
    } catch { toast.error("Failed to send."); setMessageContent(content); }
  };

  const handleClearChat = async () => {
    if (!selectedStudent || !confirm(`Clear chat for ${selectedStudent.studentName}?`)) return;
    try {
      const sId = selectedStudent.studentId;
      const q = query(collection(db, "parent_notes"), where("teacherId", "==", teacherData?.id), where("studentId", "==", sId));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      toast.success("Chat cleared!");
    } catch { toast.error("Error clearing chat."); }
  };

  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtDate = (ts: any) => {
    const d     = ts?.toDate?.() || new Date();
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(today); y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    studentMessages.forEach(msg => {
      const label = fmtDate(msg.createdAt);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [studentMessages]);

  return (
    <div className="flex flex-col -mx-4 sm:-mx-6 md:-mx-8 -my-4 sm:-my-6 md:-my-8 md:h-screen" style={{ fontFamily: "'Montserrat', sans-serif", height: "calc(100vh - 56px)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
        .wa-scroll::-webkit-scrollbar { width: 6px; }
        .wa-scroll::-webkit-scrollbar-thumb { background: #c8b89a; border-radius: 4px; }
        .wa-input::-webkit-scrollbar { display: none; }
        .no-sb::-webkit-scrollbar { display: none; }
        .bubble-sent { border-radius: 8px 0 8px 8px; position: relative; }
        .bubble-sent::before { content:''; position:absolute; top:0; right:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#d9fdd3; border-right:0; }
        .bubble-recv { border-radius: 0 8px 8px 8px; position: relative; }
        .bubble-recv::before { content:''; position:absolute; top:0; left:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#ffffff; border-left:0; }
        .wa-bg { background-color:#efeae2; }
      `}</style>

      {/* Stat strip */}
      <div className="flex gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-white border-b border-gray-200 shrink-0">
        {[
          { label: "Messages",  val: stats.total,        icon: MessageSquare, color: "text-blue-600" },
          { label: "Replies",   val: stats.parentReplies, icon: Mail,          color: "text-amber-500" },
          { label: "Students",  val: stats.students,      icon: GraduationCap, color: "text-emerald-500" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-2 sm:px-4 py-2 sm:py-3 flex-1 border border-gray-100 min-w-0">
            <s.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${s.color} shrink-0`} />
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs font-semibold text-gray-400 truncate">{s.label}</p>
              <p className="text-lg sm:text-xl font-black text-gray-800">{s.val}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar — student list */}
        <div className={`w-full md:w-[320px] lg:w-[360px] shrink-0 flex flex-col border-r border-gray-200 bg-white ${selectedStudent ? "hidden md:flex" : "flex"}`}>
          {/* Sidebar header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#1e3272] shrink-0">
            <GraduationCap className="w-5 h-5 text-white" />
            <p className="text-white font-bold text-sm">Parent Communication</p>
          </div>

          {/* Search */}
          <div className="px-3 py-2 bg-[#f0f2f5] shrink-0">
            <div className="flex items-center gap-2 bg-white rounded-full px-4 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search students..."
                className="flex-1 bg-transparent text-sm outline-none text-gray-700 placeholder:text-gray-400"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              />
            </div>
          </div>

          {/* Student list */}
          <div className="flex-1 overflow-y-auto no-sb">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
            ) : filteredRoster.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-12 font-semibold">No students found</p>
            ) : filteredRoster.map(s => {
              const key     = (s.studentId || s.studentEmail)?.toLowerCase();
              const last    = lastMessages.get(key);
              const unread  = unreadCounts.get(key) || 0;
              const active  = selectedStudent?.id === s.id;
              return (
                <button key={s.id} onClick={() => setSelectedStudent(s)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? "bg-[#f0f2f5]" : ""}`}>
                  <div className="w-12 h-12 rounded-full bg-[#1e3272] flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {s.studentName?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.studentName}</p>
                      {last && <span className="text-[11px] text-gray-400 shrink-0 ml-2">{fmtTime(last.createdAt)}</span>}
                    </div>
                    <div className="flex justify-between items-center mt-0.5">
                      <p className="text-xs text-gray-500 truncate">
                        {last ? (last.from === "teacher" ? "✓ " : "") + (last.content || "") : s.className || ""}
                      </p>
                      {unread > 0 && (
                        <span className="ml-2 min-w-[20px] h-5 rounded-full bg-[#25d366] text-white text-[10px] font-bold flex items-center justify-center px-1 shrink-0">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right — chat panel */}
        <div className={`flex-1 flex flex-col overflow-hidden ${!selectedStudent ? "hidden md:flex" : "flex"}`}>
          {selectedStudent ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-[#1e3272] shrink-0">
                <button onClick={() => setSelectedStudent(null)} className="md:hidden p-1 text-white">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {selectedStudent.studentName?.substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-none">{selectedStudent.studentName}</p>
                  <p className="text-blue-200 text-xs mt-0.5">
                    {selectedStudent.className || selectedStudent.assignedClass || "Student"} • Parent of {selectedStudent.studentName}
                  </p>
                </div>
                <button onClick={handleClearChat} className="p-2 text-white/60 hover:text-white transition-colors" title="Clear chat">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto wa-scroll wa-bg px-4 py-4 flex flex-col gap-1">
                {groupedMessages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="bg-white/80 rounded-lg px-8 py-6 shadow-sm text-center">
                      <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-gray-500">No messages yet</p>
                      <p className="text-xs text-gray-400 mt-1">Start the conversation with the parent</p>
                    </div>
                  </div>
                ) : groupedMessages.map(group => (
                  <div key={group.date}>
                    <div className="flex justify-center my-3">
                      <span className="bg-white/90 text-gray-500 text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">{group.date}</span>
                    </div>
                    {group.messages.map(n => {
                      const isTeacher = n.from === "teacher";
                      return (
                        <div key={n.id} className={`flex mb-1 ${isTeacher ? "justify-end" : "justify-start"}`}>
                          {!isTeacher && (
                            <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-white text-[10px] font-bold mr-1 mt-1 shrink-0">
                              <User className="w-4 h-4" />
                            </div>
                          )}
                          <div className={`max-w-[70%] px-3 py-2 shadow-sm ${isTeacher ? "bubble-sent bg-[#d9fdd3]" : "bubble-recv bg-white"}`}>
                            {!isTeacher && (
                              <p className="text-[11px] font-semibold text-gray-500 mb-1">Parent</p>
                            )}
                            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{n.content}</p>
                            <div className="flex items-center justify-end gap-1 mt-1">
                              <span className="text-[11px] text-gray-400">{fmtTime(n.createdAt)}</span>
                              {isTeacher && <CheckCheck className="w-4 h-4 text-[#53bdeb]" />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="flex items-center gap-2 px-3 py-2 bg-[#f0f2f5] shrink-0">
                <button className="w-10 h-10 flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded-full transition-colors">
                  <Smile className="w-6 h-6" />
                </button>
                <div className="flex-1 bg-white rounded-full px-4 py-2 flex items-center min-h-[42px]">
                  <textarea
                    rows={1} value={messageContent}
                    onChange={e => setMessageContent(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Message parent..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-gray-800 resize-none wa-input outline-none placeholder:text-gray-400 leading-relaxed"
                    style={{ fontFamily: "'Montserrat', sans-serif" }}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!messageContent.trim()}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${messageContent.trim() ? "bg-[#1e3272] text-white" : "bg-gray-300 text-gray-400"}`}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            /* No student selected */
            <div className="flex-1 wa-bg flex flex-col items-center justify-center text-center">
              <div className="bg-white/80 rounded-xl px-12 py-10 shadow-sm">
                <MessageSquare className="w-14 h-14 text-gray-200 mx-auto mb-4" />
                <p className="text-sm font-semibold text-gray-600">Select a student to start messaging</p>
                <p className="text-xs text-gray-400 mt-1">All parent conversations will appear here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParentNotes;
