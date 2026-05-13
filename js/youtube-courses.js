// youtube-courses.js — Section 4: YouTube playlist + video courses.
// Production hardening (vs. the previous version):
//   • Accepts a textarea of mixed URLs (one per line): each becomes a
//     clickable shortcut. Supports playlist URLs, video URLs and bare
//     video IDs.
//   • If admin has configured a YouTube Data API key (system/settings.youtubeApiKey)
//     a playlist URL is expanded into all of its individual videos.
//   • Without the API key, playlist URLs still embed correctly (videoseries),
//     and individual video URLs are listed with their own thumbnails + titles
//     fetched via YouTube's CORS-safe oEmbed endpoint.
//   • Per-video click swaps the iframe to that specific video.
//   • Course list persists per-user in localStorage so the layout works
//     offline after the first fetch.
import { state, esc, icon } from './store.js';
import { toast } from './toast.js';

const KEY = () => `sb-${state.user?.uid || 'guest'}-yt-courses`;
let courses = [];
let active = null;

export function initYoutubeCourses(){
  load();
  document.getElementById('yt-course-add-btn')?.addEventListener('click', addCourse);
  document.getElementById('yt-course-url')?.addEventListener('keydown', e => {
    if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); addCourse(); }
  });
  document.addEventListener('app:auth-change', () => { load(); paintList(); });
  paintList();
}

function load(){
  try { courses = JSON.parse(localStorage.getItem(KEY()) || '[]'); }
  catch(e){ courses = []; }
  // Migrate legacy courses (single playlistId, no items array) to the new
  // shape so openCourse() doesn't crash.
  let migrated = false;
  courses = (courses || []).map(c => {
    if(!c || typeof c !== 'object') return null;
    if(Array.isArray(c.items) && c.items.length) return c;
    if(c.playlistId){
      migrated = true;
      return {
        ...c,
        items: [{
          id: 'pl-' + String(c.playlistId).slice(0, 12),
          type: 'playlist',
          playlistId: c.playlistId,
          videoId: null,
          title: 'Playlist',
          thumb: '',
        }],
      };
    }
    if(c.videoId){
      migrated = true;
      return {
        ...c,
        items: [{
          id: 'v-' + String(c.videoId),
          type: 'video',
          videoId: c.videoId,
          title: c.title || 'Video',
          thumb: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
        }],
      };
    }
    return null;
  }).filter(Boolean);
  if(migrated) save();
}
function save(){ localStorage.setItem(KEY(), JSON.stringify(courses)); }

function extractIds(input){
  const out = { videoId: '', playlistId: '' };
  if(!input) return out;
  const s = input.trim();
  // Bare playlist id (PL..., UU..., FL..., RD...).
  if(/^(PL|UU|FL|RD|OL|LL)[A-Za-z0-9_-]{10,}$/.test(s)) return { ...out, playlistId: s };
  // Bare video id.
  if(/^[A-Za-z0-9_-]{11}$/.test(s) && !s.includes('://')) return { ...out, videoId: s };
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    out.playlistId = u.searchParams.get('list') || '';
    if(u.hostname.includes('youtu.be')) out.videoId = u.pathname.slice(1);
    else out.videoId = u.searchParams.get('v') || '';
    if(!out.videoId && u.pathname.startsWith('/embed/')) out.videoId = u.pathname.slice(7);
    if(!out.videoId && u.pathname.startsWith('/shorts/')) out.videoId = u.pathname.slice(8);
  } catch(e){}
  return out;
}

function youtubeApiKey(){
  return state.appSettings?.youtubeApiKey || '';
}

