/**
 * Registers the Edullent Teacher service worker.
 * Dispatches custom events:
 *   'sw-update-available' — a new SW version is waiting
 *   'sw-registered'       — SW registered successfully
 *
 * Registered in ALL environments (prod + dev) so offline works during testing too.
 */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      window.dispatchEvent(new CustomEvent('sw-registered', { detail: reg }));

      // Check for waiting worker (update available on page load)
      if (reg.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
          }
        });
      });
    } catch (err) {
      console.error('[SW] Registration failed:', err);
    }
  });
}

/**
 * Tell the waiting SW to take over immediately, then reload.
 *
 * Robustness:
 * 1. Always wire the controllerchange→reload handler BEFORE messaging the SW
 *    (avoids missing the event if activation is fast).
 * 2. If `reg.waiting` is null (e.g. the new SW already auto-activated), just
 *    reload immediately.
 * 3. 3-second safety timeout: if controllerchange never fires, force-reload anyway.
 */
export function applyUpdate(reg: ServiceWorkerRegistration) {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });

  if (reg.waiting) {
    try {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
      console.warn('[SW] postMessage failed, reloading anyway:', err);
      reload();
      return;
    }
    setTimeout(reload, 3000);
  } else {
    reload();
  }
}
