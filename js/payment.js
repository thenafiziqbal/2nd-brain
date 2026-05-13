// payment.js — payment view + manual payment flow.
//
// Behaviour:
//   - User picks one of the admin-configured packages (rendered by packages.js).
//   - User picks one of the admin-configured payment methods (Bkash, Nagad, etc.).
//   - User enters TRX ID + sender number; we write a payment_request to Firestore.
//   - Admin approves it from the admin panel → user becomes pro, referrer
//     gets a 30-day reward (handled in admin.js).
import { state, esc, icon } from './store.js';
import { db, addDoc, collection, serverTimestamp } from './firebase-init.js';
import { trialDaysLeft, isTrialActive } from './ai.js';
import { effectivePlan } from './quota.js';
import { toast } from './toast.js';

let selectedPkgId = null;
let selectedMethodId = null;

export function initPayment(){
  // Modal open/close (Settings → Payment button still works).
  document.getElementById('open-payment-btn')?.addEventListener('click', openModal);
  document.querySelectorAll('[data-close-modal="payment-modal"]').forEach(b => b.addEventListener('click', closeModal));

  document.getElementById('submit-payment-btn')?.addEventListener('click', submitManual);

  // Whenever packages.js fires a "pkg-picked" event, remember the selection.
  window.addEventListener('pkg-picked', e => {
    selectedPkgId = e.detail;
    paintPaymentMethods();
    paintSelectedSummary();
    openModal();
  });
}

export function paintPaymentView(){
  // Renders the package list + selected package summary on the user-facing
  // "Subscribe / Payment" tab.
  paintPaymentMethods();
  paintSelectedSummary();
}

function openModal(){
  if(!selectedPkgId && state.packages.length){
    selectedPkgId = state.packages[0].id;
  }
  paintPaymentMethods();
  paintSelectedSummary();
  document.getElementById('payment-modal')?.classList.add('open');
}
function closeModal(){
  document.getElementById('payment-modal')?.classList.remove('open');
}

function paintSelectedSummary(){
  const pkg = state.packages.find(p => p.id === selectedPkgId);
  const root = document.getElementById('selected-pkg-summary');
  if(!root) return;
  if(!pkg){
    root.innerHTML = `<p class="mini-note">Package select করুন</p>`;
    return;
  }
  root.innerHTML = `
    <div class="pkg-summary">
      <div>
        <div class="pkg-summary-title">${esc(pkg.title)}</div>
        <div class="mini-note">${esc(pkg.description || '')}</div>
      </div>
      <div class="pkg-summary-price">৳ ${esc(pkg.price)}<small>/${esc(pkg.duration||'month')}</small></div>
    </div>`;
}

function paintPaymentMethods(){
  const root = document.getElementById('pay-method-list');
  if(!root) return;
  const methods = (state.paymentMethods || []).filter(m => m.enabled !== false);
  if(!methods.length){
    root.innerHTML = `<p class="mini-note">এই মুহূর্তে কোনো payment method active নেই — admin কে message দিন।</p>`;
    return;
  }
  if(!selectedMethodId || !methods.find(m => m.id === selectedMethodId)){
    selectedMethodId = methods[0].id;
  }
  root.innerHTML = methods.map(m => `
    <button type="button" class="pay-method ${m.id===selectedMethodId?'active':''}" data-method="${esc(m.id)}" style="${m.color ? `--pay-color:${esc(m.color)}` : ''}">
      ${m.logoUrl ? `<img class="pay-method-logo" src="${esc(m.logoUrl)}" alt="${esc(m.name || 'payment')}"/>` : ''}
      <div class="pay-method-name">${esc(m.name)}</div>
      <div class="pay-method-num">${esc(m.number || m.link || '—')}</div>
    </button>`).join('');
  root.querySelectorAll('[data-method]').forEach(b => {
    b.addEventListener('click', () => {
      selectedMethodId = b.dataset.method;
      paintPaymentMethods();
      paintMethodInstructions();
    });
  });
  paintMethodInstructions();
}

