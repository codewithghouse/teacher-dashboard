import { useNavigate, useLocation } from "react-router-dom";

/* ── Blue Apple tokens ── */
const ACTIVE = "#0055FF";
const INACTIVE = "#94A3B8";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    path: "/",
    icon: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </>
    ),
    match: ["/", "/attendance"],
  },
  {
    label: "Classes",
    path: "/my-classes",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    match: ["/my-classes", "/assignments", "/tests", "/exam", "/paper-correction", "/lesson-planner", "/summarize-lesson", "/syllabus", "/result-predictor"],
  },
  {
    label: "Grades",
    path: "/gradebook",
    icon: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </>
    ),
    match: ["/gradebook", "/students", "/concept-mastery", "/reports"],
  },
  {
    label: "Alerts",
    path: "/risks-alerts",
    icon: (
      <>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </>
    ),
    match: ["/risks-alerts", "/parent-notes", "/principal-notes"],
  },
  {
    label: "Profile",
    path: "/settings",
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    match: ["/settings"],
  },
];

const MobileBottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = "/" + location.pathname.split("/")[1];

  return (
    // Outer fixed wrapper centers the floating pill with margin from edges.
    // pointer-events-none lets taps pass through the gutters; the inner pill
    // re-enables them with pointer-events-auto.
    <nav
      className="md:hidden fixed inset-x-0 z-50 flex justify-center px-3 pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div
        className="flex items-center w-full max-w-[440px] pointer-events-auto"
        style={{
          height: 68,
          padding: "0 6px",
          borderRadius: 28,
          background: "rgba(255,255,255,0.62)",
          backdropFilter: "saturate(220%) blur(28px)",
          WebkitBackdropFilter: "saturate(220%) blur(28px)",
          border: "0.5px solid rgba(255,255,255,0.85)",
          boxShadow:
            "0 0 0 0.5px rgba(0,85,255,0.10), 0 2px 6px rgba(0,85,255,0.08), 0 12px 28px rgba(0,85,255,0.18), 0 28px 64px rgba(0,85,255,0.22)",
          fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.match.includes(basePath);
          return (
            <button
              type="button"
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className="flex-1 h-full flex flex-col items-center justify-center gap-[3px] transition-transform active:scale-[0.92]"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                transitionTimingFunction: "cubic-bezier(0.34,1.56,0.64,1)",
              }}
            >
              <svg
                width={20}
                height={20}
                viewBox="0 0 24 24"
                fill="none"
                stroke={active ? ACTIVE : INACTIVE}
                strokeWidth={active ? 2.4 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ transition: "stroke 0.15s ease" }}
              >
                {item.icon}
              </svg>
              <span
                className="text-[10px] tracking-tight leading-tight transition-colors"
                style={{
                  color: active ? ACTIVE : INACTIVE,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
