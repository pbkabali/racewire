# racewire

One stop noticeboard for a racing event.

A mobile-first PWA that keeps working when the signal does not — spectators and
marshals see notices, the schedule and alerts from a local cache, and organisers
can post updates trackside even with no connection.

## Stack

**Multi-event.** Every screen is scoped to an event. `/` is a picker; everything
public lives under `/e/<CODE>/…`, where the code is the Firestore document id,
the URL segment and the unique key all at once. The `/e/` prefix permanently
reserves the root namespace so an event code can never collide with `/admin`.

Event-owned data lives in subcollections (`events/{code}/documents`), so a
security rule scopes to one event by path and a query cannot return another
event's data. Admin rights are per-event custom claims — see
`functions/scripts/grant-admin.mjs`.

| Layer | Choice |
| --- | --- |
| App | React 19 + TypeScript, Vite 8 (SPA) |
| Styling | Tailwind CSS v4, semantic tokens over a swappable palette |
| Data | Firestore with persistent multi-tab offline cache |
| Files | Firebase Storage, pdf.js for in-app PDF viewing |
| Auth | Firebase Auth, admin gated by a custom claim |
| Push | Firebase Cloud Messaging |
| Backend | Cloud Functions (Node 22, v2 API) |
| Hosting | Firebase Hosting |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web app config
npm run dev
```

The app throws a clear error on startup if the Firebase config is missing —
that is deliberate, not a bug.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server, service worker enabled |
| `npm run build` | Typecheck (`tsc -b`) then production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | oxlint |
| `npm run check:contrast` | WCAG audit of both themes — run after any colour change |

## Layout

```
src/
  app/            router, route protection, auth provider
  components/     shared UI + layout shell
  features/
    events/       event picker, event layout, shared event types
    notices/      the board itself
    races/        schedule, fed from Google Sheets
    documents/    public list + admin upload, single-level folders
    results/      placeholder until timing integration
    admin/        login, event list, per-event dashboard (lazy-loaded)
    _archived/    parked features, excluded from the build
  lib/firebase/   app, auth, db, messaging
  sw.ts           service worker: precache + FCM background handler
functions/
  src/notify/     channel-agnostic dispatch + providers
  src/sheets/     Sheets -> Firestore sync
