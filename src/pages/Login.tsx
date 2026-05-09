import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { GraduationCap, Loader2, AlertCircle } from 'lucide-react';

// Edullent design tokens — Blue Apple palette, locked to match the rest of
// teacher-dashboard. Inlined here so this auth surface has no cross-file
// design dependency (separate bundle from the main app routes).
const T = {
  PAGE_BG:    '#EEF4FF',
  CARD_BG:    '#FFFFFF',
  INK:        '#001040',  // T1 — primary text
  INK_SOFT:   '#5070B0',  // T3 — secondary text
  INK_FAINT:  '#99AACC',  // T4 — eyebrow / faint text
  BLUE:       '#0055FF',  // B1 — primary brand
  BLUE_LIGHT: '#1166FF',  // B2 — hover / accent
  RED:        '#FF453A',
  RED_BG:     'rgba(255,69,58,0.06)',
  RED_BORDER: 'rgba(255,69,58,0.20)',
} as const;

const FONT_BODY = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
const FONT_WORDMARK = "'Mokoto', 'Plus Jakarta Sans', sans-serif"; // Edullent brand wordmark

const Login = () => {
  const { loginWithGoogle, loading, error } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
    } catch {
      // AuthContext.error already surfaces the user-facing message in the banner
      // below. No additional toast needed — that was a double-notification bug.
    } finally {
      if (mountedRef.current) setIsLoggingIn(false);
    }
  };

  const buttonDisabled = isLoggingIn || loading;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: T.PAGE_BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: FONT_BODY,
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ maxWidth: 420, width: '100%' }}>
        {/* Brand header — gradient logo + Mokoto wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              background: `linear-gradient(135deg, ${T.BLUE} 0%, ${T.BLUE_LIGHT} 100%)`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
              boxShadow: '0 12px 32px rgba(0,85,255,0.32), 0 4px 12px rgba(0,85,255,0.18)',
              transform: 'rotate(3deg)',
              transition: 'transform 0.5s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'rotate(0deg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'rotate(3deg)'; }}
          >
            <GraduationCap style={{ width: 40, height: 40, color: '#FFFFFF' }} />
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: T.INK,
              margin: '0 0 6px',
              letterSpacing: '-1.2px',
              fontFamily: FONT_WORDMARK,
            }}
          >
            Edullent
          </h1>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: T.INK_SOFT,
              margin: 0,
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
            }}
          >
            Teacher Dashboard
          </p>
        </div>

        {/* Card — gradient top accent, Blue Apple shadows */}
        <div
          style={{
            background: T.CARD_BG,
            borderRadius: 32,
            padding: 36,
            boxShadow: '0 0 0 0.5px rgba(0,85,255,0.08), 0 8px 24px rgba(0,85,255,0.10), 0 24px 60px rgba(0,85,255,0.14)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: `linear-gradient(90deg, ${T.BLUE} 0%, ${T.BLUE_LIGHT} 100%)`,
            }}
          />

          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: T.INK,
                margin: '0 0 6px',
                letterSpacing: '-0.5px',
              }}
            >
              Welcome back
            </h2>
            <p
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: T.INK_SOFT,
                margin: 0,
              }}
            >
              Sign in to manage your classes
            </p>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 24,
                padding: 14,
                background: T.RED_BG,
                border: `0.5px solid ${T.RED_BORDER}`,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <AlertCircle style={{ width: 18, height: 18, color: T.RED, flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, fontWeight: 600, color: T.RED, margin: 0, lineHeight: 1.5 }}>
                {error}
              </p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={buttonDisabled}
            type="button"
            aria-label={isLoggingIn ? 'Signing in' : 'Sign in with Google'}
            style={{
              width: '100%',
              height: 60,
              background: T.CARD_BG,
              border: '1px solid rgba(0,85,255,0.14)',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              cursor: buttonDisabled ? 'not-allowed' : 'pointer',
              opacity: buttonDisabled ? 0.55 : 1,
              transition: 'all 0.2s ease',
              fontFamily: FONT_BODY,
              outline: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = `0 0 0 3px rgba(0,85,255,0.20)`;
              e.currentTarget.style.borderColor = T.BLUE;
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'rgba(0,85,255,0.14)';
            }}
            onMouseEnter={(e) => {
              if (!buttonDisabled) {
                e.currentTarget.style.background = 'rgba(0,85,255,0.03)';
                e.currentTarget.style.borderColor = 'rgba(0,85,255,0.24)';
              }
            }}
            onMouseLeave={(e) => {
              if (!buttonDisabled) {
                e.currentTarget.style.background = T.CARD_BG;
                e.currentTarget.style.borderColor = 'rgba(0,85,255,0.14)';
              }
            }}
          >
            {isLoggingIn ? (
              <Loader2
                style={{ width: 22, height: 22, color: T.BLUE, animation: 'spin 1s linear infinite' }}
                aria-hidden="true"
              />
            ) : (
              <>
                {/* Inline SVG instead of external <img src="https://google.com/favicon.ico"> —
                    avoids a third-party request on every login page load. */}
                <svg style={{ width: 22, height: 22 }} viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 34.6 26.7 35.5 24 35.5c-5.2 0-9.5-3.1-11.3-7.6l-6.6 5.1C9.4 39.5 16.1 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.4-2.3 4.4-4.1 5.8l6.3 5.3C42.2 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.9z" />
                </svg>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.INK, letterSpacing: '-0.2px' }}>
                  Sign in with Google
                </span>
              </>
            )}
          </button>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '0.5px solid rgba(0,85,255,0.08)', textAlign: 'center' }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: T.INK_FAINT,
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Only authorized teachers can access this portal.<br />
              Contact your school administration for access.
            </p>
          </div>
        </div>

        <p
          style={{
            textAlign: 'center',
            marginTop: 28,
            fontSize: 10,
            fontWeight: 700,
            color: T.INK_FAINT,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          Made for schools · Trusted by teachers
        </p>
      </div>
    </div>
  );
};

export default Login;
