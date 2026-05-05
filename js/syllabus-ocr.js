// syllabus-ocr.js — OCR uploaded syllabus PDFs/images using Gemini Vision
// and import the extracted chapter list into the user's syllabus.
//
// Privacy: the source file itself is stored ONLY in the device's IndexedDB
// (via idb-storage). Only OCR-derived text (small) gets pushed into the
// user's local syllabus state.
import { state, esc, icon, uid as makeUid } from './store.js';
import { idbPut, idbGetAll, idbDelete, blobToObjectUrl } from './idb-storage.js';
import { addSyllabusTopic } from './syllabus.js';
import { geminiVision } from './ai.js';
import { toast } from './toast.js';

let lastResult = null;

export function initSyllabusOcr(){
  document.getElementById('syllabus-ocr-run-btn')?.addEventListener('click', runOcr);
  paintFileList();
}

async function runOcr(){
  const fileInput = document.getElementById('syllabus-ocr-file');
  const subjectInput = document.getElementById('syllabus-ocr-subject');
  const status = document.getElementById('syllabus-ocr-status');
  const result = document.getElementById('syllabus-ocr-result');
  const f = fileInput?.files?.[0];
  const subject = subjectInput?.value.trim() || 'General';
  if(!f){ toast('Image বা PDF select করুন','warn'); return; }
  if(!state.apiKeys?.gemini){
    toast('Gemini API key দিন (Settings)','warn'); return;
  }
  if(f.type === 'application/pdf'){
    // Browser-side PDF rendering is heavy; ask the user to provide images
    // for now so we don't pull in pdfjs at runtime.
    toast('PDF এর প্রতিটি page এর image upload করুন (PDF parsing browser-এ ভারি)','warn');
  }

  status.textContent = '⏳ Saving file locally + extracting chapters...';
  result.innerHTML = '';
  try {
    // 1) Persist the original file in IndexedDB so it survives reload.
    const id = 'sf-' + makeUid();
    await idbPut('syllabus-files', {
      id, blob: f, type: f.type, name: f.name,
      subject, ownerUid: state.user?.uid || 'guest',
      createdAt: Date.now(),
    });

    // 2) Convert to base64 (sliced data URL) for the Gemini Vision call.
    const base64 = await blobToBase64(f);
    const prompt = `You are an OCR assistant. Read the attached syllabus image carefully and produce a STRICT JSON response with this exact schema, no markdown, no commentary:
{"subject":"<best guess>","chapters":[{"chapter":"<chapter title>","topics":["<sub-topic>", ...]}]}
Detect Bangla and English text. Skip page numbers and irrelevant headers. Return at most 50 chapters.`;
    const reply = await geminiVision({
      base64,
      mime: f.type.startsWith('image/') ? f.type : 'image/jpeg',
      prompt,
    });
    let parsed = null;
    try {
      const m = reply.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : reply);
    } catch(e){ parsed = null; }
    if(!parsed || !Array.isArray(parsed.chapters)){
      status.textContent = 'AI did not return a parseable chapter list. Raw text:';
      result.innerHTML = `<pre class="syllabus-ocr-pre">${esc(reply)}</pre>`;
      return;
    }
    parsed.subject = parsed.subject || subject;
    lastResult = parsed;

    // Persist OCR text on the file record so we can re-import later.
    await idbPut('syllabus-files', {
      id, blob: f, type: f.type, name: f.name,
      subject: parsed.subject, ocr: parsed,
      ownerUid: state.user?.uid || 'guest',
      createdAt: Date.now(),
    });

    paintResult(parsed);
    paintFileList();
    status.textContent = `✓ ${parsed.chapters.length} chapters extracted. Click "Import all" or pick individually.`;
  } catch(e){
    status.textContent = '';
    result.innerHTML = `<div class="ai-response" style="color:var(--danger)">${icon('warning','sm')} ${esc(e.message)}</div>`;
  }
}

function paintResult(parsed){
  const result = document.getElementById('syllabus-ocr-result');
  if(!result) return;
  const { subject, chapters } = parsed;
  result.innerHTML = `
    <div class="syllabus-ocr-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong>${esc(subject || 'Subject')}</strong>
        <button class="btn btn-success btn-sm" id="syllabus-ocr-import-all">Import all</button>
      </div>
      <ol class="syllabus-ocr-list">
        ${chapters.map((c, i) => `
          <li>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" data-ch-idx="${i}" checked/>
              <strong>${esc(c.chapter || '')}</strong>
            </label>
            ${(c.topics && c.topics.length)
              ? `<ul style="margin:2px 0 6px 18px;font-size:.82rem;color:var(--text2)">${c.topics.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
              : ''}
          </li>`).join('')}
      </ol>
      <button class="btn btn-primary btn-sm" id="syllabus-ocr-import-selected">Import selected</button>
    </div>`;
  document.getElementById('syllabus-ocr-import-all')?.addEventListener('click', () => importChapters(parsed.chapters, subject));
  document.getElementById('syllabus-ocr-import-selected')?.addEventListener('click', () => {
    const idxs = Array.from(result.querySelectorAll('input[data-ch-idx]:checked')).map(b => parseInt(b.dataset.chIdx, 10));
    const picks = idxs.map(i => parsed.chapters[i]).filter(Boolean);
    importChapters(picks, subject);
  });
}

function importChapters(chapters, subject){
  if(!chapters.length){ toast('কোনো chapter select হয়নি','warn'); return; }
  let added = 0;
  chapters.forEach(c => {
    addSyllabusTopic({
      subject,
      topic: c.chapter,
      note: (c.topics || []).join(', '),
    });
    added++;
  });
  toast(`${added} chapter imported`, 'success');
}

async function paintFileList(){
  const root = document.getElementById('syllabus-files-list');
  if(!root) return;
  const all = await idbGetAll('syllabus-files');
  const mine = all.filter(f => !f.ownerUid || f.ownerUid === (state.user?.uid || 'guest'));
  if(!mine.length){
    root.innerHTML = `<div class="mini-note" style="color:var(--text2);font-size:.78rem">No files saved yet</div>`;
    return;
  }
  root.innerHTML = mine.map(f => {
    const url = f.blob ? blobToObjectUrl(f.blob) : '';
    const isImg = f.type?.startsWith('image/');
    const preview = isImg ? `<img src="${url}" alt="${esc(f.name||'file')}" style="width:48px;height:48px;object-fit:cover;border-radius:6px"/>`
                          : `<div style="width:48px;height:48px;border-radius:6px;background:var(--surface2);display:grid;place-items:center;font-size:.7rem">PDF</div>`;
    return `<div class="syllabus-file-row">
      ${preview}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">${esc(f.name || 'file')}</div>
        <div style="font-size:.74rem;color:var(--text2)">${esc(f.subject || 'subject')} • ${(f.ocr?.chapters?.length || 0)} chapters</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-syllabus-file-import="${esc(f.id)}">Re-import</button>
      <button class="btn btn-danger btn-sm" data-syllabus-file-del="${esc(f.id)}">Delete</button>
    </div>`;
  }).join('');
  root.querySelectorAll('[data-syllabus-file-del]').forEach(b => b.addEventListener('click', async () => {
    await idbDelete('syllabus-files', b.dataset.syllabusFileDel);
    paintFileList();
  }));
  root.querySelectorAll('[data-syllabus-file-import]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.syllabusFileImport;
    const file = mine.find(x => x.id === id);
    if(file?.ocr?.chapters) importChapters(file.ocr.chapters, file.subject || 'General');
    else toast('No OCR data found — re-run extraction','warn');
  }));
}

function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i+1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
