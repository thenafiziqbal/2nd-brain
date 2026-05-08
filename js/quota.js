// quota.js — figures out which features the current user is allowed to use,
// and how much. Combines:
//   - admin global feature flags (`/system/settings.features`)
//   - the user's plan: trial / pro (via paid package) / referral reward / free
//   - per-package feature matrix (admin-set)
//   - free tier limits (admin-set)
import { state } from './store.js';

// Returns the "effective plan object" for the current user — the union of
// trial, paid, and reward. Whichever gives the most generous expiry wins.
export function effectivePlan(){
  const now = Date.now();
  const trialEnd = state.trial.expiresAt || 0;
  const rewardEnd = state.profile?.rewardEnd || 0;
  const plan = state.profile?.plan || state.trial.plan || 'trial';
  const planEnd = state.profile?.planEnd || 0;

  // Active package (the one they paid for).
  const activePkg = (state.packages || []).find(p => p.id === state.profile?.packageId);

  // Referral reward gives full access for its window.
  const rewardActive = rewardEnd > now;

  // Trial active?
  const trialActive = plan === 'trial' && trialEnd > now;

  // Paid plan active?
  const paidActive = (plan === 'pro' || plan === 'paid') && (!planEnd || planEnd > now);

  if(paidActive && activePkg)
    return { tier: 'paid', pkg: activePkg, expiresAt: planEnd, label: activePkg.title };
  if(rewardActive)
    return { tier: 'reward', expiresAt: rewardEnd, label: 'Referral reward (full access)' };
  if(trialActive){
    const trialPkg = state.trialPackage || {};
    return { tier: 'trial', pkg: trialPkg, expiresAt: trialEnd, label: trialPkg.title || 'Free Trial' };
  }
  return { tier: 'free', pkg: state.freeTier || {}, expiresAt: 0, label: 'Free' };
}

// Does this user have access to a given feature key?
// Falls through global feature flag (admin can disable a feature globally).
export function hasFeature(key){
  if(state.features?.[key] === false) return false;
  const eff = effectivePlan();
  if(eff.tier === 'reward') return true;          // reward = full
  if(eff.tier === 'paid')   return featureOn(eff.pkg, key);
  if(eff.tier === 'trial')  return featureOn(eff.pkg, key);
  // Free tier — whatever admin allowed.
  return featureOn(eff.pkg, key);
}

function featureOn(pkg, key){
  if(!pkg) return true;                     // no config → permissive
  const features = pkg.features || {};
  if(features[key] === false) return false;
  return true;
}

// Quota helper — returns null when unlimited, or a number when limited.
export function quotaFor(key){
  const eff = effectivePlan();
  if(eff.tier === 'reward') return null;
  const pkg = eff.pkg || {};
  const limits = pkg.limits || {};
  if(limits[key] == null) return null;
  return limits[key];
}

export function planLabel(){
  return effectivePlan().label;
}
export function expiresAtMs(){
  return effectivePlan().expiresAt;
}
export function isFree(){
  return effectivePlan().tier === 'free';
}
