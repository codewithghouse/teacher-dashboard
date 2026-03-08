import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Users,
  BookMarked,
  Brain,
  AlertTriangle,
  MessageSquare,
  BarChart3,
  Settings,
} from "lucide-react";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "My Classes", path: "/my-classes", icon: BookOpen },
  { title: "Attendance", path: "/attendance", icon: ClipboardCheck },
  { title: "Assignments", path: "/assignments", icon: FileText },
  { title: "Tests & Exams", path: "/tests", icon: GraduationCap },
  { title: "Students", path: "/students", icon: Users },
  { title: "Gradebook", path: "/gradebook", icon: BookMarked },
  { title: "Concept Mastery", path: "/concept-mastery", icon: Brain },
  { title: "Risks & Alerts", path: "/risks-alerts", icon: AlertTriangle },
  { title: "Parent Notes", path: "/parent-notes", icon: MessageSquare },
  { title: "Reports", path: "/reports", icon: BarChart3 },
  { title: "Settings", path: "/settings", icon: Settings },
];

const TeacherSidebar = () => {
  const location = useLocation();

  return (
    <aside className="w-64 min-h-screen bg-card border-r flex flex-col">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-primary-foreground" />
        </div>
        <span className="text-lg font-bold text-primary">EDUINTELLECT</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.title}
            </NavLink>
          );
        })}
      </nav>

      {/* Teacher Profile */}
      <div className="p-4 border-t flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
          PS
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Priya Sharma</p>
          <p className="text-xs text-muted-foreground">Mathematics</p>
        </div>
      </div>
    </aside>
  );
};

export default TeacherSidebar;
