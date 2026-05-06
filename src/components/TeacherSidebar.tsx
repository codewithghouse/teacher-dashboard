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
  LogOut,
  Sparkles,
  ScrollText,
  Library,
  FileSpreadsheet,
  Star,
  Trophy,
  ScanText,
  Award,
} from "lucide-react";

// Sidebar nav grouped into logical sections so the long flat list reads as
// a structured outline (Overview / Classroom / Academics / …) instead of one
// scrolling wall.
const navSections: {
  title: string;
  items: { title: string; path: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", path: "/", icon: LayoutDashboard },
    ],
  },
  {
    title: "Classroom",
    items: [
      { title: "My Classes",  path: "/my-classes",        icon: BookOpen       },
      { title: "Students",    path: "/students",          icon: Users          },
      { title: "Attendance",  path: "/attendance",        icon: ClipboardCheck },
      { title: "Behaviour",   path: "/student-behaviour", icon: Star           },
    ],
  },
  {
    title: "Academics",
    items: [
      { title: "Assignments",     path: "/assignments",     icon: FileText        },
      { title: "Tests & Exams",   path: "/tests",           icon: GraduationCap   },
      { title: "Exam Structure",  path: "/exam-structure",  icon: Award           },
      { title: "Exam Generator",  path: "/exam",            icon: FileSpreadsheet },
      { title: "Paper Correction",path: "/paper-correction",icon: ScanText        },
      { title: "Gradebook",       path: "/gradebook",       icon: BookMarked      },
      { title: "Syllabus",        path: "/syllabus",        icon: Library         },
      { title: "Concept Mastery", path: "/concept-mastery", icon: Brain           },
    ],
  },
  {
    title: "AI & Insights",
    items: [
      { title: "AI Lesson Planner", path: "/lesson-planner",   icon: Sparkles      },
      { title: "Summarize Lesson",  path: "/summarize-lesson", icon: ScrollText    },
      { title: "Risks & Alerts",    path: "/risks-alerts",     icon: AlertTriangle },
      { title: "Leaderboard",       path: "/leaderboard",      icon: Trophy        },
      { title: "Reports",           path: "/reports",          icon: BarChart3     },
      { title: "Alumni",            path: "/alumni",           icon: Sparkles      },
    ],
  },
  {
    title: "Communication",
    items: [
      { title: "Parent Notes",    path: "/parent-notes",    icon: MessageSquare },
      { title: "Principal Notes", path: "/principal-notes", icon: School        },
    ],
  },
  {
    title: "Account",
    items: [
      { title: "Settings", path: "/settings", icon: Settings },
    ],
  },
];

interface TeacherSidebarProps {
  onClose?: () => void;
}

// Floating card sidebar — slides in on mobile (toggled by header hamburger),
// sticky always-visible on desktop. Card sits with 10px gap from edges.
const TeacherSidebar = ({ onClose }: TeacherSidebarProps) => {
  const { logout } = useAuth();
  const location = useLocation();

  const isItemActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <aside className="w-[calc(100%-10px)] h-[calc(100%-20px)] mt-[10px] mb-[10px] ml-[10px] bg-white flex flex-col shrink-0 overflow-y-auto rounded-2xl shadow-[0_8px_28px_rgba(15,23,42,0.18)] md:shadow-[0_8px_28px_rgba(15,23,42,0.08)]">

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navSections.map((section, sIdx) => (
          <div key={section.title} className={sIdx === 0 ? "" : "mt-5"}>
            <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = isItemActive(item.path);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
                      isActive
                        ? "bg-[#1e3272] text-white shadow-lg shadow-blue-900/10 scale-[1.02]"
                        : "text-slate-500 hover:bg-slate-50 hover:text-[#1e3272]"
                    }`}
                  >
                    <item.icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} aria-hidden="true" />
                    <span className="flex-1">{item.title}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-100 mt-auto">
        <button
          type="button"
          onClick={logout}
          className="w-full flex items-center gap-3 h-12 px-3 rounded-xl text-rose-500 hover:bg-rose-50 hover:text-rose-600 font-bold transition-colors"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

export default TeacherSidebar;
