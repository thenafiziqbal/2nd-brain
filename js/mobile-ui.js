// mobile-ui.js — mobile-first UX layer.
//
//   • Hamburger drawer that mirrors the desktop sidebar so every nav item
//     is reachable on phones.
//   • Floating "+" note FAB (one-tap quick-add).
//   • Floating chat-FAB with a hub bottom-sheet (long-press) exposing all
//     chat surfaces (AI / Admin / Community / DMs / Friends / Shared).
//   • PWA install card — appears once per 24h, hides when installed,
//     mirrored as a button inside Settings.
//   • Drag handler so the FABs can be moved anywhere on screen and the
//     position persists across reloads.
import { showSection } from './ui.js';
import { toast } from './toast.js';

const POS_KEY = (id) => `2b.fab.pos.${id}`;
const DISMISS_KEY = '2b.install.dismissedAt';

let deferredInstall = null;

export function initMobileUI(){
  // Capture install prompt — Chrome / Edge fire this once per session.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    refreshInstallState();
    if(!isInstalled() && !recentlyDismissed()) showInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    hideInstallCard();
    refreshInstallState();
    toast('Install successful — Home screen-এ পাবেন', 'success');
  });

  bindDrawer();
  bindNoteFab();
  bindChatHubFab();
  bindInstallCard();
  bindSettingsInstall();
  enableDrag(document.getElementById('chat-fab'));
  enableDrag(document.getElementById('note-fab'));
  document.getElementById('chat-fab')?.addEventListener('click', (e) => {
    const fab = e.currentTarget;
    if(fab.dataset.dragged === '1'){ e.stopImmediatePropagation(); fab.dataset.dragged = ''; }
  }, { capture: true });

  refreshInstallState();
  // Auto-show install card after a short delay if eligible.
  setTimeout(maybeShowInstallCard, 1800);
}

// === Drawer ============================================================

function bindDrawer(){
  const btn = document.getElementById('menu-toggle-btn');
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('drawer-scrim');
  const close = document.getElementById('drawer-close');
  if(!btn || !drawer) return;

  // Mirror the sidebar contents into the drawer once. We deep-clone so
  // existing event delegation in ui.js (data-section) keeps working —
  // every clone retains its data attributes.
  const sync = () => {
    const sidebar = document.querySelector('.sidebar');
    const nav = document.getElementById('drawer-nav');
    if(!sidebar || !nav) return;
    nav.innerHTML = sidebar.innerHTML;
  };
  sync();
  // Re-sync any time a section is shown so .active state stays in sync.
  document.addEventListener('click', (e) => {
    if(e.target.closest('[data-section]')) setTimeout(sync, 50);
  });

  const open = () => {
    sync();
    drawer.classList.add('open');
    scrim.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  const closeFn = () => {
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    document.body.style.overflow = '';
  };
  btn.addEventListener('click', open);
  close?.addEventListener('click', closeFn);
  scrim.addEventListener('click', closeFn);
  drawer.addEventListener('click', (e) => {
    // Drawer is a CLONE of the sidebar, so it doesn't have the per-element
    // click handlers attached in ui.js. We dispatch the section change
    // ourselves via showSection().
    const trigger = e.target.closest('[data-section]');
    if(trigger){
      const section = trigger.dataset.section;
      if(section){
        showSection(section, trigger);
        setTimeout(closeFn, 120);
      }
    }
  });
  // Auto-close when crossing into desktop breakpoint.
  window.addEventListener('resize', () => {
    if(window.innerWidth > 980) closeFn();
  });
}

// === Note FAB ==========================================================

function bindNoteFab(){
  const fab = document.getElementById('note-fab');
  if(!fab) return;
  fab.addEventListener('click', () => {
    if(fab.dataset.dragged === '1'){ fab.dataset.dragged = ''; return; }
    showSection('add');
    setTimeout(() => document.getElementById('note-title')?.focus(), 50);
  });
}

// === Chat hub ==========================================================

function bindChatHubFab(){
  const fab = document.getElementById('chat-fab');
  const hub = document.getElementById('chat-hub');
  if(!fab || !hub) return;
  let pressTimer = null;
  const openHub = () => {
    hub.classList.add('open');
    document.getElementById('chat-panel')?.classList.remove('open');
  };
  const closeHub = () => hub.classList.remove('open');
  fab.addEventListener('contextmenu', (e) => { e.preventDefault(); openHub(); });
  fab.addEventListener('touchstart', () => { pressTimer = setTimeout(openHub, 550); }, { passive: true });
  fab.addEventListener('touchend', () => clearTimeout(pressTimer));
  fab.addEventListener('touchmove', () => clearTimeout(pressTimer));
  hub.addEventListener('click', (e) => {
    const target = e.target.closest('[data-hub-go]');
    if(target){
      const dest = target.dataset.hubGo;
      closeHub();
      if(dest === 'ai' || dest === 'support'){
        document.getElementById('chat-fab')?.click();
        setTimeout(() => document.querySelector(`[data-chat-mode="${dest}"]`)?.click(), 180);
      } else {
        showSection(dest);
      }
    }
    if(e.target.matches('[data-hub-close]') || e.target === hub) closeHub();
  });
}

// === Install card ======================================================

function isInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}
function recentlyDismissed(){
  const last = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() - last < 24 * 60 * 60 * 1000;
}

