import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2, Send, CheckCheck, School, Mail, MessageSquare, Smile } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc } from "firebase/firestore";
import { useAuth } from "../lib/AuthContext";
import { toast } from "sonner";

const PrincipalNotes = () => {
  const { teacherData } = useAuth();
  const [allMessages, setAllMessages]       = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [messageContent, setMessageContent] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!teacherData?.id) return;
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "principal_to_teacher_notes"), where("teacherId", "==", teacherData.id)),
      async snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        data.sort((a, b) => (a.timestamp?.toMillis?.() || 0) - (b.timestamp?.toMillis?.() || 0));
        setAllMessages(data);
        setLoading(false);
        for (const d of snap.docs) {
          const dd = d.data();
          if (dd.read === false && dd.from === "principal") {
            try { await updateDoc(doc(db, "principal_to_teacher_notes", d.id), { read: true }); } catch { /* silent */ }
          }
        }
      }
    );
    return () => unsub();
  }, [teacherData?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [allMessages]);

  const stats = useMemo(() => ({
    total:  allMessages.length,
    unread: allMessages.filter(m => m.read === false && m.from === "principal").length,
  }), [allMessages]);

  const handleSend = async () => {
    if (!messageContent.trim()) return;
    const content = messageContent.trim();
    setMessageContent("");
    try {
      await addDoc(collection(db, "principal_to_teacher_notes"), {
        principalId:   allMessages[0]?.principalId   || "",
        principalName: allMessages[0]?.principalName || "Principal",
        teacherId:     teacherData?.id   || "",
        teacherName:   teacherData?.name || "",
        className:     teacherData?.assignedClass || teacherData?.className || "",
        message: content, from: "teacher",
        timestamp: serverTimestamp(),
        schoolId: teacherData?.schoolId || "",
        branchId: teacherData?.branchId || "",
        read: false,
      });
    } catch { toast.error("Failed to send."); setMessageContent(content); }
  };

  const fmtTime = (ts: any) =>
    new Date(ts?.toDate?.() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtDate = (ts: any) => {
    const d = ts?.toDate?.() || new Date();
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(today); y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: any[] }[] = [];
    allMessages.forEach(msg => {
      const label = fmtDate(msg.timestamp);
      const last  = groups[groups.length - 1];
      if (last && last.date === label) last.messages.push(msg);
      else groups.push({ date: label, messages: [msg] });
    });
    return groups;
  }, [allMessages]);

  const principalName = allMessages[0]?.principalName || "Principal";

  return (
    <div className="flex flex-col -mx-4 sm:-mx-6 md:-mx-8 -my-4 sm:-my-6 md:-my-8 md:h-screen" style={{ fontFamily: "'Montserrat', sans-serif", height: "calc(100vh - 56px)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
        .wa-chat::-webkit-scrollbar { width: 6px; }
        .wa-chat::-webkit-scrollbar-thumb { background: #c8b89a; border-radius: 4px; }
        .wa-input::-webkit-scrollbar { display: none; }
        .bubble-sent { border-radius: 8px 0 8px 8px; position: relative; }
        .bubble-sent::before { content:''; position:absolute; top:0; right:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#d9fdd3; border-right:0; }
        .bubble-recv { border-radius: 0 8px 8px 8px; position: relative; }
        .bubble-recv::before { content:''; position:absolute; top:0; left:-8px; width:0; height:0; border:8px solid transparent; border-top-color:#ffffff; border-left:0; }
        .wa-bg { background-color:#efeae2; }
      `}</style>

      {/* Stat strip */}
      <div className="flex gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3 bg-white border-b border-gray-200 shrink-0">
        {[
          { label: "Messages",       val: stats.total,  icon: MessageSquare, color: "text-blue-600" },
          { label: "Unread",         val: stats.unread, icon: Mail,          color: "text-amber-500" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-5 py-2 sm:py-3 flex-1 border border-gray-100">
            <s.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${s.color} shrink-0`} />
            <div>
              <p className="text-[10px] sm:text-xs font-semibold text-gray-400">{s.label}</p>
              <p className="text-lg sm:text-xl font-black text-gray-800">{s.val}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Chat */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#1e3a8a] shrink-0">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <School className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm leading-none">{principalName}</p>
            <p className="text-blue-200 text-xs mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" /> School Administration
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto wa-chat wa-bg px-4 py-4 flex flex-col gap-1">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="bg-white/80 rounded-lg px-8 py-6 shadow-sm">
                <School className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">No messages from Principal yet</p>
                <p className="text-xs text-gray-400 mt-1">Messages from your principal will appear here</p>
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
                      <div className="w-7 h-7 rounded-full bg-[#1e3a8a] flex items-center justify-center text-white text-[10px] font-bold mr-1 mt-1 shrink-0">
                        {principalName.substring(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className={`max-w-[70%] px-3 py-2 shadow-sm ${isTeacher ? "bubble-sent bg-[#d9fdd3]" : "bubble-recv bg-white"}`}>
                      {!isTeacher && (
                        <p className="text-[11px] font-semibold text-[#1e3a8a] mb-1">{principalName}</p>
                      )}
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{n.message}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[11px] text-gray-400">{fmtTime(n.timestamp)}</span>
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
              rows={1}
              value={messageContent}
              onChange={e => setMessageContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Reply to principal..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-gray-800 resize-none wa-input outline-none placeholder:text-gray-400 leading-relaxed"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!messageContent.trim()}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${messageContent.trim() ? "bg-[#1e3a8a] text-white" : "bg-gray-300 text-gray-400"}`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrincipalNotes;
