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
} from "lucide-react";

const navItems = [
  { title: "Dashboard",       path: "/",                icon: LayoutDashboard },
  { title: "My Classes",      path: "/my-classes",      icon: BookOpen        },
  { title: "Attendance",      path: "/attendance",      icon: ClipboardCheck  },
  { title: "Assignments",     path: "/assignments",     icon: FileText        },
  { title: "Tests & Exams",   path: "/tests",           icon: GraduationCap   },
  { title: "Exam Generator",  path: "/exam",            icon: FileSpreadsheet },
  { title: "Students",        path: "/students",        icon: Users           },
  { title: "Behaviour",       path: "/student-behaviour", icon: Star          },
  { title: "Gradebook",       path: "/gradebook",       icon: BookMarked      },
  { title: "Concept Mastery", path: "/concept-mastery", icon: Brain           },
  { title: "Syllabus",        path: "/syllabus",        icon: Library         },
  { title: "Risks & Alerts",  path: "/risks-alerts",    icon: AlertTriangle   },
  { title: "Parent Notes",    path: "/parent-notes",    icon: MessageSquare   },
  { title: "Principal Notes", path: "/principal-notes", icon: School          },
  { title: "AI Lesson Planner", path: "/lesson-planner", icon: Sparkles      },
  { title: "Summarize Lesson", path: "/summarize-lesson", icon: ScrollText   },
  { title: "Leaderboard",     path: "/leaderboard",     icon: Trophy          },
  { title: "Reports",         path: "/reports",         icon: BarChart3       },
  { title: "Settings",        path: "/settings",        icon: Settings        },
];

interface TeacherSidebarProps {
  onClose?: () => void;
}

// Floating card sidebar — slides in on mobile (toggled by header hamburger),
// sticky always-visible on desktop. Card sits with 10px gap from edges.
const TeacherSidebar = ({ onClose }: TeacherSidebarProps) => {
  const { logout } = useAuth();
  const location = useLocation();

  return (
    <aside className="w-[calc(100%-10px)] h-[calc(100%-20px)] mt-[10px] mb-[10px] ml-[10px] bg-white flex flex-col shrink-0 overflow-y-auto rounded-2xl shadow-[0_8px_28px_rgba(15,23,42,0.18)] md:shadow-[0_8px_28px_rgba(15,23,42,0.08)]">

      {/* Eyebrow */}
      <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
          Navigation
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          // Active match: home is exact, others use startsWith for nested routes
          const isActive =
            item.path === "/"
              ? location.pathname === "/"
              : location.pathname === item.path || location.pathname.startsWith(item.path + "/");
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