function bindInstallCard(){
  const card = document.getElementById('install-pill');
  if(!card) return;
  card.querySelector('[data-install-go]')?.addEventListener('click', triggerInstall);
  card.querySelector('[data-install-close]')?.addEventListener('click', () => {
    hideInstallCard();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  });
}

async function triggerInstall(){
  if(deferredInstall){
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if(outcome === 'accepted'){ hideInstallCard(); }
    deferredInstall = null;
    refreshInstallState();
    return;
  }
  // iOS Safari: show toast + persistent hint in Settings.
  if(/iP(hone|ad|od)/.test(navigator.userAgent)){
    toast('iPhone-এ: Share বাটন → "Add to Home Screen" সিলেক্ট করুন', 'info');
  } else {
    toast('Browser-এ install option এখন পাওয়া যাচ্ছে না — পরে আবার চেষ্টা করুন', 'info');
  }
}

function bindSettingsInstall(){
  const btn = document.getElementById('settings-install-btn');
  btn?.addEventListener('click', triggerInstall);
}

function refreshInstallState(){
  const btn = document.getElementById('settings-install-btn');
  const status = document.getElementById('install-status');
  const iosHint = document.getElementById('install-ios-hint');
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

  if(isInstalled()){
    if(btn){ btn.disabled = true; btn.innerHTML = '<svg class="ico"><use href="assets/icons.svg#i-check"/></svg> Installed'; }
    if(status){ status.className = 'install-status success'; status.textContent = '✅ App installed হয়ে আছে — Home screen থেকে launch করুন।'; }
    if(iosHint) iosHint.style.display = 'none';
    hideInstallCard();
    return;
  }

  if(btn){ btn.disabled = false; btn.innerHTML = '<svg class="ico"><use href="assets/icons.svg#i-add"/></svg> Install App'; }
  if(deferredInstall){
    if(status){ status.className = 'install-status info'; status.textContent = '📲 Install করতে নিচের button-এ tap করুন।'; }
    if(iosHint) iosHint.style.display = 'none';
  } else if(isIOS){
    if(status){ status.className = 'install-status warn'; status.textContent = 'iPhone/iPad-এ Safari-র Share menu ব্যবহার করতে হবে।'; }
    if(iosHint) iosHint.style.display = 'block';
  } else {
    if(status){ status.className = 'install-status info'; status.textContent = 'Install option শীঘ্রই appear হবে — কিছুক্ষণ অপেক্ষা করুন।'; }
    if(iosHint) iosHint.style.display = 'none';
  }
}

function maybeShowInstallCard(){
  if(isInstalled()) return;
  if(recentlyDismissed()) return;
  // If the browser hasn't fired beforeinstallprompt yet, still show the
  // card on iOS / Safari so the user can manually install via the Share
  // sheet. On other browsers we wait for the prompt to fire.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  if(deferredInstall || isIOS) showInstallCard();
}

function showInstallCard(){
  if(isInstalled()) return;
  document.getElementById('install-pill')?.classList.add('show');
}
function hideInstallCard(){
  document.getElementById('install-pill')?.classList.remove('show');
}

// === Drag handler ======================================================

function enableDrag(el){
  if(!el) return;
  const id = el.id;
  const saved = parsePos(localStorage.getItem(POS_KEY(id)));
  if(saved){ applyPos(el, saved.x, saved.y); }

  let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0, moved = 0;

  const onDown = (clientX, clientY) => {
    dragging = true; moved = 0;
    startX = clientX; startY = clientY;
    const r = el.getBoundingClientRect();
    baseX = r.left; baseY = r.top;
    el.style.transition = 'none';
  };
  const onMove = (clientX, clientY) => {
    if(!dragging) return;
    const dx = clientX - startX, dy = clientY - startY;
    moved = Math.max(moved, Math.hypot(dx, dy));
    if(moved < 6) return;
    let x = baseX + dx, y = baseY + dy;
    const w = el.offsetWidth, h = el.offsetHeight, m = 6;
    x = Math.max(m, Math.min(window.innerWidth - w - m, x));
    y = Math.max(m, Math.min(window.innerHeight - h - m, y));
    applyPos(el, x, y);
    el.dataset.dragged = '1';
  };
  const onUp = () => {
    if(!dragging) return;
    dragging = false;
    el.style.transition = '';
    if(moved >= 6){
      const r = el.getBoundingClientRect();
      localStorage.setItem(POS_KEY(id), JSON.stringify({ x: r.left, y: r.top }));
      setTimeout(() => { el.dataset.dragged = ''; }, 250);
    }
  };

  el.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onUp);
  el.addEventListener('touchstart', e => { const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchmove', e => { const t = e.touches[0]; if(t) onMove(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchend', onUp);
}

function applyPos(el, x, y){
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.right = 'auto'; el.style.bottom = 'auto';
}

function parsePos(raw){
  try {
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(typeof p?.x !== 'number' || typeof p?.y !== 'number') return null;
    return {
      x: Math.max(0, Math.min(window.innerWidth - 60, p.x)),
      y: Math.max(0, Math.min(window.innerHeight - 60, p.y)),
    };
  } catch(e){ return null; }
}
