import { Bell, LogOut, Menu } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { getInitials } from "../lib/initials";

interface HeaderProps {
  onMenuClick?: () => void;
}

const TeacherHeader = ({ onMenuClick }: HeaderProps) => {
  const { teacherData, user, logout } = useAuth();
  const initials = getInitials(teacherData?.name || user?.displayName);

  return (
    <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 sticky top-0 z-50">
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          type="button"
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-slate-500" />
        </button>

        <img
          src="/edullent-icon.png"
          alt="Edullent"
          className="w-9 h-9 rounded-lg object-contain shrink-0"
          draggable={false}
        />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-[#1e3272] uppercase leading-tight truncate max-w-[120px] sm:max-w-none">
            {teacherData?.schoolName || "EDULLENT"}
          </span>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">
            {teacherData?.subject || "Teacher"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        <button
          type="button"
          className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-slate-500" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full" />
        </button>
        <div className="h-8 w-[1px] bg-slate-200 mx-1 hidden sm:block" />
        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-bold text-slate-900 leading-none">
              {teacherData?.name || user?.displayName || "Teacher"}
            </span>
            <span className="text-[10px] font-medium text-slate-500 uppercase">
              {teacherData?.subject || "Teacher"}
            </span>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#1e3272] flex items-center justify-center text-white text-sm font-semibold shadow-md shrink-0">
            {initials}
          </div>
          <button
            onClick={logout}
            type="button"
            className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TeacherHeader;