```

## How the main requirements are met

**Offline first.** Firestore runs with `persistentLocalCache` and a multi-tab
manager, so reads resolve from IndexedDB and writes queue locally, flushing when
the network returns. The service worker precaches the app shell and serves it for
any navigation, so deep links open cold with no connection. Publishing a notice
offline is not awaited — it lands locally at once and syncs later.

**Mobile focused.** Bottom tab bar within thumb reach on phones, promoted to a
top bar from `sm` up. Safe-area insets are respected for notched devices.

**Notifications.** `functions/src/notify` defines one `NotificationProvider`
interface with three adapters. FCM works today. WhatsApp (Meta Cloud API) and
SMS (Twilio) are written but inactive until their secrets are set — see below.

**Protected admin.** Admin rights are per-event custom claims:
`{ superAdmin: true }` for everything, or `{ admin: true, events: ['KRC26'] }`
for named events. `ProtectedRoute` checks the claim covers the specific event in
the URL, not merely that the user is an admin somewhere. That gate is for
usability only — `firestore.rules` and `storage.rules` enforce the same claims
server-side.

**Documents.** Per event, grouped into single-level folders, each carrying a
document number, name, date and optional note. Public to read and download,
publishable only by that event's admins. Deleting removes the Storage object
before the Firestore record: if that fails the document stays visible, which is
recoverable, whereas the reverse orphans a file with nothing pointing at it.

**Google Sheets.** `syncSheetScheduled` pulls the sheet every 15 minutes and
`syncSheetNow` is a callable for on-demand refresh. Firestore stays the single
source the app reads, which is what preserves offline and realtime behaviour.

**Files.** Images and PDFs attach to a notice, upload with a progress bar, and
open in-app — images in a lightbox, PDFs rendered by pdf.js. pdf.js rather than
an `<iframe>` because iOS Safari and Chrome on Android routinely refuse to
display a PDF inline and force a download instead, which would defeat the point.
The viewer chunk is lazy-loaded, so only people who open a PDF pay for it.
Attachments viewed once are cached by the service worker (50 files / 30 days),
since Firestore's persistence covers documents only and would otherwise leave a
course map unreachable exactly when the app is still working offline.

Uploads are the one thing that genuinely needs a connection — Storage has no
offline write queue, unlike Firestore. The uploader says so when offline.

**Theme.** Black ground, yellow as primary accent (readable in direct sunlight),
red reserved for genuine urgency so it keeps its meaning. Light, dark and system,
with the choice persisted and applied before first paint by a small inline script
in `index.html` — React runs after the document paints, so it cannot prevent a
flash of the wrong theme on its own.

### Rebranding

Edit **`src/styles/palette.css`** and nothing else. It holds every raw colour:
the accent, the danger hue, and one neutral ramp that light and dark read from
opposite ends. Components reference semantic roles (`bg-surface`, `text-fg`,
`text-accent-text`, `bg-danger`), never raw values, so no component changes when
the brand does. `src/styles/theme.css` maps raw values onto roles per theme —
touch it only to change how a role behaves, not to change a colour.

Then run `npm run check:contrast`. Two traps it exists to catch: a colour that
passes against the page but fails against the slightly darker card surface, and
one that reads fine in dark mode but not light. Both were real during this
build. Note `--brand-accent-deep`, a darker cut of the accent used for
accent-coloured *text* in light mode, because full-strength yellow on white
fails AA badly.

## Firebase setup & deployment

**→ Full step-by-step guide: [docs/firebase-setup.md](docs/firebase-setup.md)**

Two projects (`racewire-stg`, `racewire-live`), with GitHub Actions
deploying on push:

| Event | Result |
| --- | --- |
| Any PR | Verify + Hosting-only preview URL, expires in 7 days |
| Push to `staging` | Verify + full deploy to staging |
| Push to `main` | Verify + full deploy to production |

Note **Blaze plan is required** — Storage and Cloud Functions cannot be
provisioned on the free Spark plan.

### Quick reference

```bash
npx firebase-tools deploy \
  --only hosting,firestore:rules,firestore:indexes,storage \
  --project staging
```

The `notices` list query sorts on `pinned` then `publishedAt`, so the composite
index in `firestore.indexes.json` must be deployed or the board returns an error.

### Admin access

Claims are set out of band; the deployed `grantAdmin` callable needs a caller
who is already an admin.

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-adminsdk.json \
  node scripts/grant-admin.mjs you@example.com --super
  # or --event KRC26 --event UGR26 for a single organiser
```

The key file alone decides which project is changed, so the script prints the
project before acting. Claims only appear in a freshly minted ID token — sign
out and back in.

### Messaging providers

```bash
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_FROM_NUMBER
```

Creating a secret is only half of it: it must also be added to
`messagingSecrets` in `functions/src/index.ts` to be injected. That list is
empty by default on purpose — a bound secret is a *deploy-time* dependency, so
declaring one that does not exist fails the entire deploy, hosting and rules
included. Until a channel is bound, its provider reports `isConfigured()` false
and dispatch skips it.

Note WhatsApp's 24-hour rule: business-initiated messages must use a template
approved in Meta Business Manager (`racewire_alert`), not free text.

### Sheets access

Share the spreadsheet (Viewer is enough) with the functions service account,
`<project-id>@appspot.gserviceaccount.com`, enable the Sheets API, then set:

```bash
firebase functions:config:set   # or use params:
# SHEET_ID     spreadsheet id from the URL
# SHEET_RANGE  default "Races!A1:E"
```

Expected header row: `id, name, category, startsAt, status`.

## Known gaps

- Not connected to a Firebase project yet; `.env.local` must be filled in.
- WhatsApp and SMS adapters are written but untested against live accounts.
- The entry bundle is ~287 KiB gzipped, dominated by the Firebase SDK. The pdf.js
  viewer is a further ~123 KiB gzipped but loads only when a PDF is opened.
  Acceptable because the service worker precaches the entry once, but worth
  splitting further if first load on 2G matters.
- Attachments are removed from a notice in the composer but the underlying
  Storage object is not deleted, so abandoned uploads accumulate. A cleanup
  function over orphaned objects is not written yet.
- No test suite yet.
