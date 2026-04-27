import { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyUpdate } from '@/registerSW';

export function PWAUpdatePrompt() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setReg((e as CustomEvent).detail);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);

  if (!reg || import.meta.env.DEV) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1e3272]/10 flex items-center justify-center shrink-0">
          <RefreshCw className="w-5 h-5 text-[#1e3272]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 leading-tight">Update available</p>
          <p className="text-xs text-slate-500 mt-0.5">Reload to get the latest version</p>
        </div>
        <button
          onClick={() => applyUpdate(reg)}
          className="flex items-center gap-1.5 bg-[#1e3272] text-white text-xs font-bold px-3 py-2 rounded-xl shrink-0 hover:bg-[#15234d] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reload
        </button>
        <button
          onClick={() => setReg(null)}
          className="text-slate-300 hover:text-slate-500 transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
