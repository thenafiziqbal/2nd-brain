import { db, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from './firebase-init.js';
import { state, esc, icon, on } from './store.js';
import { toast } from './toast.js';
import { quotaFor } from './quota.js';

let banks = [];
let activeId = null;

export function initQuestionBank(){
  bindFilters();
  bindSetup();
  on('auth-ready', () => { paintFilters(); paintList(); });
  onSnapshot(query(collection(db, 'question_banks'), orderBy('createdAt', 'desc')), snap => {
    banks = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.active !== false);
    paintFilters();
    paintList();
  }, err => {
    console.warn('question bank watch failed', err);
    const root = document.getElementById('qb-list');
    if(root) root.innerHTML = `<div class="empty-state">${icon('warning','xl')}<div class="empty-title">Question bank unavailable</div></div>`;
  });
}

function bindFilters(){
  ['qb-exam-filter','qb-class-filter','qb-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      paintList();
      paintDetail();
    });
  });
}

function bindSetup(){
  document.getElementById('qb-setup-save')?.addEventListener('click', async () => {
    if(!state.user) return;
    const classLevel = document.getElementById('qb-setup-class')?.value.trim() || '';
    const exam = document.getElementById('qb-setup-exam')?.value.trim() || '';
    if(!classLevel || !exam){ toast('Class এবং exam দিন', 'warn'); return; }
    const qbPrep = { classLevel, exam, updatedAt: Date.now() };
    await updateDoc(doc(db,'users',state.user.uid), { qbPrep }).catch(()=>{});
    state.profile = { ...(state.profile || {}), qbPrep };
    const cls = document.getElementById('qb-class-filter');
    const ex = document.getElementById('qb-exam-filter');
    if(cls) cls.value = classLevel;
    if(ex) ex.value = exam;
    paintSetup();
    paintList();
  });
}

function paintSetup(){
  const box = document.getElementById('qb-setup');
  if(!box) return;
  const prep = state.profile?.qbPrep;
  box.style.display = prep?.classLevel && prep?.exam ? 'none' : '';
  if(!prep) return;
  const cls = document.getElementById('qb-setup-class');
  const ex = document.getElementById('qb-setup-exam');
  if(cls && !cls.value) cls.value = prep.classLevel || state.profile?.classLevel || '';
  if(ex && !ex.value) ex.value = prep.exam || '';
}

function paintFilters(){
  paintSetup();
  setOptions('qb-exam-filter', 'All exams', [...new Set(banks.map(b => b.exam).filter(Boolean))]);
  setOptions('qb-class-filter', 'All classes', [...new Set(banks.map(b => b.classLevel).filter(Boolean))]);
  const prep = state.profile?.qbPrep;
  const ex = document.getElementById('qb-exam-filter');
  const cls = document.getElementById('qb-class-filter');
  if(prep?.exam && ex && !ex.value) ex.value = prep.exam;
  if(prep?.classLevel && cls && !cls.value) cls.value = prep.classLevel;
}

