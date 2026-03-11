import { useState } from "react";
import StatCard from "@/components/StatCard";
import CreateTest from "@/components/CreateTest";
import EnterScores from "@/components/EnterScores";

const upcomingTests = [
  { name: "Unit Test: Quadratic Equations", cls: "Class 10-A", students: 30, date: "Feb 19, 2025", duration: "45 minutes", marks: "50 marks", inDays: "In 2 days", highlight: true },
  { name: "Chapter Test: Geometry", cls: "Class 9-B", students: 28, date: "Feb 22, 2025", duration: "60 minutes", marks: "75 marks", inDays: "In 5 days", highlight: false },
  { name: "Quiz: Fractions & Decimals", cls: "Class 7-C", students: 35, date: "Feb 24, 2025", duration: "30 minutes", marks: "25 marks", inDays: "In 1 week", highlight: false },
];

const classPerf = [
  { cls: "Class 8-A", pct: 78.5, color: "bg-edu-green" },
  { cls: "Class 9-B", pct: 72.3, color: "bg-edu-yellow" },
  { cls: "Class 7-C", pct: 81.2, color: "bg-edu-green" },
  { cls: "Class 10-A", pct: 65.8, color: "bg-edu-red" },
];

const topicPerf = [
  { topic: "Algebra", pct: "82%" },
  { topic: "Geometry", pct: "71%" },
  { topic: "Statistics", pct: "79%" },
  { topic: "Trigonometry", pct: "64%" },
];

const TestsExams = () => {
  const [view, setView] = useState<'list' | 'create' | 'enter-scores'>('list');
  const [selectedTest, setSelectedTest] = useState<string>("");

  const handleEnterScores = (testName: string) => {
    setSelectedTest(testName);
    setView('enter-scores');
  };

  if (view === 'create') {
    return <CreateTest onCancel={() => setView('list')} onCreate={() => setView('list')} />;
  }

  if (view === 'enter-scores') {
    return <EnterScores testName={selectedTest} onBack={() => setView('list')} />;
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Tests & Exams</h1>
          <p className="page-subtitle">Manage tests, enter scores, and analyze performance.</p>
        </div>
        <button 
          onClick={() => setView('create')}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Create Test
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard value="3" label="Upcoming" iconColor="yellow" />
        <StatCard value="12" label="Completed" iconColor="blue" />
        <StatCard value="5" label="Pending Scores" iconColor="red" />
        <StatCard value="74.5%" label="Class Avg" iconColor="green" />
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Upcoming Tests - 2 cols */}
        <div className="col-span-2 content-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Upcoming Tests</h2>
          <div className="space-y-4">
            {upcomingTests.map((test, i) => (
              <div key={i} className={`border rounded-xl p-5 ${test.highlight ? "bg-edu-light-yellow border-edu-yellow" : ""}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{test.name}</h3>
                    <p className="text-sm text-muted-foreground">{test.cls} • {test.students} students</p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    test.highlight ? "bg-edu-light-yellow text-edu-orange" : "bg-edu-light-blue text-edu-blue"
                  }`}>{test.inDays}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{test.date} · {test.duration} · {test.marks}</p>
                <div className="flex gap-2">
                  {test.highlight ? (
                    <>
                      <button 
                        onClick={() => handleEnterScores(test.name)}
                        className="bg-primary text-primary-foreground text-sm px-4 py-1.5 rounded-lg font-medium"
                      >
                        Enter Scores
                      </button>
                      <button className="border text-sm px-4 py-1.5 rounded-lg font-medium text-foreground">Edit</button>
                      <button className="border text-sm px-4 py-1.5 rounded-lg font-medium text-foreground">Print</button>
                    </>
                  ) : (
                    <>
                      <button className="border text-sm px-4 py-1.5 rounded-lg font-medium text-foreground">View</button>
                      <button className="border text-sm px-4 py-1.5 rounded-lg font-medium text-foreground">Edit</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Overview */}
        <div className="content-card">
          <h2 className="text-lg font-semibold text-foreground mb-1">Performance Overview</h2>
          <p className="text-sm text-muted-foreground mb-5">Last 5 tests</p>
          <div className="space-y-4">
            {classPerf.map((c, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-foreground font-medium">{c.cls}</span>
                  <span className={`font-bold ${c.pct >= 75 ? "text-edu-green" : c.pct >= 65 ? "text-edu-yellow" : "text-edu-red"}`}>{c.pct}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className={`h-2 rounded-full ${c.color}`} style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <h3 className="font-semibold text-foreground mb-3">Topic Performance</h3>
            <div className="space-y-2">
              {topicPerf.map((t, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t.topic}</span>
                  <span className="font-bold text-foreground">{t.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestsExams;


