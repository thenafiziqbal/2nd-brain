// note-images.js — handle local image attachments for notes. Images are
// stored only in IndexedDB on the user's device — never uploaded to
// Firestore — so they don't consume the project's database quota.
import { idbPut, idbGet, idbDelete, idbGetAll, blobToObjectUrl, uid as makeUid } from './idb-storage.js';
import { state, esc } from './store.js';
import { toast } from './toast.js';

// In-memory list of pending images for the Add-Note form.
let pending = [];

export function initNoteImages(){
  const input = document.getElementById('note-image-input');
  if(input){
    input.addEventListener('change', async () => {
      for(const f of input.files){
        if(!f.type.startsWith('image/')) continue;
        const id = 'ni-' + makeUid();
        await idbPut('note-images', {
          id, blob: f, type: f.type, name: f.name, ownerUid: state.user?.uid || 'guest',
          createdAt: Date.now(),
        });
        pending.push(id);
      }
      input.value = '';
      paintPreviews();
    });
  }
}

async function paintPreviews(){
  const root = document.getElementById('note-image-previews');
  if(!root) return;
  if(!pending.length){ root.innerHTML = ''; return; }
  const records = await Promise.all(pending.map(id => idbGet('note-images', id)));
  root.innerHTML = records.filter(Boolean).map(r => `
    <div class="note-img-thumb" data-img-id="${esc(r.id)}">
      <img src="${blobToObjectUrl(r.blob)}" alt="${esc(r.name||'image')}"/>
      <button type="button" class="img-x" data-remove-img="${esc(r.id)}">×</button>
    </div>`).join('');
  root.querySelectorAll('[data-remove-img]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.removeImg;
    await idbDelete('note-images', id);
    pending = pending.filter(x => x !== id);
    paintPreviews();
  }));
}

export function getPendingImageIds(){ return [...pending]; }
export function clearPendingImages(){ pending = []; paintPreviews(); }

export async function paintNoteImagesInDetail(imageIds = []){
  const root = document.getElementById('detail-images');
  if(!root) return;
  if(!imageIds || !imageIds.length){ root.innerHTML = ''; return; }
  const records = await Promise.all(imageIds.map(id => idbGet('note-images', id)));
  root.innerHTML = records.filter(Boolean).map(r => `
    <div class="note-img-thumb">
      <img src="${blobToObjectUrl(r.blob)}" alt="${esc(r.name||'image')}"/>
    </div>`).join('') || `<div class="mini-note" style="color:var(--text2);font-size:.78rem">Images saved on another device — not available here.</div>`;
}

export async function getStoredImages(){
  return idbGetAll('note-images');
}
