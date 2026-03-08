import StatCard from "@/components/StatCard";

const messages = [
  {
    initials: "RK", name: "Rahul Kumar's Parents", status: "Pending Reply", statusColor: "bg-edu-light-yellow text-edu-orange",
    cls: "Class 9-B", date: "Sent: Feb 15, 2025",
    text: "Dear Parents, I wanted to bring to your attention that Rahul has been absent for 3 days this week. His attendance has dropped to 72%, which may impact his academic performance. Could you please let me know if there's anything we can do to support him?",
    color: "bg-edu-red",
  },
  {
    initials: "NS", name: "Neha Sharma's Parents", status: "Replied", statusColor: "bg-edu-light-green text-edu-green",
    cls: "Class 8-A", date: "Received: Feb 16, 2025",
    text: "Parent: Thank you for the update on Neha's performance. We're proud of her progress. Is there anything specific she should focus on to maintain her grades?\n\nYou: Neha is doing excellently! I recommend she continues practicing Trigonometry problems as that's an area where she can improve further.",
    color: "bg-edu-green",
  },
  {
    initials: "SP", name: "Sneha Patel's Parents", status: "Scheduled", statusColor: "bg-edu-light-blue text-edu-blue",
    cls: "Class 10-A", date: "Meeting: Feb 20, 2025",
    text: "Meeting scheduled to discuss Sneha's missing assignments and declining grades. Proposed time: 4:00 PM at school.",
    color: "bg-edu-orange",
  },
];

const templates = ["Grade Concern", "Good Performance", "Attendance Issue", "Missing Assignments", "Meeting Request"];

const ParentNotes = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Parent Notes</h1>
          <p className="page-subtitle">Communicate with parents and track conversations.</p>
        </div>
        <button className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90">
          New Message
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="24" label="Total Messages" iconColor="blue" />
        <StatCard value="5" label="Pending Replies" iconColor="yellow" />
        <StatCard value="18" label="Resolved" iconColor="green" />
        <StatCard value="3" label="Meetings Scheduled" iconColor="red" />
      </div>

      <div className="grid grid-cols-4 gap-5">
        {/* Templates sidebar */}
        <div className="content-card">
          <h3 className="font-semibold text-foreground mb-3">Quick Templates</h3>
          <div className="space-y-2">
            {templates.map((t) => (
              <button key={t} className="w-full text-left text-sm p-2.5 rounded-lg border hover:bg-muted transition-colors text-foreground">{t}</button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="col-span-3 space-y-4">
          <div className="flex gap-2 mb-2">
            {["All Messages", "Sent", "Received", "Meetings"].map((t, i) => (
              <button key={t} className={`px-4 py-2 text-sm rounded-lg font-medium ${i === 0 ? "bg-primary text-primary-foreground" : "border text-foreground"}`}>{t}</button>
            ))}
          </div>

          {messages.map((m, i) => (
            <div key={i} className="content-card">
              <div className="flex items-start gap-4">
                <div className={`avatar-circle w-10 h-10 ${m.color}`}>{m.initials}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-foreground text-sm">{m.name}</h3>
                    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${m.statusColor}`}>{m.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{m.cls} • {m.date}</p>
                  <p className="text-sm text-foreground whitespace-pre-line">{m.text}</p>
                </div>
                <div className="flex gap-2">
                  <button className="text-sm text-primary font-medium hover:underline">Reply</button>
                  <button className="text-sm text-primary font-medium hover:underline">View Thread</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ParentNotes;
