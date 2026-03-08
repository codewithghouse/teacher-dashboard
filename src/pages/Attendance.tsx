import StatCard from "@/components/StatCard";

const weeklyData = [
  { day: "Mon", date: "Feb 10", present: 30, absent: 2, rate: "93.8%" },
  { day: "Tue", date: "Feb 11", present: 31, absent: 1, rate: "96.9%" },
  { day: "Wed", date: "Feb 12", present: 29, absent: 3, rate: "90.6%" },
  { day: "Thu", date: "Feb 13", present: 32, absent: 0, rate: "100%" },
  { day: "Fri", date: "Feb 14", present: 30, absent: 2, rate: "93.8%" },
];

const concerns = [
  { initials: "RK", name: "Rahul Kumar", issue: "5 absences this month", color: "bg-edu-red" },
  { initials: "SP", name: "Sneha Patel", issue: "3 absences this month", color: "bg-edu-orange" },
  { initials: "AM", name: "Amit Mishra", issue: "Frequently late", color: "bg-muted-foreground" },
];

const Attendance = () => {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Track and manage student attendance across all classes.</p>
        </div>
        <button className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90">
          Mark Today's Attendance
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="94.2%" label="Overall Rate" iconColor="green" />
        <StatCard value="125" label="Present Today" iconColor="blue" />
        <StatCard value="8" label="Absent Today" iconColor="red" />
        <StatCard value="3" label="Late Today" iconColor="yellow" />
      </div>

      {/* Weekly Attendance */}
      <div className="content-card mb-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Weekly Attendance Overview</h2>
          <p className="text-sm text-muted-foreground">Class 8-A • Feb 10 - Feb 17, 2025</p>
        </div>
        <div className="grid grid-cols-6 gap-3">
          {weeklyData.map((d, i) => (
            <div key={i} className="border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">{d.day}</p>
              <p className="text-lg font-bold text-foreground">{d.date}</p>
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Present</span>
                  <span className="font-semibold text-edu-green">{d.present}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Absent</span>
                  <span className="font-semibold text-edu-red">{d.absent}</span>
                </div>
              </div>
              <p className="text-sm font-semibold text-edu-green mt-2">{d.rate}</p>
            </div>
          ))}
          {/* Today - Upcoming */}
          <div className="border-2 border-edu-yellow rounded-lg p-4 bg-edu-light-yellow">
            <p className="text-sm text-muted-foreground">Mon</p>
            <p className="text-lg font-bold text-foreground">Feb 17</p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Present</span>
                <span className="font-semibold">—</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Absent</span>
                <span className="font-semibold">—</span>
              </div>
            </div>
            <button className="mt-2 bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-lg font-medium w-full">
              Mark Now
            </button>
          </div>
        </div>
      </div>

      {/* Concerns */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-foreground">Attendance Concerns</h2>
        <button className="text-sm text-primary font-medium">View All</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {concerns.map((c, i) => (
          <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-edu-light-yellow">
            <div className={`avatar-circle ${c.color}`}>{c.initials}</div>
            <div>
              <p className="font-medium text-foreground text-sm">{c.name}</p>
              <p className="text-xs text-edu-orange">{c.issue}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Attendance;
