/**
 * Platform / runtime helpers for PWA-specific behaviour.
 * iOS Safari (standalone) blocks signInWithPopup, mishandles position:fixed
 * during keyboard focus, and never fires `beforeinstallprompt`. We branch
 * on these helpers wherever those quirks matter.
 */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac — disambiguate via touch points.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Android / desktop PWA
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS PWA flag
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

/** iOS PWA installed to home screen — popup auth is blocked here. */
export function isIOSStandalone(): boolean {
  return isIOS() && isStandalone();
}
