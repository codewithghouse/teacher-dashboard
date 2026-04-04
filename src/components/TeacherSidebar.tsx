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
  School,
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
  { title: "Principal Notes", path: "/principal-notes", icon: School },
  { title: "Reports", path: "/reports", icon: BarChart3 },
  { title: "Settings", path: "/settings", icon: Settings },
];

const TeacherSidebar = () => {
  const location = useLocation();
  const { teacherData, user, logout } = useAuth();

  const initials = (() => {
    const name = teacherData?.name || user?.displayName || "T";
    const parts = name.trim().split(" ");
    return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0][0];
  })();

  return (
    <aside className="w-64 h-screen sticky top-0 bg-[#1e3272] flex flex-col shrink-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-6 py-5 flex items-center gap-3 border-b border-white/10">
        <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold text-white tracking-wide">EDUINTELLECT</span>
          {teacherData?.schoolName && (
            <span className="text-[10px] font-medium text-blue-200 mt-0.5 truncate max-w-[130px]">
              {teacherData.schoolName}
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-blue-200 hover:bg-white/10 hover:text-white"
              }`}
            >
              <item.icon className={`w-4 h-4 ${isActive ? "text-white" : "text-blue-300"}`} />
              {item.title}
            </NavLink>
          );
        })}
      </nav>

      {/* Teacher Profile */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
            {initials}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-semibold text-white truncate">{teacherData?.name || user?.displayName || "Teacher"}</p>
            <p className="text-xs text-blue-300 truncate">{teacherData?.subject || "Department"}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-rose-300 hover:bg-white/10 hover:text-rose-200 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
};

export default TeacherSidebar;
