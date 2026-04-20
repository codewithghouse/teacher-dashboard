import { Component, type ErrorInfo, type ReactNode } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

// Stub for production error telemetry. Wire Sentry/Datadog/LogRocket here —
// this keeps the integration point explicit rather than scattered console.error
// calls. Runs only in PROD to avoid noise during local development.
function reportError(error: Error, info: ErrorInfo) {
  if (!import.meta.env.PROD) return;
  // TODO: forward to Sentry/Datadog: e.g. Sentry.captureException(error, { extra: info });
  try {
    // Minimal beacon so at least one signal is persisted when telemetry is
    // not yet wired. Safe to remove once a real provider is integrated.
    console.error("[ErrorBoundary:PROD]", error.name, error.message, info.componentStack);
  } catch { /* noop */ }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    reportError(error, info);
  }

  // Escape hatch for reload loops: clears Firebase auth + local/session
  // storage so a corrupt local state doesn't immediately retrigger the error.
  handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("[ErrorBoundary] signOut failed", e);
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch { /* ignore storage errors */ }
    window.location.href = "/";
  };

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, background: "#f8fafc", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 360, lineHeight: 1.6, marginBottom: 20 }}>
            An unexpected error occurred. Try again, refresh, or sign out if the problem persists.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={this.handleTryAgain}
              style={{ padding: "12px 28px", borderRadius: 12, background: "#1e3272", color: "#fff", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "12px 24px", borderRadius: 12, background: "#fff", color: "#1e3272", fontSize: 14, fontWeight: 600, border: "1px solid #e2e8f0", cursor: "pointer" }}
            >
              Refresh Page
            </button>
            <button
              onClick={this.handleSignOut}
              style={{ padding: "12px 24px", borderRadius: 12, background: "#fff", color: "#dc2626", fontSize: 14, fontWeight: 600, border: "1px solid #fee2e2", cursor: "pointer" }}
            >
              Sign Out
            </button>
          </div>
          {this.state.error && import.meta.env.DEV && (
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 16, maxWidth: 400, wordBreak: "break-word", fontFamily: "monospace" }}>
              {this.state.error.message}
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}