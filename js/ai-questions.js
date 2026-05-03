// ai-questions.js — syllabus-aware AI question generator with a SHARED cache.
//
// User-requested behaviour:
//   "একবার একটা ক্লাসে এর কোন বিষয়ে কোন অধ্যায়ের উপরে প্রশ্ন তৈরি করলে
//    পরের বারে অন্য কোন স্টুডেন্ট যদি সেম অধ্যায়ে প্রস্ন বানাতে চায় তাইলে
//    বানাই দিবে না বরং আগে থেকে বানিয়ে রাখা প্রশ্ন গুলো দিবে। যদি আবার
//    নতুন জেনারেট বাটনে ক্লিক করে তখন নতুন আকারে প্রশ্ন বানাবে।"
//
// Implementation:
//   - Cache key   = `${classLevel}__${subject}__${chapter}` (lower, slug)
//   - Stored in   = collection 'syllabus_questions' (shared globally)
//   - Each doc    = { class, subject, chapter, revisions:[{questions, generatedBy, generatedAt}] }
//   - Default     = show latest revision (cache hit)
//   - "Generate New" = force a fresh AI call → append a new revision
import { state, esc, icon } from './store.js';
import {
  db, doc, getDoc, setDoc, serverTimestamp, updateDoc
} from './firebase-init.js';
import { aiChat } from './ai.js';
import { toast } from './toast.js';

let activeChapter = null;

export function initAIQuestions(){
  document.getElementById('ai-q-generate-btn')?.addEventListener('click', () => generate(false));
  document.getElementById('ai-q-regenerate-btn')?.addEventListener('click', () => generate(true));
}

export function setActiveChapter(chapter){
  activeChapter = chapter;
  paintChapterTitle();
  showCacheStatus();
}

async function showCacheStatus(){
  const tag = document.getElementById('ai-q-cache-tag');
  if(!tag) return;
  if(!activeChapter){ tag.style.display = 'none'; return; }
  tag.style.display = 'none';
  try {
    const snap = await getDoc(cacheRef());
    if(snap.exists()){
      const d = snap.data();
      const count = d.revisions?.length || 0;
      tag.style.display = 'inline-flex';
      tag.innerHTML = `${icon('cache','sm')} Cache hit (${count} revision${count>1?'s':''})`;
    }
  } catch(e){ /* offline ok */ }
}

function paintChapterTitle(){
  const t = document.getElementById('ai-q-chapter-title');
  if(!t) return;
  t.textContent = activeChapter
    ? `${activeChapter.subject} — ${activeChapter.chapter}`
    : 'Select a chapter';
}

function cacheKey(){
  if(!activeChapter) return null;
  const cls = state.profile?.classLevel || 'unknown';
  return slug(`${cls}__${activeChapter.subject}__${activeChapter.chapter}`);
}
function cacheRef(){
  return doc(db, 'syllabus_questions', cacheKey());
}
function slug(s){
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff]+/g,'-')
    .replace(/^-|-$/g,'') || 'unknown';
}

export async function generate(forceFresh){
  if(!activeChapter){ toast('Chapter select করুন','warn'); return; }
  if(!state.user){ toast('Login first','warn'); return; }

  const root = document.getElementById('ai-q-list');
  const btnA = document.getElementById('ai-q-generate-btn');
  const btnB = document.getElementById('ai-q-regenerate-btn');

  // Try cache first unless the user explicitly asked for a fresh batch.
  if(!forceFresh){
    try {
      const snap = await getDoc(cacheRef());
      if(snap.exists()){
        const d = snap.data();
        const latest = d.revisions?.[d.revisions.length - 1];
        if(latest?.questions?.length){
          paintQuestions(latest.questions, { fromCache:true, generatedAt: latest.generatedAt });
          showCacheStatus();
          return;
        }
      }
    } catch(e){ /* fall through to generate */ }
  }

  if(!state.online){ toast('Offline — পরে চেষ্টা করুন','warn'); return; }

  btnA?.classList.add('btn-loading');
  btnB?.classList.add('btn-loading');
  root.innerHTML = `<div class="ai-thinking">${icon('ai','sm')} Generating questions...
    <div class="thinking-dots"><span></span><span></span><span></span></div></div>`;

  try {
    const questions = await callAI();
    await saveRevision(questions);
    paintQuestions(questions, { fromCache:false, generatedAt: Date.now() });
    showCacheStatus();
  } catch(e){
    root.innerHTML = `<div class="ai-response" style="color:var(--danger)">${icon('warning','sm')} ${esc(e.message)}</div>`;
  } finally {
    btnA?.classList.remove('btn-loading');
    btnB?.classList.remove('btn-loading');
  }
}

