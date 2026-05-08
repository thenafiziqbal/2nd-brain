// profile.js — user profile picture (avatar) upload via imgbb.
//
// Flow:
//   1. Admin pastes their imgbb API key in /system/settings.imgbbKey
//      (free tier ~32MB images, no expiry).
//   2. User picks a file in Settings → we POST to api.imgbb.com → store
//      the returned hosted URL on /users/{uid}.photoUrl.
//   3. Header avatar + profile card render the image.
import { state, esc, icon } from './store.js';
import { db, doc, updateDoc } from './firebase-init.js';
import { toast } from './toast.js';

export function initProfile(){
  const file = document.getElementById('profile-file-input');
  const btn  = document.getElementById('profile-pick-btn');
  const remove = document.getElementById('profile-remove-btn');
  if(btn) btn.addEventListener('click', () => file?.click());
  if(file) file.addEventListener('change', uploadAvatar);
  if(remove) remove.addEventListener('click', removeAvatar);
}

export function paintProfileAvatar(){
  const url = state.profile?.photoUrl;
  document.querySelectorAll('[data-user-avatar]').forEach(el => {
    if(url){
      el.innerHTML = `<img src="${esc(url)}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>`;
    }
  });
  const preview = document.getElementById('profile-preview');
  if(preview){
    preview.innerHTML = url
      ? `<img src="${esc(url)}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<div class="profile-fallback">${esc((state.profile?.name||'S').charAt(0).toUpperCase())}</div>`;
  }
}

async function uploadAvatar(e){
  const file = e.target.files?.[0];
  if(!file) return;
  if(!state.user){ toast('Login first','warn'); return; }
  if(file.size > 5 * 1024 * 1024){ toast('Image must be < 5MB','warn'); return; }
  const apiKey = state.appSettings?.imgbbKey;
  if(!apiKey){ toast('Avatar upload needs a secure upload proxy before production','error'); return; }

  const btn = document.getElementById('profile-pick-btn');
  btn?.classList.add('btn-loading');
  try {
    const fd = new FormData();
    fd.append('image', file);
    const r = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', body: fd
    });
    const j = await r.json();
    if(!j.success || !j.data?.url) throw new Error(j.error?.message || 'Upload failed');
    const url = j.data.display_url || j.data.url;
    await updateDoc(doc(db,'users', state.user.uid), { photoUrl: url });
    state.profile.photoUrl = url;
    paintProfileAvatar();
    toast('Photo updated','success');
  } catch(err){
    toast('Upload failed: ' + err.message, 'error');
  } finally {
    btn?.classList.remove('btn-loading');
    e.target.value = '';
  }
}

async function removeAvatar(){
  if(!state.user) return;
  await updateDoc(doc(db,'users', state.user.uid), { photoUrl: null });
  state.profile.photoUrl = null;
  paintProfileAvatar();
  toast('Photo removed','info');
}
