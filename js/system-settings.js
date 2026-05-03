// system-settings.js — pulls global app settings + feature flags from Firestore.
// Subscribes via onSnapshot so any change in the admin panel ripples to every
// connected user instantly.
//
// Watches:
//   /system/settings        — appName, appTagline, feature flags, prompts, groqKey
//   /system/free_tier       — features+limits when no plan/trial
//   /system/trial_package   — trial duration + features
//   /system/payment_methods — { items: [{id,name,number,link,instructions,enabled}] }
//   /system/community       — { items: [{name,url,platform}] }
//   /system/social          — { items: [{platform,url}] }
import { db, doc, onSnapshot } from './firebase-init.js';
import { state, emit } from './store.js';
import { paintCommunity, paintFooter } from './community.js';

export function watchSystemSettings(){
  const unsubs = [];

  unsubs.push(onSnapshot(doc(db,'system','settings'), snap => {
    const d = snap.exists() ? snap.data() : {};
    state.appSettings = d;
    state.features = d.features || {};
    applyFeatureFlags();
    emit('system-settings', d);
  }, err => console.warn('system settings watch failed', err)));

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

  return () => unsubs.forEach(u => u && u());
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
