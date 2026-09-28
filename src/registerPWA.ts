// High Performance PWA Service Worker Registration & Lifecycle
export function registerPWA() {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/'
        });
        console.log('[PWA] Service Worker registered with scope:', registration.scope);
      } catch (err) {
        console.warn('[PWA] Service Worker registration failed (normal in restricted sandbox):', err);
      }
    });
  }
}
