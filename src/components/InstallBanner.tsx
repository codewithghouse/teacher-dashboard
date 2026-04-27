import { useEffect, useState } from 'react';
import { Download, X, GraduationCap, Share, Plus } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { isIOS, isStandalone } from '@/lib/platform';

const IOS_DISMISSED_KEY = 'edullent_teacher_ios_install_dismissed';

export function InstallBanner() {
  const { isInstallable, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  const [iosShow, setIosShow] = useState(false);
  const [iosExpanded, setIosExpanded] = useState(false);

  // iOS branch: Safari never fires beforeinstallprompt, so we have to show
  // a manual "Share → Add to Home Screen" hint ourselves. Only show when
  // not already installed and the user hasn't dismissed it before.
  useEffect(() => {
    if (!isIOS() || isStandalone()) return;
    try {
      if (localStorage.getItem(IOS_DISMISSED_KEY) === '1') return;
    } catch { /* storage might be blocked in private mode */ }
    setIosShow(true);
  }, []);

  // ── Android / desktop install banner (uses the native prompt) ────────────
  if (isInstallable && !dismissed && !isIOS()) {
    const handleInstall = async () => {
      const outcome = await promptInstall();
      if (outcome === 'accepted') setDismissed(true);
    };

    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="bg-[#1e3272] text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight">Install Edullent Teacher</p>
            <p className="text-xs text-white/60 mt-0.5">Add to home screen for offline access</p>
          </div>
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 bg-white text-[#1e3272] text-xs font-black px-3 py-2 rounded-xl shrink-0 hover:bg-white/90 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-white/40 hover:text-white/80 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── iOS branch — manual instructions (Share → Add to Home Screen) ────────
  if (iosShow) {
    const dismissForever = () => {
      try { localStorage.setItem(IOS_DISMISSED_KEY, '1'); } catch { /* noop */ }
      setIosShow(false);
    };

    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="bg-[#1e3272] text-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">Install on iPhone</p>
              <p className="text-xs text-white/60 mt-0.5">Tap to see how</p>
            </div>
            <button
              onClick={() => setIosExpanded((v) => !v)}
              className="bg-white text-[#1e3272] text-xs font-black px-3 py-2 rounded-xl shrink-0 hover:bg-white/90 transition-colors"
            >
              {iosExpanded ? 'Hide' : 'Show'}
            </button>
            <button
              onClick={dismissForever}
              className="text-white/40 hover:text-white/80 transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {iosExpanded && (
            <div className="px-4 pb-4 pt-1 text-xs text-white/85 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                <span className="flex items-center gap-1.5">Tap the <Share className="w-3.5 h-3.5 inline" /> Share button in Safari</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                <span className="flex items-center gap-1.5">Choose <Plus className="w-3.5 h-3.5 inline" /> "Add to Home Screen"</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                <span>Tap "Add" — done!</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
