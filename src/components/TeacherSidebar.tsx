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
  X,
  Sparkles,
  ScrollText
} from "lucide-react";

const navItems = [
  { title: "Dashboard",       path: "/",                icon: LayoutDashboard },
  { title: "My Classes",      path: "/my-classes",      icon: BookOpen        },
  { title: "Attendance",      path: "/attendance",      icon: ClipboardCheck  },
  { title: "Assignments",     path: "/assignments",     icon: FileText        },
  { title: "Tests & Exams",   path: "/tests",           icon: GraduationCap   },
  { title: "Students",        path: "/students",        icon: Users           },
  { title: "Gradebook",       path: "/gradebook",       icon: BookMarked      },
  { title: "Concept Mastery", path: "/concept-mastery", icon: Brain           },
  { title: "Risks & Alerts",  path: "/risks-alerts",    icon: AlertTriangle   },
  { title: "Parent Notes",    path: "/parent-notes",    icon: MessageSquare   },
  { title: "Principal Notes", path: "/principal-notes", icon: School          },
  { title: "AI Lesson Planner", path: "/lesson-planner", icon: Sparkles      },
  { title: "Summarize Lesson", path: "/summarize-lesson", icon: ScrollText   },
  { title: "Reports",         path: "/reports",         icon: BarChart3       },
  { title: "Settings",        path: "/settings",        icon: Settings        },
];

interface TeacherSidebarProps {
  onClose?: () => void;
}

const TeacherSidebar = ({ onClose }: TeacherSidebarProps) => {
  const location = useLocation();
  const { teacherData, user, logout } = useAuth();

  const initials = (() => {
    const name = teacherData?.name || user?.displayName || "T";
    const parts = name.trim().split(" ");
    return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0][0]).toUpperCase();
  })();

  // Derive active state: exact match for "/", prefix match for everything else
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <aside className="w-64 h-full bg-[#1a2d66] flex flex-col overflow-y-auto">

      {/* ── Logo ── */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-white/[0.08]">
        <div className="w-8 h-8 bg-white/[0.12] rounded-lg flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col leading-none flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-white tracking-wide">EDUINTELLECT</span>
          {teacherData?.schoolName && (
            <span className="text-[10px] font-medium text-white/40 mt-0.5 truncate">
              {teacherData.schoolName}
            </span>
          )}
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.08] flex-shrink-0 transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`
                relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium
                transition-all duration-150 ease-out
                ${active
                  ? "bg-white/[0.12] text-white"
                  : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                }
              `}
            >
              {/* Active left indicator */}
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-white/60" />
              )}
              <item.icon
                className={`w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150 ${
                  active ? "text-white" : "text-white/40"
                }`}
              />
              {item.title}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Teacher Profile ── */}
      <div className="p-3 border-t border-white/[0.08]">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-white/[0.15] flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
            {initials}
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white truncate leading-tight">
              {teacherData?.name || user?.displayName || "Teacher"}
            </p>
            <p className="text-[10px] text-white/40 truncate mt-0.5">
              {teacherData?.subject || "Department"}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium text-white/40 hover:bg-white/[0.06] hover:text-rose-300 transition-all duration-150 ease-out"
        >
          <LogOut className="w-[15px] h-[15px]" />
          Sign out
        </button>
      </div>

    </aside>
  );
};

export default TeacherSidebar;