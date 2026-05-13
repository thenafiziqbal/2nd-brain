/* sw.js — PWA service worker.
 * Strategy:
 *   - "App shell" (HTML/CSS/JS/icons) — cache-first with background refresh.
 *   - Firestore traffic — never intercepted; the SDK handles its own offline cache.
 *   - Other GET requests — network-first with 2s fallback to cache.
 */
const CACHE = 'sb-shell-v6';
const SHELL = [
  './',
  './index.html',
  './admin/admin.html',
  './manifest.webmanifest',
  './assets/icons.svg',
  './assets/logo.svg',
  './assets/icon-192.png.svg',
  './css/base.css','./css/components.css','./css/auth.css','./css/dashboard.css',
  './css/notes.css','./css/prayer.css','./css/focus.css','./css/syllabus.css',
  './css/chat.css','./css/saas.css','./css/social.css','./css/mobile-ui.css','./css/responsive.css',
  './js/app.js','./js/firebase-init.js','./js/store.js','./js/toast.js','./js/theme.js',
  './js/offline.js','./js/pwa.js','./js/auth.js','./js/notes.js','./js/syllabus.js',
  './js/tasks.js','./js/focus-timer.js','./js/prayer.js','./js/ai.js','./js/chat.js',
  './js/voice.js','./js/ai-questions.js','./js/settings.js','./js/payment.js',
  './js/system-settings.js','./js/ui.js',
  './js/branding.js','./js/community.js','./js/packages.js','./js/quota.js','./js/referral.js',
  './js/notices.js','./js/profile.js',
  './js/admin-features.js','./js/api-usage.js','./js/class-community.js',
  './js/dashboard-previews.js','./js/dm.js','./js/friends.js','./js/leaderboard.js',
  './js/mobile-ui.js','./js/note-share.js','./js/quiz.js','./js/revision-notif.js',
  './js/schools.js','./js/study-tracker.js','./js/quota.js','./js/public-profile.js',
  './js/idb-storage.js','./js/note-images.js','./js/syllabus-ocr.js','./js/tts.js',
  './js/youtube-courses.js','./js/push-notifications.js','./js/onboarding-tour.js',
  './js/question-bank.js',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Don't intercept Firebase/Firestore — let the SDK manage offline.
  if(url.hostname.includes('firestore.googleapis.com')
     || url.hostname.includes('firebaseinstallations.googleapis.com')
     || url.hostname.includes('identitytoolkit.googleapis.com')
     || url.hostname.includes('securetoken.googleapis.com')
     || url.hostname.includes('firebaseio.com')){
    return;
  }

  // Same-origin shell — cache-first.
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(hit => {
        if(hit){
          // Background refresh.
          fetch(req).then(r => caches.open(CACHE).then(c => c.put(req, r))).catch(()=>{});
          return hit;
        }
        return fetch(req).then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return r;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // Cross-origin (fonts, prayer API) — network-first w/ cache fallback.
  event.respondWith(
    fetch(req).then(r => {
      if(r.ok){
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return r;
    }).catch(() => caches.match(req))
  );
});

// Notification click — focus an existing app tab or open a new one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification?.data?.path || '/';
  event.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled: true }).then(list => {
      for(const c of list){
        if(c.url.includes(self.location.origin)){
          c.focus();
          if(path && c.navigate) c.navigate(path).catch(()=>{});
          return;
        }
      }
      return self.clients.openWindow(path);
    })
  );
});

// Server-side Web Push / FCM payload support. This is what allows
// notifications to appear even when no app tab is open, as long as a backend
// sends a push message to the saved subscription/token.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch(e){ data = { title:'Second Brain', body:event.data?.text?.() || '' }; }
  const title = data.title || 'Second Brain';
  const opts = {
    body: data.body || '',
    icon: data.icon || './assets/logo.svg',
    badge: data.badge || './assets/logo.svg',
    tag: data.tag || 'sb-push',
    data: data.data || { path:data.path || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});
