// pwa.js — registers the service worker so the app works offline.
export function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  // Defer registration until after first paint so it doesn't compete with
  // the initial render — mobile devices feel snappier this way.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  });
}