async function callAI(){
  const cls = state.profile?.classLevel || 'student';
  const sysPrompt = `You generate exam-style practice questions for Bengali students.
Class: ${cls}. Subject: ${activeChapter.subject}. Chapter: ${activeChapter.chapter}.
${activeChapter.note ? 'Topic note: ' + activeChapter.note : ''}

Return STRICT JSON only — no markdown, no commentary. Schema:
{"questions":[{"q":"...","a":"...","type":"mcq|short|long","tag":"easy|medium|hard"}]}
Generate 8 questions: 3 short, 3 medium, 2 long. Mix Bengali & English where natural.`;

  const userPrompt = `Generate fresh practice questions for chapter "${activeChapter.chapter}" of ${activeChapter.subject}, class ${cls}. Output only the JSON object.`;

  const reply = await aiChat([
    { role:'system', content: sysPrompt },
    { role:'user',   content: userPrompt },
  ], { max_tokens: 1200, temperature: 0.85 });

  // Robust JSON extract — sometimes models wrap with ```json fences.
  const cleaned = reply.replace(/```json|```/g,'').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch(e){
    // Try to find the first { ... } block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if(m) parsed = JSON.parse(m[0]);
    else throw new Error('AI did not return JSON');
  }
  if(!Array.isArray(parsed.questions)) throw new Error('Bad format');
  return parsed.questions.slice(0, 12);
}

async function saveRevision(questions){
  const ref = cacheRef();
  const rev = {
    questions,
    generatedBy: state.user.uid,
    generatedByName: state.profile?.name || '',
    generatedAt: Date.now(),
  };
  try {
    const snap = await getDoc(ref);
    if(snap.exists()){
      const cur = snap.data();
      const revisions = cur.revisions || [];
      revisions.push(rev);
      // Keep at most 5 revisions to bound storage.
      const trimmed = revisions.slice(-5);
      await updateDoc(ref, { revisions: trimmed, updatedAt: serverTimestamp() });
    } else {
      await setDoc(ref, {
        class: state.profile?.classLevel || '',
        subject: activeChapter.subject,
        chapter: activeChapter.chapter,
        revisions: [rev],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch(e){ console.warn('saveRevision failed', e); }
}

function paintQuestions(questions, meta){
  const root = document.getElementById('ai-q-list');
  if(!root) return;
  if(!questions.length){
    root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">No questions</div></div>`;
    return;
  }
  const ts = meta?.generatedAt ? new Date(meta.generatedAt).toLocaleString('en-BD') : '';
  root.innerHTML = `
    <div class="cache-info">${meta?.fromCache ? icon('cache','sm') + 'Cached batch — last generated ' + ts : icon('sparkles','sm') + 'Fresh batch — ' + ts}</div>
    ${questions.map((q,i) => `
      <div class="question-item" data-qi="${i}">
        <div class="question-q"><span>Q${i+1}.</span><span>${esc(q.q || '')}</span></div>
        <div class="question-a">${esc(q.a || '')}</div>
        <div class="question-meta">
          <span class="question-tag">${esc(q.type || 'short')} • ${esc(q.tag || 'medium')}</span>
          <button class="btn btn-ghost btn-sm" data-toggle-answer="${i}">${icon('chevron-down','sm')} Show answer</button>
        </div>
      </div>`).join('')}
  `;
  root.querySelectorAll('[data-toggle-answer]').forEach(b => {
    b.addEventListener('click', () => {
      const item = b.closest('.question-item');
      item.classList.toggle('show-answer');
    });
  });
}
