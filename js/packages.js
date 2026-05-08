// packages.js — fetches active subscription packages from /packages and
// renders them in the user-facing payment view + the modal selector.
import { db, collection, query, where, orderBy, onSnapshot } from './firebase-init.js';
import { state, esc, icon, emit } from './store.js';

const FEATURE_LABELS = {
  notes:'Notes', revision:'Revision', addNote:'Add Note',
  prayer:'Prayer Times', focus:'Focus Timer',
  syllabus:'Syllabus + AI Questions', tasks:'Tasks',
  aiExplain:'AI Explain', aiChat:'AI Chat',
};

export function watchPackages(){
  // Live list of active subscription packages.
  const q = query(collection(db, 'packages'), where('active','==', true));
  return onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0) || (a.priceNum||0) - (b.priceNum||0));
    state.packages = list;
    paintPackages();
    emit('packages', list);
  }, err => console.warn('packages watch failed', err));
}

export function paintPackages(){
  const root = document.getElementById('package-list');
  if(!root) return;
  if(!state.packages.length){
    root.innerHTML = `<div class="empty-state">${icon('credit','xl')}<div class="empty-title">No packages yet</div><div class="empty-text">Admin Panel থেকে package add করুন</div></div>`;
    return;
  }
  root.innerHTML = state.packages.map(p => packageCard(p)).join('');
  root.querySelectorAll('[data-pick-pkg]').forEach(b => {
    b.addEventListener('click', () => {
      root.querySelectorAll('.pkg-card').forEach(c => c.classList.remove('selected'));
      b.closest('.pkg-card')?.classList.add('selected');
      window.dispatchEvent(new CustomEvent('pkg-picked', { detail: b.dataset.pickPkg }));
    });
  });
}

function packageCard(p){
  const featureBullets = Object.entries(p.features || {})
    .filter(([_, on]) => on !== false)
    .map(([k]) => `<li>${icon('check','sm')} ${esc(FEATURE_LABELS[k] || k)}${(p.limits?.[k]!=null) ? ` <small>(${esc(p.limits[k])} /day)</small>` : ''}</li>`)
    .join('');
  return `
    <div class="pkg-card${p.popular?' popular':''}">
      ${p.popular ? '<div class="pkg-badge">Most popular</div>' : ''}
      <div class="pkg-title">${esc(p.title)}</div>
      <div class="pkg-price">৳ ${esc(p.price)}<small>/${esc(p.duration||'month')}</small></div>
      ${p.description ? `<p class="pkg-desc">${esc(p.description)}</p>` : ''}
      <ul class="pkg-features">${featureBullets || '<li class="mini-note">All core features</li>'}</ul>
      <button class="btn btn-primary btn-block" data-pick-pkg="${esc(p.id)}">${icon('check')} Select this</button>
    </div>`;
}
