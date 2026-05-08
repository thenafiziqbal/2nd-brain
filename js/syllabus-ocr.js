// syllabus-ocr.js — OCR uploaded syllabus PDFs/images using Gemini Vision
// and import the extracted chapter list into the user's syllabus.
//
// Privacy: the source file itself is stored ONLY in the device's IndexedDB
// (via idb-storage). Only OCR-derived text (small) gets pushed into the
// user's local syllabus state.
//
// PDF support: rendered page-by-page on the client via pdf.js (lazy loaded
// from Mozilla CDN). Each page is rasterised to a JPEG dataURL, fed to
// Gemini Vision, and the chapter lists are merged.
import { state, esc, icon, uid as makeUid } from './store.js';
import { idbPut, idbGetAll, idbDelete, blobToObjectUrl } from './idb-storage.js';
import { addSyllabusTopic } from './syllabus.js';
import { geminiVision } from './ai.js';
import { toast } from './toast.js';

const PDFJS_SRC  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';
const PDFJS_WORK = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
let pdfjsPromise = null;

let lastResult = null;

export function initSyllabusOcr(){
  document.getElementById('syllabus-ocr-run-btn')?.addEventListener('click', runOcr);
  paintFileList();
}

async function loadPdfJs(){
  if(pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const mod = await import(/* @vite-ignore */ PDFJS_SRC);
    if(mod?.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = PDFJS_WORK;
    return mod;
  })().catch(err => { pdfjsPromise = null; throw err; });
  return pdfjsPromise;
}

async function pdfToImageDataUrls(file, maxPages = 12){
  const buf = await file.arrayBuffer();
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const out = [];
  const total = Math.min(pdf.numPages, maxPages);
  for(let p = 1; p <= total; p++){
    const page = await pdf.getPage(p);
    // Render at 1.6x for legible text without massive payload.
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.85));
    page.cleanup?.();
  }
  return { dataUrls: out, totalPages: pdf.numPages };
}

function dataUrlToBase64(s){
  const i = s.indexOf(',');
  return i >= 0 ? s.slice(i + 1) : s;
}

const OCR_PROMPT = `You are an OCR + structuring assistant. Read the attached syllabus page carefully and produce a STRICT JSON response with this exact schema, NO markdown, NO commentary:
{"subject":"<best guess>","chapters":[{"chapter":"<chapter title>","topics":["<sub-topic>", ...]}]}
- Detect Bangla and English text.
- Skip page numbers, running headers/footers and irrelevant decorations.
- Group sub-topics under their parent chapter.
- Return at most 80 chapters total. Keep "topics" short (3-12 words each).`;

async function ocrImageBase64(base64, mime){
  const reply = await geminiVision({ base64, mime: mime || 'image/jpeg', prompt: OCR_PROMPT });
  // Extract JSON object from the model's reply.
  let parsed = null;
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : reply);
  } catch(e){ parsed = null; }
  return { parsed, raw: reply };
}

function mergeOcr(results, fallbackSubject){
  const subject = results.find(r => r.parsed?.subject)?.parsed?.subject || fallbackSubject || 'General';
  const map = new Map();          // normalised chapter title → { chapter, topics:Set }
  for(const r of results){
    const chs = r.parsed?.chapters || [];
    for(const c of chs){
      if(!c?.chapter) continue;
      const key = String(c.chapter).trim().toLowerCase();
      if(!key) continue;
      if(!map.has(key)) map.set(key, { chapter: c.chapter, topics: new Set() });
      const slot = map.get(key);
      (c.topics || []).forEach(t => { if(t && t.trim()) slot.topics.add(t.trim()); });
    }
  }
  const chapters = [...map.values()].map(v => ({ chapter: v.chapter, topics: [...v.topics] }));
  return { subject, chapters };
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

  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  const isImg = (f.type || '').startsWith('image/');
  if(!isPdf && !isImg){ toast('শুধু PDF বা image file accept করি','warn'); return; }

  status.textContent = '⏳ Saving file locally...';
  result.innerHTML = '';

  try {
    // 1) Persist the original file in IndexedDB so it survives reload.
    const id = 'sf-' + makeUid();
    await idbPut('syllabus-files', {
      id, blob: f, type: f.type, name: f.name,
      subject, ownerUid: state.user?.uid || 'guest',
      createdAt: Date.now(),
    });

    // 2) Build list of base64 page images.
    let pageBase64 = []; // { base64, mime }
    let totalPages = 1;
    if(isPdf){
      status.textContent = '⏳ Rendering PDF pages...';
      const { dataUrls, totalPages: tp } = await pdfToImageDataUrls(f, 12);
      totalPages = tp;
      pageBase64 = dataUrls.map(u => ({ base64: dataUrlToBase64(u), mime: 'image/jpeg' }));
      if(tp > 12) toast(`PDF এ ${tp} পেজ — প্রথম 12 টা OCR করা হলো`, 'info');
    } else {
      const base64 = await blobToBase64(f);
      pageBase64 = [{ base64, mime: f.type }];
    }

    // 3) Run Vision per page (sequentially to respect rate limits).
    const ocrResults = [];
    for(let i = 0; i < pageBase64.length; i++){
      status.textContent = `⏳ Extracting chapters (${i + 1}/${pageBase64.length})...`;
      const { parsed, raw } = await ocrImageBase64(pageBase64[i].base64, pageBase64[i].mime);
      ocrResults.push({ parsed, raw });
    }

    // 4) Merge.
    const merged = mergeOcr(ocrResults, subject);
    if(!merged.chapters.length){
      status.textContent = 'AI did not return a parseable chapter list. Raw text from page 1:';
      result.innerHTML = `<pre class="syllabus-ocr-pre">${esc(ocrResults[0]?.raw || '')}</pre>`;
      return;
    }
    lastResult = merged;

    // 5) Persist OCR result.
    await idbPut('syllabus-files', {
      id, blob: f, type: f.type, name: f.name,
      subject: merged.subject, ocr: merged,
      ownerUid: state.user?.uid || 'guest',
      pdfPages: totalPages,
      createdAt: Date.now(),
    });

    paintResult(merged);
    paintFileList();
    status.textContent = `✓ ${merged.chapters.length} chapter${merged.chapters.length === 1 ? '' : 's'} extracted from ${pageBase64.length} page${pageBase64.length === 1 ? '' : 's'}.`;
  } catch(e){
    console.warn('ocr failed', e);
    status.textContent = '';
    result.innerHTML = `<div class="ai-response" style="color:var(--danger)">${icon('warning','sm')} ${esc(e.message || String(e))}</div>`;
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
    const preview = isImg
      ? `<img src="${url}" alt="${esc(f.name||'file')}" style="width:48px;height:48px;object-fit:cover;border-radius:6px"/>`
      : `<div style="width:48px;height:48px;border-radius:6px;background:var(--surface2);display:grid;place-items:center;font-size:.7rem">PDF</div>`;
    return `<div class="syllabus-file-row">
      ${preview}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">${esc(f.name || 'file')}</div>
        <div style="font-size:.74rem;color:var(--text2)">${esc(f.subject || 'subject')} • ${(f.ocr?.chapters?.length || 0)} chapters${f.pdfPages ? ' • ' + f.pdfPages + ' pages' : ''}</div>
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