function paintMethodInstructions(){
  const root = document.getElementById('pay-method-instructions');
  if(!root) return;
  const m = state.paymentMethods.find(x => x.id === selectedMethodId);
  if(!m){ root.innerHTML = ''; return; }
  root.innerHTML = `
    ${m.instructions ? `<div class="mini-note" style="white-space:pre-wrap">${esc(m.instructions)}</div>` : ''}
    ${m.number ? `<div class="form-group"><label>${esc(m.name)} number</label>
      <div class="input-with-action">
        <input value="${esc(m.number)}" readonly id="pay-method-number-display"/>
        <button type="button" class="input-action" id="copy-method-number" title="Copy">${icon('copy')}</button>
      </div></div>` : ''}
    ${m.link ? `<a href="${esc(m.link)}" target="_blank" rel="noopener" class="btn btn-secondary btn-block">${icon('link')} Open ${esc(m.name)} payment page</a>` : ''}
  `;
  document.getElementById('copy-method-number')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(m.number).then(
      () => toast('Number copied','success'), () => toast('Copy failed','error')
    );
  });
}

export function paintTrialBanner(){
  const banner = document.getElementById('trial-banner');
  if(!banner) return;
  const eff = effectivePlan();
  if(eff.tier === 'paid' || eff.tier === 'reward'){
    const d = Math.max(0, Math.ceil((eff.expiresAt - Date.now()) / 86400000));
    banner.innerHTML = `${icon('check','sm')} ${esc(eff.label)} active — ${d} days left`;
    banner.style.display = 'block';
    return;
  }
  if(isTrialActive()){
    banner.innerHTML = `${icon('clock','sm')} ${trialDaysLeft()} days free trial left — <a href="#" id="open-payment-link">upgrade</a>`;
    banner.style.display = 'block';
  } else {
    banner.innerHTML = `${icon('warning','sm')} Free trial শেষ — Settings এ নিজের API key দিন বা <a href="#" id="open-payment-link">subscribe করুন</a>`;
    banner.style.display = 'block';
  }
  document.getElementById('open-payment-link')?.addEventListener('click', e => { e.preventDefault(); openModal(); });
}

async function submitManual(){
  if(!state.user) return;
  if(!selectedPkgId){ toast('Package select করুন','warn'); return; }
  if(!selectedMethodId){ toast('Payment method select করুন','warn'); return; }
  const pkg = state.packages.find(p => p.id === selectedPkgId);
  const method = state.paymentMethods.find(m => m.id === selectedMethodId);
  
  // If payment method has a link, redirect directly
  if(method?.link){
    toast('Payment page এ রিডিরেক্ট করছি...', 'info');
    window.open(method.link, '_blank');
    closeModal();
    return;
  }
  
  const trxId = document.getElementById('pay-trxid').value.trim();
  const sender = document.getElementById('pay-sender').value.trim();
  const promoCode = document.getElementById('pay-promo')?.value.trim().toUpperCase() || '';
  const expectedPromo = String(pkg?.promoCode || '').trim().toUpperCase();
  const promoValid = Boolean(promoCode && expectedPromo && promoCode === expectedPromo);
  if(!trxId || !sender){ toast('TRX ID ও sender number দিন','warn'); return; }
  const btn = document.getElementById('submit-payment-btn');
  btn?.classList.add('btn-loading');
  try {
    await addDoc(collection(db, 'payment_requests'), {
      uid: state.user.uid,
      email: state.profile?.email,
      name: state.profile?.name,
      packageId: pkg?.id || null,
      packageTitle: pkg?.title || '',
      packagePrice: pkg?.price || '',
      packageDurationDays: pkg?.durationDays || 30,
      methodId: method?.id || null,
      methodName: method?.name || '',
      trxId, sender,
      promoCode,
      promoValid,
      discountPercent: promoValid ? Number(pkg?.discountPercent || 0) : 0,
      referredBy: state.profile?.referredBy || null,    // admin uses this to credit referrer
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    toast('Payment request submitted — admin verify করবে','success');
    document.getElementById('pay-trxid').value = '';
    document.getElementById('pay-sender').value = '';
    if(document.getElementById('pay-promo')) document.getElementById('pay-promo').value = '';
    closeModal();
  } catch(e){ toast('Submit failed: ' + e.message, 'error'); }
  finally { btn?.classList.remove('btn-loading'); }
}
