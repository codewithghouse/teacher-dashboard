import React from 'react';
import { useAuth } from '../lib/AuthContext';
import { GraduationCap, Loader2, AlertCircle } from 'lucide-react';

const Login = () => {
  const { loginWithGoogle, loading, error } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        alert("Login failed. Please try again.");
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
          <h1 className="text-4xl font-black text-[#1e294b] tracking-tight mb-2">EduIntellect</h1>
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
            className="w-full h-16 bg-white border-2 border-slate-100 rounded-2xl flex items-center justify-center gap-4 hover:bg-slate-50 hover:border-slate-200 transition-all duration-300 group disabled:opacity-50"
          >
            {isLoggingIn ? (
              <Loader2 className="w-6 h-6 text-[#1e3272] animate-spin" />
            ) : (
              <>
                <img src="https://www.google.com/favicon.ico" alt="Google" className="w-6 h-6 group-hover:scale-110 transition-transform" />
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
