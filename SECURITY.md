# Security Policy - Second Brain

## 🔒 Security Overview

Second Brain is a student productivity app with strong focus on data privacy and security. This document outlines our security practices, user data protection, and reporting guidelines.

## Data Protection

### User Data Storage
- **Local-First**: All user notes, tasks, study logs stored locally in browser IndexedDB
- **End-to-End**: Sensitive data (API keys) encrypted before transmission
- **Firestore Rules**: Strict per-user data isolation via Firebase Security Rules
- **No Data Selling**: User data is never sold or shared with third parties

### Sensitive Information Handling

1. **Firebase Config** (PUBLIC - Safe)
   - API keys in `js/firebase-init.js` are intentionally public
   - These are browser-level keys with restricted permissions
   - Real security enforced via Firebase Security Rules

2. **Admin Credentials** (PRIVATE - Keep Secret)
   - Admin emails in `admin/js/admin-firebase.js`
   - Firestore admin rules restrict to these emails only
   - Never commit real admin emails - use environment variables

3. **API Keys** (USER CONTROLLED)
   - Users input their own Gemini/Groq API keys in Settings
   - Stored encrypted in Firestore `users/{uid}.apiKeys`
   - Never logged or exposed in console

4. **Email Passwords** (NEVER STORED)
   - Firebase handles authentication securely
   - Passwords never sent to Firestore
   - Reset link flow handled by Firebase Auth

## Firestore Security Rules

### Rules Enforced

```
- Users can ONLY read/write their own data
- Banned users CANNOT access any data
- Admin-only data restricted to configured emails
- Shared data requires explicit ownership verification
- Public leaderboard shows only necessary fields
- DMs/shared notes verify sender identity
```

### Audit This
Check `firestore.rules` regularly for:
- Proper user UID validation
- Admin email whitelist up-to-date
- Data isolation not bypassed
- Collection-level rules comprehensive

## Authentication Security

### Strength
- ✅ Firebase Auth with email/password
- ✅ Google OAuth integration
- ✅ Password minimum 6 characters (enforce 12+ in production)
- ✅ Session persistence with browser local storage
- ✅ Automatic timeout recommendations
- ✅ Ban system prevents compromised account abuse

### Improvements Needed
- [ ] Rate limiting on login attempts
- [ ] Two-factor authentication (2FA) support
- [ ] Session timeout enforcement
- [ ] Suspicious activity logging

## Password Security

- **Change Password**: User can change anytime in Settings
- **Password Reset**: Firebase email link (24-hour expiry)
- **On Login Page**: Quick password change option available
- **Validation**: Minimum 6 chars, can use strong passwords

## Admin Panel Security

- Password-protected admin gate
- Restricted to configured admin emails only
- All admin actions logged via Firestore timestamps
- No direct database access - all changes via documented functions

## Environment Variables (For Production)

Create `.env.production.local`:
```
REACT_APP_FIREBASE_API_KEY=your_public_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_domain
# Never expose admin credentials here
```

## API Security

### Third-Party APIs
- **Gemini/Groq**: User brings own API key (no server-side exposure)
- **Prayer API**: Public, no authentication needed
- **YouTube Data**: Optional, requires user key

### Server Best Practices (If Adding Backend)
1. Never send raw API keys to client
2. Proxy API calls through backend
3. Rate limit per-user, per-IP
4. Log API usage for abuse detection
5. Rotate keys regularly

## XSS & Injection Prevention

### Implemented
- ✅ HTML escaping via `esc()` function in store.js
- ✅ No eval() or dynamic code execution
- ✅ Content Security Policy ready
- ✅ User input sanitized before display

### TODO
- [ ] Add CSP headers in production deployment
- [ ] Regular security audits
- [ ] OWASP compliance check

## CSRF & CORS

### Current
- Firebase handles CORS safely
- Firestore rules prevent unauthorized operations
- Same-origin requests only (PWA + web)

### Production Setup
1. Enable CORS headers appropriately
2. Disable CORS for non-API routes
3. Implement CSRF tokens if forms added

## Reporting Security Issues

🚨 **Found a vulnerability?**

**DO NOT open a public issue.** Instead:

1. Email: `security@example.com` (replace with real email)
2. Subject: `[SECURITY] Vulnerability Description`
3. Include: Steps to reproduce, severity, impact
4. Responsible disclosure: 90-day fix timeline

We take all reports seriously and will:
- Acknowledge receipt within 24 hours
- Provide update within 7 days
- Credit you publicly (if desired)

## Security Checklist

Before deploying to production:

- [ ] Firebase rules audited and tested
- [ ] No sensitive data in version control
- [ ] `.env` files in `.gitignore`
- [ ] Admin credentials use environment variables
- [ ] HTTPS enforced on all routes
- [ ] CSP headers configured
- [ ] Rate limiting implemented
- [ ] User session timeout set
- [ ] Error messages don't leak system info
- [ ] User data export working
- [ ] Data deletion working
- [ ] Privacy policy updated
- [ ] Terms of service updated

## Compliance

### GDPR (EU Users)
- ✅ Users can request data export
- ✅ Users can request data deletion
- ✅ Consent tracking for analytics
- [ ] Data Processing Agreement (DPA) needed

### CCPA (California Users)
- ✅ User rights respected
- [ ] Privacy policy updated
- [ ] Opt-out mechanisms implemented

### Bangladesh
- Follow ICT Act Section 66-67 guidelines
- Secure personal data of Bangladesh citizens
- Comply with Bangladesh Privacy Law

## Incident Response

If a security incident occurs:

1. **Contain**: Disable affected systems
2. **Notify**: Contact security team immediately
3. **Investigate**: Determine scope and impact
4. **Communicate**: Notify affected users within 48 hours
5. **Remediate**: Patch and redeploy
6. **Follow-up**: Post-mortem and improvements

## Version Updates & Patches

- Check Firebase SDK updates monthly
- Test updates in staging before production
- Keep dependencies current
- Subscribe to security advisories

## Third-Party Dependencies

Current major dependencies:
- Firebase v10.12.0 - Monitor for updates
- Firestore - Maintained by Google
- Cloudflare Turnstile - Optional CAPTCHA

Audit command:
```bash
npm audit
npm audit fix
```

## User Privacy Rights

Users have the right to:
- ✅ Access their data
- ✅ Download their data
- ✅ Delete their account & data
- ✅ Change/reset password
- ✅ Control privacy settings
- ✅ Know how data is used

## Security Resources

- [Firebase Security](https://firebase.google.com/docs/rules)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MDN Web Security](https://developer.mozilla.org/en-US/docs/Web/Security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Last Updated

- **Date**: May 13, 2026
- **Version**: 1.0
- **Maintained By**: Security Team
- **Next Review**: 90 days

---

**Remember**: Security is everyone's responsibility. If you see something, say something! 🛡️