async function expandPlaylist(playlistId){
  // Returns array of { videoId, title, thumb }.
  const key = youtubeApiKey();
  if(!key) return [];
  const out = [];
  let pageToken = '';
  // Cap to 200 items so a giant playlist never spams API.
  for(let i = 0; i < 4 && out.length < 200; i++){
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', key);
    if(pageToken) url.searchParams.set('pageToken', pageToken);
    let json;
    try { json = await fetch(url).then(r => r.json()); }
    catch(e){ break; }
    if(!json?.items) break;
    for(const it of json.items){
      const sn = it.snippet || {};
      const vid = sn.resourceId?.videoId || '';
      if(!vid) continue;
      const thumb = sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url ||
                    `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      out.push({ videoId: vid, title: sn.title || '', thumb });
    }
    pageToken = json.nextPageToken || '';
    if(!pageToken) break;
  }
  return out;
}

async function oEmbed(url){
  // CORS-safe — YouTube serves oEmbed with permissive headers.
  try {
    const u = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const r = await fetch(u);
    if(!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

async function buildItemsFromUrls(rawText){
  const lines = rawText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items = [];
  for(const line of lines){
    const { videoId, playlistId } = extractIds(line);
    if(playlistId){
      // Always create a "playlist" entry so users can launch the embedded
      // playlist player. If we have an API key, also expand individual
      // videos as siblings.
      items.push({
        id: 'pl-' + playlistId.slice(0, 12) + '-' + Math.random().toString(36).slice(2, 6),
        type: 'playlist', playlistId, videoId: videoId || null,
        title: 'Playlist',
        thumb: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
      });
      const expanded = await expandPlaylist(playlistId);
      expanded.forEach((v, idx) => items.push({
        id: `v-${playlistId.slice(0, 6)}-${idx}-${v.videoId}`,
        type: 'video', videoId: v.videoId, playlistId,
        title: v.title || `Video ${idx + 1}`,
        thumb: v.thumb,
      }));
    } else if(videoId){
      const meta = await oEmbed(`https://youtu.be/${videoId}`);
      items.push({
        id: 'v-' + videoId,
        type: 'video', videoId,
        title: meta?.title || 'Video',
        thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    } else {
      // Unknown — keep as label so user can fix it.
      items.push({ id: 'x-' + Math.random().toString(36).slice(2,8), type: 'unknown', title: line });
    }
  }
  return items;
}

async function addCourse(){
  const titleEl = document.getElementById('yt-course-title');
  const urlEl = document.getElementById('yt-course-url');
  const title = titleEl?.value.trim() || '';
  const raw = urlEl?.value.trim() || '';
  if(!title){ toast('Course এর title দিন','warn'); return; }
  if(!raw){ toast('YouTube playlist বা video link দিন','warn'); return; }
  const btn = document.getElementById('yt-course-add-btn');
  btn?.classList.add('btn-loading');
  let items = [];
  try { items = await buildItemsFromUrls(raw); }
  catch(e){ console.warn('addCourse failed', e); }
  btn?.classList.remove('btn-loading');
  if(!items.length){ toast('Valid YouTube playlist/video link দিন','warn'); return; }
  const valid = items.filter(it => it.type !== 'unknown');
  if(!valid.length){ toast('No valid YouTube link found','warn'); return; }
  courses.unshift({
    id: 'yc-' + Date.now().toString(36),
    title, items: valid, createdAt: Date.now(),
  });
  save();
  if(titleEl) titleEl.value = '';
  if(urlEl) urlEl.value = '';
  paintList();
  toast(`Course added (${valid.length} item${valid.length === 1 ? '' : 's'})`, 'success');
}

function firstThumb(c){
  return c.items?.find(it => it.thumb)?.thumb ||
         (c.items?.[0]?.videoId ? `https://i.ytimg.com/vi/${c.items[0].videoId}/hqdefault.jpg` : '');
}

function paintList(){
  const root = document.getElementById('yt-course-list');
  if(!root) return;
  if(!courses.length){
    root.innerHTML = `<div class="empty-state">${icon('play','xl')}<div class="empty-title">No courses yet</div><div class="empty-text">Paste one or more YouTube playlist / video links (one per line).</div></div>`;
    return;
  }
  root.innerHTML = courses.map(c => {
    const thumb = firstThumb(c);
    const count = c.items?.length || 0;
    return `
    <article class="yt-course-card" data-yt-open="${esc(c.id)}">
      <div class="yt-course-thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy"/>` : ''}
        <span class="yt-course-play">${icon('play','sm')}</span>
      </div>
      <div class="yt-course-meta">
        <div class="yt-course-title">${esc(c.title)}</div>
        <div class="yt-course-sub">${count} item${count === 1 ? '' : 's'}</div>
      </div>
      <button class="btn-icon" data-yt-del="${esc(c.id)}" title="Delete">${icon('trash','sm')}</button>
    </article>`;
  }).join('');
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

function videoEmbedSrc(item){
  if(item.type === 'playlist'){
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(item.playlistId)}&rel=0&modestbranding=1`;
  }
  if(item.type === 'video' && item.videoId){
    const list = item.playlistId ? `&list=${encodeURIComponent(item.playlistId)}` : '';
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.videoId)}?rel=0&modestbranding=1${list}`;
  }
  return '';
}

let activeItemId = null;
function openCourse(id){
  const c = courses.find(x => x.id === id);
  if(!c) return;
  if(!Array.isArray(c.items) || !c.items.length){ toast('This course has no videos','warn'); return; }
  active = c;
  const wrap = document.getElementById('yt-course-player-wrap');
  const frame = document.getElementById('yt-course-player-frame');
  const title = document.getElementById('yt-course-player-title');
  const list = document.getElementById('yt-course-player-list');
  if(!wrap || !frame || !title || !list) return;
  wrap.style.display = 'block';
  title.textContent = c.title;

  // Prefer a video item as the initial selection so playback starts immediately.
  const first = c.items.find(it => it.type === 'video') || c.items[0];
  playItem(first);

  // Side rail: per-item shortcut grid.
  list.innerHTML = `
    <div class="yt-playlist-grid">
      ${c.items.map(it => `
        <div class="yt-playlist-card${it.id === activeItemId ? ' active' : ''}" data-yt-item="${esc(it.id)}">
          ${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy"/>` : ''}
          <div class="yt-playlist-meta">
            <div class="yt-playlist-title">${esc(it.title || '')}</div>
            <div class="yt-playlist-sub">${esc(it.type === 'playlist' ? 'Full playlist' : (it.type === 'unknown' ? 'Unknown' : 'Video'))}</div>
          </div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener"
        href="${c.items[0]?.playlistId
          ? 'https://www.youtube.com/playlist?list=' + encodeURIComponent(c.items[0].playlistId)
          : 'https://www.youtube.com/'}">Open on YouTube</a>
      <button class="btn btn-danger btn-sm" id="yt-course-close">Close</button>
    </div>`;
  list.querySelectorAll('[data-yt-item]').forEach(card => card.addEventListener('click', () => {
    const item = c.items.find(x => x.id === card.dataset.ytItem);
    if(!item) return;
    activeItemId = item.id;
    list.querySelectorAll('.yt-playlist-card').forEach(x => x.classList.toggle('active', x === card));
    playItem(item);
  }));
  document.getElementById('yt-course-close')?.addEventListener('click', closePlayer);
  wrap.scrollIntoView({ behavior:'smooth', block:'start' });
}

function playItem(item){
  if(!item) return;
  const frame = document.getElementById('yt-course-player-frame');
  if(!frame) return;
  activeItemId = item.id;
  const src = videoEmbedSrc(item);
  if(!src){
    frame.innerHTML = `<div class="empty-state" style="padding:20px">Item invalid: ${esc(item.title || '')}</div>`;
    return;
  }
  // The escaped attributes prevent any user-supplied title from breaking out.
  frame.innerHTML = `<iframe
    src="${src}"
    title="${esc(item.title || 'YouTube video')}"
    loading="lazy"
    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen></iframe>`;
}

function closePlayer(){
  active = null;
  activeItemId = null;
  const wrap = document.getElementById('yt-course-player-wrap');
  const frame = document.getElementById('yt-course-player-frame');
  if(frame) frame.innerHTML = '';
  if(wrap) wrap.style.display = 'none';
}
