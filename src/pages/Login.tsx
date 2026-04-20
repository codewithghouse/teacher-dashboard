import React from 'react';
import { useAuth } from '../lib/AuthContext';
import { GraduationCap, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const Login = () => {
  const { loginWithGoogle, loading, error } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== 'auth/popup-closed-by-user') {
        toast.error("Login failed. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#1e3272] rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-900/20 rotate-3 hover:rotate-0 transition-transform duration-500">
            <GraduationCap className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-[#1e294b] tracking-tight mb-2">Edullent</h1>
          <p className="text-[#64748b] font-bold uppercase tracking-[0.2em] text-xs">Teacher Dashboard</p>
        </div>

        <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-slate-200/60 border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-indigo-600"></div>
          
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-[#1e294b] mb-2">Welcome Back</h2>
            <p className="text-slate-500 font-medium">Please login to manage your classes</p>
          </div>

          {error && (
            <div className="mb-8 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-rose-600 leading-tight">{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoggingIn || loading}
            type="button"
            aria-label={isLoggingIn ? "Signing in" : "Sign in with Google"}
            className="w-full h-16 bg-white border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-4 hover:bg-slate-50 hover:border-slate-200 transition-all duration-300 group disabled:opacity-50"
          >
            {isLoggingIn ? (
              <Loader2 className="w-6 h-6 text-[#1e3272] animate-spin" aria-hidden="true" />
            ) : (
              <>
                {/* Inline SVG instead of external <img src="https://google.com/favicon.ico"> —
                    avoids a third-party request on every login page load. */}
                <svg className="w-6 h-6 group-hover:scale-110 transition-transform" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 34.6 26.7 35.5 24 35.5c-5.2 0-9.5-3.1-11.3-7.6l-6.6 5.1C9.4 39.5 16.1 44 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.4-2.3 4.4-4.1 5.8l6.3 5.3C42.2 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.9z"/>
                </svg>
                <span className="text-lg font-bold text-[#1e294b]">Sign in with Google</span>
              </>
            )}
          </button>

          <div className="mt-10 pt-10 border-t border-slate-50 text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-loose">
              Only authorized teachers can access this portal.<br/>Contact administration for access.
            </p>
          </div>
        </div>

        <p className="text-center mt-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          Cloud Architecture • Secure Access
        </p>
      </div>
    </div>
  );
};

export default Login;
