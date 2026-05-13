// system-settings.js — pulls global app settings + feature flags from Firestore.
// Subscribes via onSnapshot so any change in the admin panel ripples to every
// connected user instantly.
//
// Watches:
//   /system/settings        — appName, appTagline, feature flags, prompts (PUBLIC, no secrets)
//   /system_client/keys     — imgbb + YouTube Data API key (signed-in users only)
//   /system/free_tier       — features+limits when no plan/trial
//   /system/trial_package   — trial duration + features
//   /system/payment_methods — { items: [{id,name,number,link,instructions,enabled}] }
//   /system/community       — { items: [{name,url,platform}] }
//   /system/social          — { items: [{platform,url}] }
import { db, doc, onSnapshot } from './firebase-init.js';
import { state, emit, on } from './store.js';
import { paintCommunity, paintFooter } from './community.js';

let publicSettings = {};
let clientKeys = {};
let unsubClientKeys = null;

function mergeAndEmit(){
  const merged = { ...publicSettings, ...clientKeys };
  state.appSettings = merged;
  state.features = merged.features || {};
  applyFeatureFlags();
  applySeoMeta(merged);
  applyDashboardBanner(merged.dashboardBanner || {});
  applyInstallLink(merged);
  emit('system-settings', merged);
}

export function watchSystemSettings(){
  const unsubs = [];

  unsubs.push(onSnapshot(doc(db,'system','settings'), snap => {
    publicSettings = snap.exists() ? snap.data() : {};
    mergeAndEmit();
  }, err => console.warn('system settings watch failed', err)));

  // Once a user is authenticated, subscribe to /system_client/keys to pick up
  // imgbbKey + youtubeApiKey that admins now store outside the public doc.
  on('auth-ready', () => {
    // Always tear down any previous (possibly dead) listener before
    // re-subscribing so a sign-out → sign-in cycle gets fresh data.
    if(unsubClientKeys){ try { unsubClientKeys(); } catch(e){} unsubClientKeys = null; }
    try {
      unsubClientKeys = onSnapshot(doc(db,'system_client','keys'), snap => {
        clientKeys = snap.exists() ? snap.data() : {};
        mergeAndEmit();
      }, err => { /* permission errors after sign-out — ignore */ });
    } catch(e){ /* ignore */ }
  });

  // On sign-out, drop the listener and clear cached keys so they aren't
  // leaked into a different user's session.
  on('auth-signed-out', () => {
    if(unsubClientKeys){ try { unsubClientKeys(); } catch(e){} unsubClientKeys = null; }
    clientKeys = {};
    mergeAndEmit();
  });

  unsubs.push(onSnapshot(doc(db,'system','free_tier'), snap => {
    state.freeTier = snap.exists() ? snap.data() : null;
    emit('free-tier', state.freeTier);
  }));

  unsubs.push(onSnapshot(doc(db,'system','trial_package'), snap => {
    state.trialPackage = snap.exists() ? snap.data() : null;
    emit('trial-package', state.trialPackage);
  }));

  unsubs.push(onSnapshot(doc(db,'system','payment_methods'), snap => {
    state.paymentMethods = snap.exists() ? (snap.data().items || []) : [];
    emit('payment-methods', state.paymentMethods);
  }));

  unsubs.push(onSnapshot(doc(db,'system','community'), snap => {
    state.community = snap.exists() ? (snap.data().items || []) : [];
    paintCommunity();
    paintFooter();
    emit('community', state.community);
  }));

  unsubs.push(onSnapshot(doc(db,'system','social'), snap => {
    state.social = snap.exists() ? (snap.data().items || []) : [];
    paintFooter();
    emit('social', state.social);
  }));

  return () => {
    unsubs.forEach(u => u && u());
    if(unsubClientKeys){ unsubClientKeys(); unsubClientKeys = null; }
  };
}

function applyFeatureFlags(){
  const f = state.features;
  // Hide nav items / sections whose flags are explicitly false.
  Object.entries(f).forEach(([key, on]) => {
    document.querySelectorAll(`[data-feature="${key}"]`).forEach(el => {
      el.style.display = on === false ? 'none' : '';
    });
  });
}

// Section 5 — apply admin-controlled SEO tags to the live document.
function applySeoMeta(d){
  if(!d) return;
  if(d.seoTitle){ document.title = d.seoTitle; }
  setMeta('name','description', d.seoDescription || '');
  setMeta('name','keywords', d.seoKeywords || '');
  setMeta('property','og:title', d.seoTitle || '');
  setMeta('property','og:description', d.seoDescription || '');
  if(d.seoOgImage) setMeta('property','og:image', d.seoOgImage);
}
function setMeta(attr, name, value){
  if(!value) return;
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if(!el){
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function applyDashboardBanner(b){
  const root = document.getElementById('dashboard-banner');
  if(!root) return;
  const enabled = b?.enabled !== false && (b?.title || b?.body || b?.imageUrl);
  root.style.display = enabled ? '' : 'none';
  if(!enabled) return;
  const kicker = document.getElementById('dashboard-banner-kicker');
  const title = document.getElementById('dashboard-banner-title');
  const body = document.getElementById('dashboard-banner-body');
  const link = document.getElementById('dashboard-banner-link');
  const img = document.getElementById('dashboard-banner-image');
  if(kicker) kicker.textContent = b.kicker || '';
  if(title) title.textContent = b.title || 'Welcome';
  if(body) body.textContent = b.body || '';
  root.style.minHeight = b.height ? `${Math.max(110, Number(b.height) || 180)}px` : '';
  root.style.background = b.bg || '';
  if(link){
    if(b.linkUrl){
      link.href = b.linkUrl;
      link.textContent = b.linkLabel || 'Open';
      link.style.display = '';
    } else {
      link.style.display = 'none';
    }
  }
  if(img){
    if(b.imageUrl){
      img.src = b.imageUrl;
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }
}

function applyInstallLink(d){
  const link = document.getElementById('settings-custom-app-link');
  if(!link) return;
  if(d.customAppLink){
    link.href = d.customAppLink;
    link.textContent = d.customAppLinkLabel || 'Download app file';
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }
}
