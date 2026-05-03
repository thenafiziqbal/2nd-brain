# Second Brain — Modular Refactor

A complete, modularised refactor of your **Second Brain** student PWA. Each
feature now lives in its own file, the User Panel is much lighter, the
"other tabs' video pauses" issue is fixed, login is fully persistent,
and there is a brand-new **Syllabus-based AI Question Generator with a
shared cache** (Class + Subject + Chapter).

---

## File structure

```
2ndbrain/
├── index.html               ← User panel (no admin button)
├── manifest.webmanifest     ← PWA manifest
├── sw.js                    ← Service worker (offline cache)
├── firestore.rules          ← Copy/paste into Firebase console
├── README.md                ← This file
│
├── assets/
│   ├── icons.svg            ← Single SVG sprite (one fetch, every icon)
│   ├── logo.svg
│   └── icon-192.png.svg
│
├── css/
│   ├── base.css             ← variables, reset, layout shell
│   ├── components.css       ← buttons, forms, modals, badges, FAQ, toast
│   ├── auth.css             ← login + register
│   ├── dashboard.css        ← hero + stats
│   ├── notes.css            ← notes grid + revision
│   ├── prayer.css           ← prayer times grid
│   ├── focus.css            ← focus timer
│   ├── syllabus.css         ← syllabus + AI questions
│   ├── chat.css             ← floating chat
│   └── responsive.css
│
├── js/
│   ├── app.js               ← orchestrator (loaded as <script type=module>)
│   ├── firebase-init.js     ← Firebase config + persistent auth + offline cache
│   ├── store.js             ← shared state, helpers, icon helper
│   ├── toast.js
│   ├── theme.js             ← light/dark
│   ├── offline.js           ← Offline Mode badge
│   ├── pwa.js               ← Service Worker registration
│   ├── auth.js              ← register/login + per-user profile bootstrap
│   ├── notes.js             ← notes CRUD (users/{uid}/notes)
│   ├── syllabus.js          ← syllabus topics
│   ├── tasks.js             ← daily/admin tasks
│   ├── focus-timer.js       ← focus + chime (single AudioContext fix!)
│   ├── prayer.js            ← prayer times + countdown
│   ├── ai.js                ← Groq + Gemini wrappers
│   ├── ai-questions.js      ← *NEW* — shared question cache with Generate New
│   ├── chat.js              ← floating AI chat + admin support
│   ├── voice.js             ← Voice → text (Web Speech API)
│   ├── settings.js          ← profile + own API keys
│   ├── payment.js           ← 14-day trial + payment request submit
│   ├── system-settings.js   ← live feature flags from /system/settings
│   └── ui.js                ← navigation, modals, delegation
│
└── admin/
    ├── admin.html           ← Admin dashboard
    ├── css/admin.css
    └── js/
        ├── admin-firebase.js
        └── admin.js          ← users, payments, features, packages, support, AI cache
```

---

## What was fixed

### 1. "Other tabs' videos pause when entering this site"
The previous app created a **new `AudioContext` for every chime**, plus
the brain animation kept the audio pipeline alive. On mobile Chrome
this makes the browser grant *this* tab audio focus and pause media in
other tabs.

`js/focus-timer.js` now:
- creates **one shared** `AudioContext`,
- only resumes it on a real user click,
- **suspends** it again ~350 ms after the chime, releasing media focus.

The heavy 160-particle canvas brain animation is gone — replaced by a
CSS-only "orb" with a single conic gradient, which costs **0 ms of JS
work per frame**. There are no more `requestAnimationFrame` loops or
800 ms `setInterval`s on the dashboard.

### 2. User panel is now much lighter
- Brain canvas → CSS orb (no JS animation loop).
- Prayer countdown only updates 3 text nodes per tick; grid repaints
  once per minute (was every 1 s).
- All CSS split into **9 small files** with one shared variable system.
- All JS split into **18 ES modules**; each is loaded on demand via
  `<script type="module">` so the browser can parallelise.
- Icons come from a single `assets/icons.svg` sprite — no extra HTTP
  requests per icon, no emoji rendering cost.

### 3. Persistent login + per-user data isolation
- `firebase-init.js` calls `setPersistence(auth, browserLocalPersistence)`,
  so once a user registers they stay signed in across browser restarts —
  the auth gate disappears automatically on reopen.
- All per-user data goes through `users/{uid}/notes`,
  `users/{uid}/...` paths. The `firestore.rules` file blocks every
  cross-user read.
- Admin button has been removed from the user header. Admins now visit
  `admin/admin.html` directly.

### 4. NEW — Syllabus-based AI Question Generator
File: `js/ai-questions.js` + the *Syllabus + AI* tab.

Workflow:
1. User adds a chapter to their syllabus.
2. Click the chapter → click **Generate**.
3. App computes the cache key `${classLevel}__${subject}__${chapter}`
   and looks up `syllabus_questions/{cacheKey}` in Firestore.
4. **Cache hit** → instantly shows the latest revision (a "Cache hit"
   badge tells the user it was reused). No AI cost.
5. **Cache miss** → calls AI, stores the questions as the first revision.
6. **Generate New** button → forces a fresh AI call, appends a new
   revision (last 5 kept), so future students still benefit.

This means once a single student has generated questions for *Class 9
Physics, Newton's Laws*, every other Class 9 student instantly sees
those questions for free.

