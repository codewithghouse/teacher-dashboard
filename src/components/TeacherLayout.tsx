import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import TeacherHeader from "./TeacherHeader";
import TeacherSidebar from "./TeacherSidebar";
import MobileBottomNav from "./MobileBottomNav";

// Header (sticky top) + slide-in floating sidebar + main content + mobile bottom nav.
// Mobile  -> sidebar hidden by default, hamburger toggles overlay drawer
// Desktop -> sidebar always sticky on the left
const TeacherLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Auto-close drawer on navigation (covers cases where the NavLink onClose
  // does not run — e.g. clicking the same route).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Esc closes drawer on keyboard.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-[#EEF4FF]">
      <TeacherHeader onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1 overflow-hidden relative">

        {/* Mobile backdrop — sits below the header, dims + blurs content */}
        {sidebarOpen && (
          <div
            className="fixed top-14 inset-x-0 bottom-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar — slide-in drawer on mobile, sticky always on desktop.
            Mobile bottom clears the floating bottom nav (68px tall + 12px gap +
            safe-area inset). Desktop uses sticky + fixed height so the bottom
            value is harmless above md. */}
        <div
          id="teacher-sidebar"
          className={`fixed top-14 bottom-[calc(env(safe-area-inset-bottom)+92px)] left-0 z-50 w-64 transition-transform duration-300 ease-in-out md:sticky md:top-16 md:bottom-auto md:h-[calc(100vh-64px)] md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <TeacherSidebar onClose={() => setSidebarOpen(false)} />
        </div>

        <main className="flex-1 px-3 pt-3 pb-24 sm:px-4 sm:py-4 md:px-5 md:py-6 md:pb-6 overflow-y-auto md:h-[calc(100vh-64px)] min-w-0">
          <Outlet />
        </main>
      </div>

      {/* Global mobile bottom navigation — visible on mobile only */}
      <MobileBottomNav />
    </div>
  );
};

export default TeacherLayout;
