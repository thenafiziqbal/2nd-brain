# 2nd Brain — Major Update (3 Phases)

This update bundles all three prompt phases into a single drop-in modular
upgrade. No build step required — pure ES modules + Firebase v10 CDN.

---

## Phase 1 — Bug Fixes, Admin Dashboard & Notifications

### Bug fixes
- **Voice note feature** — completely rewrote `js/voice.js`:
  - Always creates a fresh `SpeechRecognition` instance per start (some
    browsers reject reusing the previous one after `onend`).
  - Added a `getUserMedia` permission gate before starting recognition so
    permission errors surface as a toast instead of a silent failure.
  - Auto-restart on `onend` while still listening, preserving the current
    transcript as `baseText`.
  - Language fallback chain: `bn-BD → bn-IN → en-US`.
  - Re-binds `[data-mic-btn]` automatically so newly-rendered modals
    (Class Community, DMs, etc.) all get the mic button working.
- **Demo data flicker on login** — added a boot-loading splash:
  - `body.app-loading` is set on first paint and removed only after
    `firebase.auth().onAuthStateChanged` resolves.
  - The `#boot-loader` element shows a spinner over the screen while the
    app-container and auth-gate are hidden via CSS.

### Admin dashboard
- **Password-only login** was already in place; the existing single-input
  form still works. Email is pre-filled from `ADMIN_EMAILS[0]` in
  `admin/js/admin-firebase.js`.
- **Chart.js charts** added to the dashboard:
  - Active Users (last 30 days, line chart from `/study_logs`)
  - Revenue trend (last 12 months, bar chart from approved
    `/payment_requests`)
  - Top API users (bar chart, from `users.apiUsage`)
  - Subscriptions by package (doughnut)
- **Finance section** with KPI cards (Total / Month / Week / Today),
  monthly revenue chart, and an approved-subscriptions table showing
  which user bought which package via which payment method.

### User panel — API usage
- New `js/api-usage.js` syncs `state.apiUsage` to any DOM element with
  a `[data-api-usage]` attribute, plus `#stat-ai`, `#brain-ai-count`,
  `#settings-api-usage`. Bumps automatically when AI calls fire.

### Notifications / banners
- Existing `notices.js` already handles dismissible mobile-responsive
  banners with text + CTA + link. No code changes needed; admin can edit
  notices from the **Notices** tab.

---

## Phase 2 — Gamification, Leaderboard & Social

### Real-time global leaderboard (`js/leaderboard.js`)
- Subscribes to `/users` (top 200, ordered by `totalStudySeconds desc`).
- Class filter dropdown lets users see only their class or all classes.
- Displays rank, profile photo (or initial avatar), name, class, and
  total study time. Highlights "you" when present.
- Fed by `js/study-tracker.js`, which listens for the
  `focus-session-end` CustomEvent (now fired by `focus-timer.js`) and
  increments `totalStudySeconds` on the user doc + writes a
  `study_logs` subcollection entry. Also writes a global `/study_logs`
  doc the admin uses for DAU charts.

### School / class registration (`js/schools.js`)
- Registration form now uses a managed dropdown (`reg-institution-select`).
- **Default option:** "Charghat Technical School and College" (always
  present even before the live `/schools` snapshot resolves).
- Live list of approved institutions read from `/schools` (admin manages).
- "Other" → reveals a request form that writes to `/school_requests`
  for admin approval.
- Admin panel **Schools** tab: add/disable/delete institutions, plus a
  "Pending requests" table with one-click Approve (creates a `/schools`
  doc) or Reject.

### Profiles & class auto-communities (`js/class-community.js`)
- **Profile pictures** — already implemented in `js/profile.js` via the
  free ImgBB API (only the URL is stored in Firestore, zero storage cost).
- **Class auto-enrollment** — on every login we `setDoc(merge)` the user
  into `/class_communities/{classKey}/members/{uid}`. There is no leave
  button; membership is permanent.
- Per-class group chat at `/class_communities/{classKey}/messages`.
  Real-time `onSnapshot`, with the same chat UI shell as DMs.

