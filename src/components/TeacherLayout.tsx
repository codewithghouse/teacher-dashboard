import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import TeacherSidebar from "./TeacherSidebar";
import MobileBottomNav from "./MobileBottomNav";
import { useAuth } from "../lib/AuthContext";
import { getInitials } from "../lib/initials";

// Maps each route to a human-readable page title shown in the mobile header
const ROUTE_TITLES: Record<string, string> = {
  "/":                  "Dashboard",
  "/my-classes":        "My Classes",
  "/attendance":        "Attendance",
  "/assignments":       "Assignments",
  "/tests":             "Tests & Exams",
  "/students":          "Students",
  "/gradebook":         "Gradebook",
  "/concept-mastery":   "Concept Mastery",
  "/risks-alerts":      "Risks & Alerts",
  "/parent-notes":      "Parent Notes",
  "/principal-notes":   "Principal Notes",
  "/lesson-planner":    "AI Lesson Planner",
  "/summarize-lesson":  "Summarize Lesson",
  "/syllabus":          "Syllabus",
  "/reports":           "Reports",
  "/settings":          "Settings",
};

const TeacherLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { teacherData } = useAuth();

  // Derive page title — strip dynamic segments like /my-classes/:id
  const basePath = "/" + location.pathname.split("/")[1];
  const pageTitle = ROUTE_TITLES[basePath] || "Edullent";

  // Teacher initials for mobile avatar.
  const initials = getInitials(teacherData?.name || teacherData?.displayName);

  // Pages where the mobile navbar should be dark to blend with their hero
  // header. The list is enumerated (not "all routes") so that adding a new
  // page with a light/gradient header is a one-line change here.
  const darkNavRoutes = ["/", "/my-classes", "/attendance", "/assignments", "/tests", "/students", "/lesson-planner", "/summarize-lesson", "/reports", "/settings"];
  const isDarkNav = darkNavRoutes.includes(basePath);

  // Close the mobile sidebar drawer on Esc for keyboard users.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex min-h-screen w-full">

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed drawer on mobile, sticky on desktop */}
      <div
        id="teacher-sidebar"
        className={`fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-300 ease-in-out md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <TeacherSidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area */}
      <main className="flex-1 overflow-auto bg-[#EEF4FF] min-w-0">

        {/* ── Mobile top bar (hidden on md+) ── */}
        <div className={`md:hidden sticky top-0 z-30 transition-colors duration-200 ${
          isDarkNav
            ? "bg-[#08090C]"
            : "bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm shadow-slate-100/60"
        }`}>
          <div className="flex items-center gap-3 px-4 h-14">

            {/* Hamburger */}
            <button type="button"
              onClick={() => setSidebarOpen(true)}
              className={`w-9 h-9 flex items-center justify-center rounded-xl active:scale-90 transition-transform flex-shrink-0 ${
                isDarkNav ? "text-white/60 hover:text-white" : "bg-[#1e3272] text-white"
              }`}
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
              aria-expanded={sidebarOpen}
              aria-controls="teacher-sidebar"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Page title + school name */}
            <div className="flex-1 min-w-0">
              <p className={`text-[15px] font-bold truncate leading-tight ${isDarkNav ? "text-white" : "text-slate-800"}`}>
                {pageTitle}
              </p>
              {teacherData?.schoolName && (
                <p className={`text-[10px] font-medium truncate leading-none mt-0.5 ${isDarkNav ? "text-white/40" : "text-slate-400"}`}>
                  {teacherData.schoolName}
                </p>
              )}
            </div>

            {/* Teacher avatar */}
            <div className="w-8 h-8 rounded-full bg-[#1e3272] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 ring-2 ring-[#1e3272]/20">
              {initials}
            </div>

          </div>
        </div>

        {/* Page content — extra bottom padding on mobile for the fixed nav bar */}
        <div className={`${isDarkNav ? "pt-0 px-4 pb-20 sm:px-6 md:pt-8 md:px-8 md:pb-8" : "p-4 pb-20 sm:p-6 md:p-8 md:pb-8"}`}>
          <Outlet />
        </div>

      </main>

      {/* ── Global mobile bottom navigation ── */}
      <MobileBottomNav />
    </div>
  );
};

export default TeacherLayout;