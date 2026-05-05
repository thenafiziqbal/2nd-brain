// branding.js — applies live branding (app name, tagline, logo, favicon)
// from /system/branding (admin-controlled) to both user and admin panels.
import { db, doc, onSnapshot } from './firebase-init.js';
import { state, emit } from './store.js';

export function watchBranding(){
  const ref = doc(db, 'system', 'branding');
  return onSnapshot(ref, snap => {
    const d = snap.exists() ? snap.data() : {};
    state.branding = d || {};
    apply(d);
    emit('branding', d);
  }, err => console.warn('branding watch failed', err));
}

function apply(d = {}){
  // App name → page title + every [data-app-name] node.
  const name = d.appName || 'Second Brain';
  document.title = name;
  document.querySelectorAll('[data-app-name],#brand-app-name,#app-name-header').forEach(el => {
    el.textContent = name;
  });

  // Tagline → every [data-app-tagline] node.
  const tagline = d.appTagline || '';
  document.querySelectorAll('[data-app-tagline],#brand-tagline').forEach(el => {
    if(tagline) el.textContent = tagline;
  });

  // Logo image (if provided) → swap the SVG icon for an <img>.
  if(d.logoUrl){
    document.querySelectorAll('[data-brand-logo]').forEach(el => {
      el.innerHTML = `<img src="${escapeAttr(d.logoUrl)}" alt="${escapeAttr(name)}" style="width:100%;height:100%;object-fit:contain"/>`;
    });
  }

  // Favicon — replace the <link rel=icon> href.
  if(d.faviconUrl){
    const link = document.querySelector('link[rel="icon"]') || (() => {
      const l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); return l;
    })();
    link.href = d.faviconUrl;
  }
}

function escapeAttr(s){
  return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