### Friends + 1-on-1 messaging (`js/friends.js`, `js/dm.js`)
- **Same-class only** friend requests. `friends.js`:
  - Loads classmates via `where('classLevel','==', state.profile.classLevel)`.
  - Prevents cross-class requests at the client (rules also enforce sane
    `fromUid == request.auth.uid` constraints).
  - Pending → accept/reject workflow; on accept, writes a flat
    `/friendships/{sortedUids}` doc so the admin can see all pairs.
- **DMs** at `/direct_messages` keyed by sorted `pairId`:
  - Per-package daily quota: `effectivePlan().pkg.limits.dmDaily`.
    Before each send we run `getDocs` with
    `where('fromUid','==',uid) where('day','==',today)` and refuse the
    send if `snap.size >= limit`. Friendly "Premium Package নিন" toast.
  - Admin `direct_messages` query in **Friends & DM Mod** shows the
    latest 100 messages with full text for moderation.

---

## Phase 3 — Advanced Study Tools & Quizzes

### Syllabus-tagged AI questions
- Existing `ai-questions.js` already supports per-chapter generation
  (Essay / Short / Quiz) — no changes needed beyond the existing
  Syllabus tab.

### Collaborative note sharing (`js/note-share.js`)
- New **Share with friend** button on the note detail modal.
- Picks a friend → choose `view` or `edit (append-only)`.
- Writes to `/users/{friendUid}/shared_with_me/{shareId}` with:
  ```js
  {
    sharedByUid, sharedByName, noteId, title, access, originalContent,
    blocks: [{ author, authorUid, text, addedAt }],
  }
  ```
- Recipient sees them in the new **Shared Notes** tab. With `edit`
  access they can press "Append" — the new chunk is pushed onto the
  `blocks` array. Original content is never touched (append-only by
  construction; rules also let only the recipient/owner update).

### Monthly quiz campaigns (`js/quiz.js`)
- **User panel** — Quiz tab subscribes to `/quiz_campaigns`,
  `orderBy('startAt','desc')`. Filters out `active==false` and
  off-class campaigns. "Start Quiz" button is disabled outside the
  start/end window.
- Quiz overlay: multi-choice, score tracking, attempt logged to
  `/quiz_attempts`.
- **Admin panel** — Quiz Campaigns tab: create campaign with title,
  category, class level, start/end datetimes, active toggle, and a
  JSON questions array (`[{q, options:[...], a:0}]`). List shows
  campaigns + attempt counts; pause/resume/delete actions.

---

## Files

### New user modules (under `js/`)
- `study-tracker.js`
- `leaderboard.js`
- `schools.js`
- `class-community.js`
- `friends.js`
- `dm.js`
- `quiz.js`
- `note-share.js`
- `api-usage.js`

### Rewritten / updated user modules
- `voice.js` — robust lifecycle (see Phase 1).
- `focus-timer.js` — fires `focus-session-end` event for the tracker.
- `app.js` — wires every new module + boot-loading splash.
- `auth.js` — reads institution from the new dropdown, falls back to
  the request form's name when "Other" is picked.
- `ui.js` — wires the new "Share with friend" button on the note modal.

### New CSS
- `css/social.css` — leaderboard, friends, DMs, class community,
  quizzes, shared notes, boot loader, mic-listening pulse. All sections
  have `@media(max-width:768px)` rules so mobile is fully responsive.

### Admin updates
- `admin/admin.html` — Chart.js CDN, dashboard chart canvases, four new
  sections (Schools, Quizzes, Friends/DM Mod, Finance) + nav buttons.
- `admin/js/admin.js` — `loadDashboardCharts`, `loadSchools`,
  `loadSchoolRequests`, `loadQuizCampaigns`, `loadFriendsMod`,
  `loadFinance`, plus form bindings for adding schools/quizzes.

### Index changes
- New sidebar group "Social": Leaderboard, Class Community, Friends,
  Messages, Quizzes, Shared Notes.
- Mobile bottom-nav now exposes Rank + Friends.
- New section views for each of the above.
- New modals: `share-note-modal`, `quiz-overlay`.
- Boot-loading splash markup at the top.

