import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
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
  LogOut
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
  const { teacherData, user, logout } = useAuth();

  return (
    <aside className="w-64 h-screen sticky top-0 bg-card border-r flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold text-primary">EDUINTELLECT</span>
          {teacherData?.schoolName && (
            <span className="text-[10px] font-bold text-foreground mt-1 truncate max-w-[120px]">
              {teacherData.schoolName}
            </span>
          )}
          {teacherData?.branch && (
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5 truncate max-w-[120px]">
              {teacherData.branch}
            </span>
          )}
        </div>
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
      <div className="mt-auto p-4 border-t space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
            {teacherData?.name?.[0] || user?.displayName?.[0] || "T"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-foreground truncate">{teacherData?.name || user?.displayName || "Teacher"}</p>
            <p className="text-xs text-muted-foreground truncate">{teacherData?.subject || "Department"}</p>
          </div>
        </div>
        <button 
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-rose-500 hover:bg-rose-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
};

export default TeacherSidebar;
