// youtube-courses.js — Section 4: paste a YouTube playlist link, get a
// course-style layout. We use the public iframe-embed API so no API key
// or backend call is required. The list of saved courses is stored in
// localStorage (per user) so private playlists (not viewable by us)
// won't break anything — the iframe handles availability itself.
import { state, esc, icon } from './store.js';
import { toast } from './toast.js';

const KEY = () => `sb-${state.user?.uid || 'guest'}-yt-courses`;
let courses = [];
let active = null;

export function initYoutubeCourses(){
  load();
  document.getElementById('yt-course-add-btn')?.addEventListener('click', addCourse);
  document.getElementById('yt-course-url')?.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); addCourse(); }
  });
  // Re-paint when the user logs in (the per-user storage key changes).
  document.addEventListener('app:auth-change', () => { load(); paintList(); });
  paintList();
}

function load(){
  try { courses = JSON.parse(localStorage.getItem(KEY()) || '[]'); }
  catch(e){ courses = []; }
}
function save(){ localStorage.setItem(KEY(), JSON.stringify(courses)); }

function extractPlaylistId(input){
  if(!input) return '';
  const s = input.trim();
  // Already a bare playlist id?
  if(/^[A-Za-z0-9_-]{10,}$/.test(s) && !s.includes('://')) return s;
  try {
    const u = new URL(s);
    return u.searchParams.get('list') || '';
  } catch(e){ return ''; }
}

function addCourse(){
  const title = document.getElementById('yt-course-title')?.value.trim() || '';
  const url = document.getElementById('yt-course-url')?.value.trim() || '';
  const playlistId = extractPlaylistId(url);
  if(!playlistId){ toast('Valid YouTube playlist link দিন (must contain ?list=)', 'warn'); return; }
  if(!title){ toast('Course এর title দিন','warn'); return; }
  courses.unshift({
    id: 'yc-' + Date.now().toString(36),
    title, playlistId, createdAt: Date.now(),
  });
  save();
  document.getElementById('yt-course-title').value = '';
  document.getElementById('yt-course-url').value = '';
  paintList();
  toast('Course added', 'success');
}

function paintList(){
  const root = document.getElementById('yt-course-list');
  if(!root) return;
  if(!courses.length){
    root.innerHTML = `<div class="empty-state">${icon('play','xl')}<div class="empty-title">No courses yet</div><div class="empty-text">Paste a YouTube playlist link to get started.</div></div>`;
    return;
  }
  root.innerHTML = courses.map(c => `
    <article class="yt-course-card" data-yt-open="${esc(c.id)}">
      <div class="yt-course-thumb">
        <img src="https://i.ytimg.com/vi/_/hqdefault.jpg" alt="" data-thumb-list="${esc(c.playlistId)}" loading="lazy"/>
        <span class="yt-course-play">${icon('play','sm')}</span>
      </div>
      <div class="yt-course-meta">
        <div class="yt-course-title">${esc(c.title)}</div>
        <div class="yt-course-sub">Playlist • ${esc(c.playlistId)}</div>
      </div>
      <button class="btn-icon" data-yt-del="${esc(c.id)}" title="Delete">${icon('trash','sm')}</button>
    </article>
  `).join('');
  root.querySelectorAll('[data-yt-open]').forEach(el => el.addEventListener('click', e => {
    if(e.target.closest('[data-yt-del]')) return;
    openCourse(el.dataset.ytOpen);
  }));
  root.querySelectorAll('[data-yt-del]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    courses = courses.filter(c => c.id !== b.dataset.ytDel);
    save();
    paintList();
    if(active && !courses.find(c => c.id === active.id)) closePlayer();
  }));
}

function openCourse(id){
  const c = courses.find(x => x.id === id);
  if(!c) return;
  active = c;
  const wrap = document.getElementById('yt-course-player-wrap');
  const frame = document.getElementById('yt-course-player-frame');
  const title = document.getElementById('yt-course-player-title');
  const list = document.getElementById('yt-course-player-list');
  if(!wrap || !frame || !title || !list) return;
  wrap.style.display = 'block';
  title.textContent = c.title;
  // YouTube embed player playing the playlist (loop=1 keeps autoplay
  // chained between videos). The "list" param drives the side rail.
  frame.innerHTML = `<iframe
    src="https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(c.playlistId)}&rel=0&modestbranding=1"
    title="${esc(c.title)}"
    loading="lazy"
    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen></iframe>`;
  // Side rail: link out to the full playlist + offer "open on YouTube"
  // since the iframe doesn't expose individual videos to JS.
  list.innerHTML = `
    <a class="btn btn-secondary btn-sm btn-block" target="_blank" rel="noopener"
      href="https://www.youtube.com/playlist?list=${encodeURIComponent(c.playlistId)}">Open on YouTube</a>
    <div class="mini-note" style="margin-top:8px;font-size:.78rem;color:var(--text2)">
      The embedded player auto-advances through the playlist. Use the chapter list inside the player to skip.
    </div>
    <button class="btn btn-danger btn-sm btn-block" id="yt-course-close" style="margin-top:8px">Close player</button>`;
  document.getElementById('yt-course-close')?.addEventListener('click', closePlayer);
  wrap.scrollIntoView({ behavior:'smooth', block:'start' });
}

function closePlayer(){
  active = null;
  const wrap = document.getElementById('yt-course-player-wrap');
  const frame = document.getElementById('yt-course-player-frame');
  if(frame) frame.innerHTML = '';
  if(wrap) wrap.style.display = 'none';
}
