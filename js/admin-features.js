// admin-features.js — paints the dashboard "More Features" grid using
// admin-defined entries from /admin_features plus a curated set of
// built-in extras (Refer & Earn, Subscribe, Help, etc.).
//
// Each admin-defined feature looks like:
//   {
//     id, title, sub, icon (icon-id from icons.svg), badge: 'hot'|'new'|'upcoming'|null,
//     type: 'section'|'link'|'embed',
//     section?: '<view-id>'  // for type=section
//     url?: '<https://...>'  // for type=link
//     html?: '<custom html>' // for type=embed
//     order, active
//   }
import {
  db, collection, query, where, orderBy, onSnapshot
} from './firebase-init.js';
import { esc } from './store.js';
import { showSection } from './ui.js';

let unsub = null;
let adminFeatures = [];

const BUILTIN = [
  { id:'b-refer', title:'Refer & Earn', sub:'Friend invite করে free month জিতুন', icon:'i-gift', type:'section', section:'refer', badge:null },
  { id:'b-subscribe', title:'Subscribe', sub:'Premium plan দেখুন', icon:'i-credit', type:'section', section:'payment', badge:null },
  { id:'b-community', title:'Community', sub:'App-এর সাথে join করুন', icon:'i-users', type:'section', section:'community', badge:null },
  { id:'b-help', title:'Help & Support', sub:'FAQ + admin chat', icon:'i-help', type:'section', section:'help', badge:null },
  { id:'b-quiz', title:'Quizzes', sub:'Active monthly campaigns', icon:'i-sparkles', type:'section', section:'quiz', badge:'hot' },
  { id:'b-leaderboard', title:'Leaderboard', sub:'Class এর top ranker দেখুন', icon:'i-flame', type:'section', section:'leaderboard', badge:null },
  { id:'b-shared', title:'Shared Notes', sub:'Friend-এর share করা note', icon:'i-share', type:'section', section:'shared-notes', badge:null },
];

export function initAdminFeatures(){
  bindFeatureModal();
  // Public read of admin_features.
  try {
    const q = query(
      collection(db, 'admin_features'),
      where('active', '==', true),
      orderBy('order', 'asc'),
    );
    unsub = onSnapshot(q, snap => {
      adminFeatures = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      paint();
    }, () => paint());
  } catch(e){ paint(); }
  paint();
}

function paint(){
  const root = document.getElementById('feature-grid');
  if(!root) return;
  const all = [...BUILTIN, ...adminFeatures];
  root.innerHTML = all.map(f => {
    const badge = f.badge ? `<span class="feature-badge ${f.badge}">${f.badge}</span>` : '';
    const iconId = f.icon || 'i-sparkles';
    const iconHtml = f.iconLink
      ? `<img src="${esc(f.iconLink)}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="icon"/>`
      : `<svg class="ico"><use href="assets/icons.svg#${esc(iconId)}"/></svg>`;
    return `
      <button class="feature-tile" data-feature-id="${esc(f.id)}">
        ${badge}
        <div class="feature-tile-icon">${iconHtml}</div>
        <div class="feature-tile-title">${esc(f.title || 'Feature')}</div>
        <div class="feature-tile-sub">${esc(f.sub || '')}</div>
      </button>
    `;
  }).join('');
  root.querySelectorAll('[data-feature-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.featureId;
      const feat = all.find(x => x.id === id);
      if(feat) launch(feat);
    });
  });
}

function launch(feat){
  const type = feat.type || (feat.section ? 'section' : feat.url ? 'link' : 'embed');
  if(type === 'section' && feat.section){
    showSection(feat.section);
    return;
  }
  if(type === 'link' && feat.url){
    window.open(feat.url, '_blank', 'noopener');
    return;
  }
  if(type === 'embed' && feat.html){
    openEmbedModal(feat);
    return;
  }
  if(feat.url){ window.open(feat.url, '_blank', 'noopener'); }
}

function openEmbedModal(feat){
  const m = document.getElementById('feature-modal');
  const title = document.getElementById('feature-modal-title');
  const body = document.getElementById('feature-modal-body');
  if(!m || !body) return;
  title.textContent = feat.title || 'Feature';
  // Render admin-supplied HTML inside an isolated iframe-like sandbox.
  // We use srcdoc on an iframe to fully sandbox script execution so a
  // misbehaving custom feature can't access app state.
  body.innerHTML = `<iframe class="feature-embed-frame"
    sandbox="allow-scripts allow-forms allow-popups"
    style="width:100%;min-height:60vh;border:0;border-radius:10px;background:#fff"
    srcdoc="${esc(feat.html)}"></iframe>`;
  m.classList.add('open');
}

function bindFeatureModal(){
  // Modal close handled by global modal-close delegate already.
}
