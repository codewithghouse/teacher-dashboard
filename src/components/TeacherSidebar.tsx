import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { getInitials } from "../lib/initials";
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
  ScrollText,
  Library,
  FileSpreadsheet,
  Star
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
  { title: "Reports",         path: "/reports",         icon: BarChart3       },
  { title: "Settings",        path: "/settings",        icon: Settings        },
];

interface TeacherSidebarProps {
  onClose?: () => void;
}

const TeacherSidebar = ({ onClose }: TeacherSidebarProps) => {
  const { teacherData, user, logout } = useAuth();

  const initials = getInitials(teacherData?.name || user?.displayName);
  const displayName = teacherData?.name || user?.displayName || "Teacher";

  return (
    <aside className="w-64 h-full bg-[#1a2d66] md:bg-[#eef2ff] md:border-r md:border-slate-200 flex flex-col">

      {/* ── Logo ── */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-white/[0.08] md:border-slate-200">
        <div className="w-8 h-8 bg-white/[0.12] md:bg-[#1e3272] rounded-lg flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col leading-none flex-1 min-w-0">
          <span className="text-[13px] md:text-[15px] font-semibold text-white md:text-[#1e3272] tracking-wide md:tracking-wider">EDULLENT</span>
          {teacherData?.schoolName && (
            <span
              className="text-[10px] font-medium text-white/40 md:text-slate-500 mt-0.5 truncate"
              title={teacherData.schoolName}
            >
              {teacherData.schoolName}
            </span>
          )}
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.08] flex-shrink-0 transition-colors duration-150"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 md:space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            onClick={onClose}
            className={({ isActive }) => `
              relative flex items-center gap-3 px-3 py-2.5 md:py-2.5 rounded-lg text-[13px] md:text-[14px] font-medium
              transition-all duration-150 ease-out
              ${isActive
                ? "bg-white/[0.12] text-white md:bg-[#1e3272] md:text-white md:shadow-sm"
                : "text-white/50 hover:bg-white/[0.06] hover:text-white/80 md:text-slate-600 md:hover:bg-slate-100 md:hover:text-slate-900"
              }
            `}
          >
            {({ isActive }) => (
              <>
                {/* Active left indicator — mobile only; desktop uses full bg */}
                {isActive && (
                  <span className="md:hidden absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-white/60" />
                )}
                <item.icon
                  className={`w-[15px] h-[15px] md:w-[16px] md:h-[16px] flex-shrink-0 transition-colors duration-150 ${
                    isActive ? "text-white md:text-white" : "text-white/40 md:text-slate-500"
                  }`}
                  aria-hidden="true"
                />
                {item.title}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Teacher Profile ── */}
      <div className="p-3 border-t border-white/[0.08] md:border-slate-200">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-white/[0.15] md:bg-[#1e3272] flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
            {initials}
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <p
              className="text-[13px] font-medium text-white md:text-slate-900 truncate leading-tight"
              title={displayName}
            >
              {displayName}
            </p>
            <p
              className="text-[10px] md:text-[11px] text-white/40 md:text-slate-500 truncate mt-0.5"
              title={teacherData?.subject || "Department"}
            >
              {teacherData?.subject || "Department"}
            </p>
          </div>
        </div>
        <button type="button"
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium text-white/40 hover:bg-white/[0.06] hover:text-rose-300 md:text-slate-500 md:hover:bg-rose-50 md:hover:text-rose-600 transition-all duration-150 ease-out"
        >
          <LogOut className="w-[15px] h-[15px]" aria-hidden="true" />
          Sign out
        </button>
      </div>

    </aside>
  );
};

export default TeacherSidebar;