function setOptions(id, label, values){
  const el = document.getElementById(id);
  if(!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">${label}</option>` + values.sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(values.includes(cur)) el.value = cur;
}

function filtered(){
  const exam = document.getElementById('qb-exam-filter')?.value || '';
  const cls = document.getElementById('qb-class-filter')?.value || '';
  return banks.filter(b => (!exam || b.exam === exam) && (!cls || b.classLevel === cls));
}

function paintList(){
  const root = document.getElementById('qb-list');
  if(!root) return;
  const rows = filtered();
  if(!rows.length){
    root.innerHTML = `<div class="empty-state">${icon('book-open','xl')}<div class="empty-title">No question bank yet</div><div class="empty-text">Admin panel থেকে board/exam questions add করুন।</div></div>`;
    document.getElementById('qb-detail').innerHTML = '';
    return;
  }
  if(!activeId || !rows.some(b => b.id === activeId)) activeId = rows[0].id;
  root.innerHTML = rows.map(b => `
    <button class="qb-card ${b.id === activeId ? 'active' : ''}" data-qb-id="${esc(b.id)}">
      <strong>${esc(b.title || 'Untitled bank')}</strong>
      <span>${esc([b.exam, b.board, b.year, b.classLevel].filter(Boolean).join(' • '))}</span>
      <small>${(b.questions || []).length} questions</small>
    </button>
  `).join('');
  root.querySelectorAll('[data-qb-id]').forEach(btn => btn.addEventListener('click', () => {
    activeId = btn.dataset.qbId;
    paintList();
    paintDetail();
  }));
  paintDetail();
}

function paintDetail(){
  const root = document.getElementById('qb-detail');
  if(!root) return;
  const bank = banks.find(b => b.id === activeId);
  if(!bank){ root.innerHTML = ''; return; }
  const mode = document.getElementById('qb-mode')?.value || 'reading';
  const qs = bank.questions || [];
  root.innerHTML = `
    <div class="qb-detail-head">
      <div><h3>${esc(bank.title || 'Question Bank')}</h3><p>${esc([bank.exam, bank.board, bank.year, bank.subject].filter(Boolean).join(' • '))}</p></div>
      <button class="btn btn-secondary btn-sm" id="qb-speak-btn">${icon('mic','sm')} Read aloud</button>
    </div>
    <div class="qb-questions ${mode === 'exam' ? 'exam' : ''}">
      ${qs.map((q, i) => questionHtml(q, i, mode)).join('')}
    </div>
    ${mode === 'exam' ? `<button class="btn btn-success" id="qb-submit-exam">${icon('check')} Submit answers</button><div id="qb-result"></div>` : ''}
  `;
  document.getElementById('qb-speak-btn')?.addEventListener('click', () => speakBank(bank));
  document.getElementById('qb-submit-exam')?.addEventListener('click', () => submitExam(bank));
}

function questionHtml(q, i, mode){
  const opts = (q.options || []).map((o, idx) => `<label><input type="radio" name="qb-${i}" value="${idx}"/> ${esc(o)}</label>`).join('');
  return `<article class="qb-question">
    <div class="qb-q"><span>${i + 1}.</span> ${esc(q.q || q.question || '')}</div>
    ${opts ? `<div class="qb-options">${opts}</div>` : ''}
    ${mode === 'exam'
      ? `<textarea data-qb-answer="${i}" placeholder="Write or paste your answer"></textarea>`
      : `<div class="qb-answer"><strong>Answer:</strong> ${esc(q.answer || q.a || '')}</div>`}
  </article>`;
}

function speakBank(bank){
  if(!('speechSynthesis' in window)){ toast('Voice reading is not supported in this browser', 'warn'); return; }
  const text = (bank.questions || []).map((q, i) => `Question ${i + 1}. ${q.q || q.question || ''}. Answer. ${q.answer || q.a || ''}`).join('. ');
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

async function submitExam(bank){
  const limit = quotaFor('questionBank');
  const used = Number(state.profile?.questionBankAttempts || 0);
  if(limit != null && used >= Number(limit)){
    toast(`Question bank attempt limit reached (${limit})`, 'warn');
    return;
  }
  const rows = [...document.querySelectorAll('[data-qb-answer]')];
  let score = 0;
  const answers = rows.map(el => {
    const idx = Number(el.dataset.qbAnswer);
    const q = bank.questions[idx] || {};
    const selected = document.querySelector(`input[name="qb-${idx}"]:checked`)?.value;
    const written = el.value.trim();
    const expected = String(q.answer || q.a || '').trim().toLowerCase();
    const ok = selected != null
      ? Number(selected) === Number(q.correct ?? q.aIndex)
      : Boolean(written && expected && written.toLowerCase().includes(expected.slice(0, Math.min(24, expected.length))));
    if(ok) score++;
    return { question: q.q || q.question || '', selected, written, expected: q.answer || q.a || '', ok };
  });
  const result = document.getElementById('qb-result');
  if(result) result.innerHTML = `<div class="qb-result">Score: <strong>${score}/${answers.length}</strong></div>`;
  if(state.user){
    await addDoc(collection(db, 'users', state.user.uid, 'question_bank_attempts'), {
      bankId: bank.id,
      title: bank.title || '',
      score,
      total: answers.length,
      answers,
      createdAt: serverTimestamp(),
    }).catch(()=>{});
    const next = used + 1;
    await updateDoc(doc(db,'users',state.user.uid), { questionBankAttempts: next }).catch(()=>{});
    state.profile = { ...(state.profile || {}), questionBankAttempts: next };
  }
}
