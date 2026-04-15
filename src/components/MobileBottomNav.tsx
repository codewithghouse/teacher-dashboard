import { useNavigate, useLocation } from "react-router-dom";

const T = {
  white: "#ffffff",
  bdr: "#E2E5EE",
  ink3: "#8C92A4",
  blue: "#3B5BDB",
};

const NAV_ITEMS = [
  {
    label: "Home",
    path: "/",
    icon: (
      <>
        <rect x="2" y="2" width="5" height="5" rx="1.2" />
        <rect x="11" y="2" width="5" height="5" rx="1.2" />
        <rect x="2" y="11" width="5" height="5" rx="1.2" />
        <rect x="11" y="11" width="5" height="5" rx="1.2" />
      </>
    ),
    match: ["/"],
  },
  {
    label: "Students",
    path: "/students",
    icon: (
      <>
        <circle cx="9" cy="6" r="2.5" />
        <path d="M4 16c0-3 2.5-5 5-5s5 2 5 5" />
        <circle cx="4.5" cy="8" r="2" />
        <path d="M1 16c0-2 1.5-3.5 3.5-3.5" />
      </>
    ),
    match: ["/students", "/gradebook", "/concept-mastery"],
  },
  {
    label: "AI Tools",
    path: "/lesson-planner",
    icon: <path d="M9 2L10.8 6.5H15L11.8 9.5L13 14L9 11.5L5 14L6.2 9.5L3 6.5H7.2Z" />,
    match: ["/lesson-planner", "/summarize-lesson"],
  },
  {
    label: "Messages",
    path: "/parent-notes",
    icon: (
      <>
        <path d="M3 14V5.5C3 4.4 3.9 3.5 5 3.5H13C14.1 3.5 15 4.4 15 5.5V11C15 12.1 14.1 13 13 13H6.5L3 14Z" />
      </>
    ),
    match: ["/parent-notes", "/principal-notes"],
  },
  {
    label: "Settings",
    path: "/settings",
    icon: (
      <>
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 2.5V4M9 14v1.5M2.5 9H4M14 9h1.5M4.2 4.2l1 1M12.8 12.8l1 1M4.2 13.8l1-1M12.8 5.2l1-1" />
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
      className="md:hidden"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: T.white,
        borderTop: `1px solid ${T.bdr}`,
        padding: "8px 12px max(14px, env(safe-area-inset-bottom))",
        display: "flex",
        justifyContent: "space-around",
        zIndex: 50,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.match.includes(basePath);
        const color = active ? T.blue : T.ink3;

        return (
          <button
            key={item.label}
            onClick={() => navigate(item.path)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 8px",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 18 18"
              fill="none"
              stroke={color}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.icon}
            </svg>
            <span
              style={{
                fontSize: 9,
                fontWeight: active ? 600 : 400,
                color,
                lineHeight: 1,
              }}
            >
              {item.label}
            </span>
            {active && (
              <div
                style={{
                  width: 14,
                  height: 2.5,
                  borderRadius: 2,
                  background: T.blue,
                  marginTop: 1,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default MobileBottomNav;