### 5. Picture icons (no emoji icons)
Every UI affordance — sidebar, buttons, modals, toasts, chat — uses
SVG icons from `assets/icons.svg`. The icons inherit `currentColor`,
so they re-tint automatically for dark mode.

### 6. Offline Mode
- `sw.js` caches the entire app shell; the user can open the site with
  no internet.
- `js/offline.js` shows the **Offline Mode** badge and disables network
  buttons (`[data-needs-online]`) automatically.
- Firestore offline persistence (`persistentLocalCache`) lets the user
  add notes offline; they sync the moment connectivity returns.

### 7. Voice-to-Text on the note editor
The mic button on the *Add Note* page uses the Web Speech API (`bn-BD`).
Speak → text streams into the textarea live.

### 8. Show / Hide password toggles, Institution + Class on register
Both new registration fields are saved into the user's profile and
shown to the admin in the User Management table.

---

## Setup

1. **Drop the entire `2ndbrain/` folder onto any static host** (Firebase
   Hosting, Netlify, Vercel, GitHub Pages, your own VPS, even a USB
   stick). There is no build step — everything is plain HTML / CSS /
   ES modules.
2. Open Firebase Console → **Firestore** → **Rules** and paste the
   contents of `firestore.rules`. Edit `ADMIN_EMAILS` inside the file
   first to match your admin account(s).
3. Open Firebase Console → **Authentication** → enable **Email/Password**.
4. Edit `admin/js/admin-firebase.js` → `ADMIN_EMAILS` so the admin panel
   knows who is allowed in.
5. Open `index.html` in a browser. Register once → from then on, opening
   the URL drops you straight onto the dashboard.
6. Open `admin/admin.html` to manage users, payments, support chat,
   feature flags and the AI question cache.

The `firebase-init.js` file already contains your existing project
config (focosmood). Change it only if you migrate to a new project.

---

## Quick test plan

1. **Persistent login** — register, close the browser, reopen → you
   should land on the dashboard without re-typing anything.
2. **Data isolation** — register as `a@x.com`, add a note. Logout.
   Register as `b@x.com` → you should not see A's note.
3. **Other-tab videos** — start a YouTube video in another tab, then
   open this app, then start the focus timer. The video should keep
   playing. (The chime plays once and the AudioContext suspends.)
4. **Question cache** — add a chapter, generate questions. Refresh.
   Click the chapter again → you should see the cached badge appear
   instantly without an AI call. Click *Generate New* → fresh batch.
5. **Offline** — DevTools → Network → Offline. Reload the app. The
   offline badge should appear and the cached app should still load.
   Add a note → sync should resume when you go back online.
6. **Voice** — Add note → click the mic icon → say a sentence in
   Bengali. Text should stream into the textarea.
7. **Admin** — open `admin/admin.html`, login with the configured admin
   account, toggle a feature flag, refresh the user app — that section
   should disappear.

---

## API key advice for users

The trial-period AI cost is paid by the admin's Groq key in
`/system/settings`. Once a user's 14 days are up, Settings → "Your AI
Keys" lets them paste their own free Gemini API key
(<https://aistudio.google.com/app/apikey>) and keep using AI features
forever — at zero cost to you.

---

That's it. Drop, deploy, done. Happy studying! 🧠

---

## Phase 2 — SaaS features (referrals, dynamic packages, branding)

After deploy, log into the admin panel and configure these sections in
order:

1. **Branding** — change app name, tagline, logo URL, favicon. The user
   panel updates live for everyone via `onSnapshot`.
2. **Trial / Free Tier** — configure the mandatory trial duration + the
   per-feature matrix (which features are on, daily limits). Also set
   what happens when the trial expires and the user has no plan.
3. **Packages** — create one or more paid packages. For each, set the
   per-feature matrix and daily limits. `durationDays` controls how long
   `planEnd` extends after admin approval.
4. **Payment Methods** — add Bkash / Nagad / Rocket / etc. Toggle each
   on or off. User panel shows only enabled methods.
5. **Community & Social** — Community group cards (visible on the
   Community tab) and Social links (footer).

### Referral flow

- Every user gets a unique referral code, generated on first login.
- `?ref=CODE` in the registration URL pre-fills the input and stores a
  `referredBy` link on the new profile.
- When that referred friend's payment is approved by the admin, the
  referrer receives **30 days** of full-access reward (added on top of
  whatever they already had via `rewardEnd`).

### Firestore collections (new in Phase 2)

```
/system/branding         { appName, appTagline, logoUrl, faviconUrl }
/system/trial_package    { title, durationDays, features:{}, limits:{} }
/system/free_tier        { features:{}, limits:{} }
/system/payment_methods  { items:[{ id,name,number,link,instructions,enabled }] }
/system/community        { items:[{ name,url,platform }] }
/system/social           { items:[{ platform,url }] }
/packages/{id}           { title, price, duration, durationDays,
                           description, features:{}, limits:{}, active,
                           popular, sortOrder }
/referrals/{code}        { uid, used, createdAt }
/users/{uid}             + { referralCode, referredBy, rewardEnd, planEnd, packageId }
/payment_requests/{id}   + { packageId, packageTitle, packagePrice,
                             packageDurationDays, methodId, methodName,
                             trxId, sender, referredBy }
```

The `firestore.rules` file is updated with a `/referrals/{code}` block —
public read so users can resolve a `?ref=` code, signed-in write so a
new user can claim their own code.
