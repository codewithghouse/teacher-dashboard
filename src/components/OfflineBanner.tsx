import { useState, useEffect, useRef } from "react";

type Status = "online" | "offline" | "reconnected";
const RECONNECTED_BANNER_MS = 2500;

export const OfflineBanner = () => {
  const [status, setStatus] = useState<Status>(navigator.onLine ? "online" : "offline");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      // Only show the transient "reconnected" confirmation if we were
      // previously offline — avoids flashing on initial mount.
      setStatus((prev) => (prev === "offline" ? "reconnected" : "online"));
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => setStatus("online"), RECONNECTED_BANNER_MS);
    };
    const handleOffline = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      setStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  if (status === "online") return null;

  const isOffline = status === "offline";
  const background = isOffline ? "#dc2626" : "#16a34a";
  const message = isOffline
    ? "You're offline — some features may not work"
    : "Back online";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background, color: "#fff",
        padding: "8px 16px", fontSize: 13, fontWeight: 600,
        textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}
    >
      {isOffline ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="1" y1="1" x2="15" y2="15" /><path d="M2 8.5C3.5 5 6.5 3 8 3c1 0 2.5.5 3.5 1.5" />
          <path d="M5 11c1-1 2-1.5 3-1.5s2 .5 3 1.5" /><circle cx="8" cy="14" r="1" fill="#fff" stroke="none" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      )}
      {message}
    </div>
  );
};