### Firestore rules — `firestore.rules`
- New collections covered: `schools`, `school_requests`,
  `friend_requests`, `friendships`, `direct_messages`,
  `class_communities/{key}/{members,messages}`, `quiz_campaigns`,
  `quiz_attempts`, `study_logs`, `notices`,
  `users/{uid}/shared_with_me`, plus the `users/{uid}` doc itself
  is now publicly readable (signed-in only) so the leaderboard /
  classmate search works.
- The `shared_with_me` rule allows an outside user to drop a doc into
  their friend's path **only when** `request.resource.data.sharedByUid
  == request.auth.uid`. Both the recipient and the sharer can update
  the doc later (so the recipient can append blocks).

---

## Required follow-up actions for you

1. **Deploy `firestore.rules`** — paste into Firebase console →
   Firestore → Rules. The app will not function correctly until the
   new collections are accessible.
2. **(Optional) Pre-seed `/schools`** — the default Charghat school is
   already injected from the client. Add other institutions via the
   admin panel → Schools → Add.
3. **(Optional) Configure quiz campaigns** — admin panel → Quiz
   Campaigns. Use the JSON format `[{"q":"...","options":["A","B","C","D"],"a":0}]`.
4. **(Optional) Configure per-package DM limits** — edit your
   `/packages/{pkgId}` documents and add a `limits.dmDaily` numeric
   field (e.g. `50` for free, `1000` for pro). Currently the admin UI
   doesn't have a dedicated input for this; Firestore console works.
5. **ImgBB API key** — already configurable in App Settings → "imgbb
   API Key". Free tier from api.imgbb.com.

## Mobile responsive
Every new section has `@media(max-width:768px)` overrides in
`css/social.css`. The DM layout collapses to a horizontal pill bar on
mobile, the leaderboard hides the school column, and the chat shell
shrinks vertically. The bottom nav exposes Rank + Friends so the
gamified flows are reachable in one tap.

---

## Mobile UX update (round 2)

### Floating "+" note FAB
- New `note-fab` button bottom-left (above the bottom-nav). One tap
  switches to the Add Note section and focuses the title field. Works
  on every screen, fixes the broken "Add Note" path on mobile (which
  previously needed the desktop sidebar that's hidden on small screens).
- Draggable (mouse + touch) — position is persisted to localStorage so
  it stays where the user puts it across reloads / tab switches.

### Chat Hub (long-press chat-fab)
- Short tap on the chat-fab still opens the AI / Admin chat panel.
- Long-press (or right-click) opens a new "Chat Hub" bottom-sheet with
  six quick-jumps:
  - AI Chat
  - Admin Support
  - Class Community
  - Friends DM
  - Friends list
  - Shared Notes
- The chat-fab is now also draggable + sits 90px above the bottom-nav
  so it never overlaps mobile nav.

### Install / Download App pill
- Persistent floating pill at the bottom that uses the
  `beforeinstallprompt` event when supported (Chrome / Edge / Samsung
  Internet) and shows a one-tap "Install" button.
- iOS Safari fallback: tapping shows a toast explaining the
  Share → "Add to Home Screen" flow.
- Auto-hides for 24 hours when dismissed; re-appears every visit so
  users don't forget to install.
- Hidden once `display-mode: standalone` is detected (already
  installed).

### Mobile responsive pass
- New `css/mobile-ui.css`:
  - Larger tap targets (min 42px buttons, 48px nav items, 40px modal
    close).
  - Form inputs use `font-size:16px` on mobile so iOS doesn't
    auto-zoom on focus.
  - `content` gets `padding-bottom:120px` on mobile to clear the FABs.
  - Modals use `max-width:calc(100vw - 16px)` and scroll inside.
  - DM friend list collapses to a horizontal pill bar with rounded
    chips on phones.
  - Leaderboard hides school column on tiny screens.
  - Quiz options stack 1-per-row on phones.
- Both FABs and the install pill are hidden while the auth-gate or
  boot loader is visible, so they don't poke through the login screen.

### Files added/modified (round 2)
- **New:** `js/mobile-ui.js`, `css/mobile-ui.css`.
- **Updated:** `index.html` (added note-fab, chat-hub, install-pill
  markup; linked new CSS), `js/app.js` (initMobileUI()).
