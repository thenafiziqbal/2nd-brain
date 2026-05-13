// community.js — renders admin-configured community groups + social links.
// The lists live in /system/community (array of {name,url,platform}) and
// /system/social (array of {platform,url}). Both are cached and re-rendered
// whenever the admin updates them.
import { state, esc, icon } from './store.js';

const PLATFORM_ICON = {
  facebook:'facebook', whatsapp:'whatsapp', telegram:'telegram',
  youtube:'youtube',  instagram:'instagram', twitter:'twitter',
  discord:'discord',  linkedin:'linkedin',   website:'globe',
  group:'users',      community:'users'
};

export function paintCommunity(){
  const root = document.getElementById('view-community');
  if(!root) return;
  const list = state.community || [];
  root.innerHTML = `
    <div class="section-header"><div class="section-title">${icon('users')} Community</div></div>
    ${state.appSettings?.communityIntro ? `<p class="mini-note">${esc(state.appSettings.communityIntro)}</p>` : ''}
    ${list.length ? `
      <div class="community-grid">
        ${list.map(g => `
          <a class="community-card" href="${esc(g.url)}" target="_blank" rel="noopener">
            <div class="community-icon">${icon(PLATFORM_ICON[g.platform] || 'users','lg')}</div>
            <div>
              <div class="community-name">${esc(g.name || 'Community')}</div>
              <div class="community-platform">${esc(g.platform || 'Group')}</div>
            </div>
          </a>`).join('')}
      </div>` : `
      <div class="empty-state">${icon('users','xl')}<div class="empty-title">এখনও কোনো community group add হয়নি</div><div class="empty-text">Admin Panel থেকে link add করুন</div></div>`}
  `;
}

export function paintFooter(){
  const footer = document.getElementById('app-footer');
  if(!footer) return;
  const social = state.social || [];
  const appName = state.branding?.appName || state.appSettings?.appName || 'Second Brain';
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="footer-name">${esc(appName)}</span>
        <span class="footer-tagline">${esc(state.branding?.appTagline || state.appSettings?.appTagline || '')}</span>
      </div>
      <div class="footer-social">
        ${social.map(s => `
          <a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.platform || '')}">
            ${icon(PLATFORM_ICON[s.platform] || 'globe')}
          </a>`).join('')}
      </div>
      <div class="footer-meta">© ${new Date().getFullYear()} ${esc(appName)}</div>
    </div>
  `;
}
