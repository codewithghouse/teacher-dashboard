import { useNavigate, useLocation } from "react-router-dom";

/* ── Blue Apple tokens (mockup) ── */
const B1 = "#0055FF";
const INACTIVE = "rgba(0,85,255,0.26)";
const ACTIVE_LBL = "#0055FF";
const INACTIVE_LBL = "#99AACC";

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
    match: ["/my-classes", "/assignments", "/tests", "/exam", "/lesson-planner", "/summarize-lesson", "/syllabus"],
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
    <div
      className="flex md:hidden"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 88,
        background: "rgba(238,244,255,0.92)",
        WebkitBackdropFilter: "saturate(220%) blur(32px)",
        backdropFilter: "saturate(220%) blur(32px)",
        borderTop: "0.5px solid rgba(0,85,255,0.10)",
        alignItems: "flex-start",
        justifyContent: "space-around",
        padding: "12px 4px max(12px, env(safe-area-inset-bottom)) 4px",
        zIndex: 50,
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.match.includes(basePath);
        const strokeColor = active ? B1 : INACTIVE;
        const strokeWidth = active ? 2 : 1.7;

        return (
          <button type="button"
            key={item.path}
            onClick={() => navigate(item.path)}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              minWidth: 52,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div style={{
              width: 27,
              height: 27,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {item.icon}
              </svg>
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: active ? 700 : 500,
                color: active ? ACTIVE_LBL : INACTIVE_LBL,
                lineHeight: 1,
                letterSpacing: "0.02em",
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default MobileBottomNav;