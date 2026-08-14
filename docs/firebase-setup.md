# Firebase setup & deployment

Everything here is a one-time setup. Once done, pushing to `staging` or `main`
deploys automatically.

The repo already contains `firebase.json`, `firestore.rules`,
`firestore.indexes.json`, `storage.rules` and the Cloud Functions — you are
creating the projects those files deploy *into*, not writing any config.


## Contents

**One-time setup, in order.** Steps 0–9 take a project from nothing to
deploying. Miss one and the failure is usually indirect — a 403 about an API, a
PDF that will not open — so it is worth going in sequence.

| | Step | Needed for |
| --- | --- | --- |
| 0 | [Billing](#0-before-you-start-billing) | Storage and Functions at all |
| 1 | [Create the projects](#1-create-the-two-projects) | everything |
| 2 | [Budget alert](#2-budget-alert) | peace of mind |
| 3 | [Web app config](#3-register-the-web-app-and-collect-config) | the app connecting |
| 4 | [Rules and indexes](#4-deploy-rules-and-indexes-once-by-hand) | the board not erroring |
| 5 | [Service accounts](#5-service-accounts) | CI, and granting admin |
| 6 | [First admin](#6-create-the-first-admin) | reaching /admin |
| 7 | [GitHub environments](#7-github-environments) | auto-deploy |
| 8 | [Messaging secrets](#8-messaging-secrets-optional-when-ready) | optional; SMS/WhatsApp |
| ★ | [**Storage CORS**](#storage-cors--required-before-any-pdf-will-open) | **PDFs opening at all** |
| 9 | [Custom domain](#9-custom-domain-racewireapp-via-namecheap) | optional; a URL you own |

**Day to day**

- [How the pipeline behaves](#how-the-pipeline-behaves)
- [Creating events and admins](#creating-events-and-admins)
- [Copying an event to another project](#copying-an-event-to-another-project) — promote staging to production
- [Deleting a project](#deleting-a-project)
- [Troubleshooting](#troubleshooting)

Storage CORS is marked ★ rather than numbered because it is easy to reach the
end of the numbered steps with a working deploy and a broken document viewer.
A new bucket has no CORS policy, and nothing fails until someone opens a PDF.

---

## 0. Before you start: billing

**Firebase Storage and Cloud Functions require the Blaze (pay-as-you-go) plan.**
The free Spark plan cannot provision a Storage bucket or deploy functions at
all. That covers attachments, push fan-out, WhatsApp/SMS and the Sheets sync —
most of what makes this app more than a static page.

Blaze keeps the same free monthly allowances and only bills beyond them. For a
race-day noticeboard that is realistically pennies. Still, set a budget alert in
step 2 — an accidental infinite loop in a function is the one way to get a
surprise bill, and `maxInstances: 10` in `functions/src/index.ts` already caps
the blast radius.

---

## 1. Create the two projects

**Project IDs are permanent and globally unique.** Two consequences worth
understanding before you click anything:

- The console usually appends a random suffix (`racewire-live-eda04`) rather
  than granting the bare name. **The ID cannot be changed afterwards** — only
  the display name can. The ID is also your default hosting domain
  (`<project-id>.web.app`), so a suffixed production ID is user-visible unless
  you attach a custom domain.
- A deleted project does not release its ID for reuse. If you want a clean ID
  you must pick a different one, not delete and retry.

If you care about the production URL, either accept the suffix and plan on a
custom domain, or choose an ID distinctive enough to be granted outright.

Whatever IDs you end up with, put them in `.firebaserc` — the aliases there are
what `--project staging` and `--project production` resolve to.

```bash
npx firebase-tools login          # opens a browser
npx firebase-tools projects:create racewire-stg  --display-name "Racewire staging"
npx firebase-tools projects:create racewire-live --display-name "Racewire"
```

Display names allow only letters, numbers, spaces, hyphens, single quotes and
exclamation marks — **parentheses are rejected** with a rather unhelpful
`display_name has issue [contains invalid characters]`.

Prefer the CLI over the console here: if the ID is taken it **fails loudly**,
whereas the console silently appends a suffix and hands you a different ID than
the one you asked for.

Then record what you actually got:

```bash
npx firebase-tools projects:list        # confirm the real IDs
```

and put them in `.firebaserc`:

```json
{
  "projects": {
    "default": "racewire-stg",
    "staging": "racewire-stg",
    "production": "racewire-live"
  }
}
```

**Every command below uses `--project staging` / `--project production`** — the
aliases, not raw IDs. Passing a raw ID that is wrong produces a confusing
`Service Usage API has not been used in project ...` 403 rather than a clear
"no such project", because the CLI happily targets any Cloud project you can
see, Firebase-enabled or not.

For each project, in the [Firebase console](https://console.firebase.google.com):

1. **Upgrade to Blaze** — gear icon → Usage and billing → Modify plan.
2. **Firestore** → Create database → production mode → **`europe-west1`**.
3. **Storage** → Get started → **`europe-west1`**, the same region.

> **The Firestore location is permanent and cannot be changed later.** Get it
> right now; the only remedies afterwards are a second named database or a new
> project.
>
> `europe-west1` because the event is in East Africa: it is roughly 150ms closer
> than a US region, it is single-region so cheaper per operation than a
> multi-region like `nam5`, and it matches the functions region set in
> `functions/src/index.ts`. A Firestore trigger runs in the database's location,
> so a mismatch means every notice fan-out makes a cross-region hop.
>
> Storage goes in the same region for the same reason.
4. **Authentication** → Get started → enable **Email/Password**.
5. **Hosting** → Get started (you can skip the CLI instructions it shows).

---

## 2. Budget alert

Console → gear → Usage and billing → Details & settings → **Set budget alert**.
Pick a monthly figure you would want to hear about (even $5 works — the point is
the email, not the cap). Note this alerts, it does not stop spending; a hard cap
needs a Cloud Billing budget with a Pub/Sub kill-switch, which is overkill here.

---

## 3. Register the web app and collect config

### 3a. Get the config

Console → gear → **Project settings** → **General** tab → scroll to **Your
apps** → click the Web icon (`</>`) → register with a nickname (e.g. `racewire
web`). Skip the "Add Firebase SDK" snippet — the code is already written.

Under **SDK setup and configuration**, choose **Config**. You get this:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD-EXAMPLE-abc123",
  authDomain: "racewire-stg.firebaseapp.com",
  projectId: "racewire-stg",
  storageBucket: "racewire-stg.firebasestorage.app",
  messagingSenderId: "495883225823",
  appId: "1:495883225823:web:0a1b2c3d4e5f6789"
}
```

(If you already registered the app, it's on that same screen — you do not need
to register a second one.)

### 3b. Get the push key

Project settings → **Cloud Messaging** tab → **Web Push certificates** →
**Generate key pair**. Copy the long "Key pair" string.

This one is optional. Leave it blank and in-browser notifications are simply
disabled — the app checks for it and degrades cleanly. SMS and WhatsApp are
unaffected.

### 3c. Where the values go

You do this **twice**, once per project, and the two have different
destinations. This trips people up, so read the table before pasting anything:

| Project | Goes into | Why |
| --- | --- | --- |
| **staging** | `.env.local` **and** the GitHub `staging` environment | `.env.local` is what `npm run dev` reads, so staging is the project you develop against |
| **production** | the GitHub `production` environment **only** | you never run the app locally against production — there is deliberately no local file for it |

So for production there is nothing to paste into `.env.local`. Its values exist
only so CI can build a production bundle.

The easiest way to load either one is to put the values in a dotenv file and let
the script push them up:

```bash
# staging — the file you already have
node scripts/sync-github-env.mjs staging .env.local

# production — a scratch file, gitignored, delete it afterwards
cp .env.example .env.production.local     # fill with PRODUCTION values
node scripts/sync-github-env.mjs production .env.production.local
rm .env.production.local
```

The script refuses to write if the values are internally inconsistent — a
`storageBucket` from the wrong project, or an `appId` that does not embed the
sender ID. That mistake otherwise produces a deployed app that silently talks to
the wrong Firebase project, which is very hard to spot.

It sets variables only; the `FIREBASE_SERVICE_ACCOUNT` secret stays manual:

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT --env production \
  < ~/.secrets/racewire-live-deployer.json
```

### The names

Whether you edit a file or the GitHub UI, **the names differ from the JS keys** —
camelCase becomes `VITE_FIREBASE_` + SCREAMING_SNAKE:

| `firebaseConfig` key | `.env.local` variable |
| --- | --- |
| `apiKey` | `VITE_FIREBASE_API_KEY` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `VITE_FIREBASE_APP_ID` |
| *(Cloud Messaging tab)* | `VITE_FIREBASE_VAPID_KEY` |

Filled in, using the values above:

```dotenv
VITE_FIREBASE_API_KEY=AIzaSyD-EXAMPLE-abc123
VITE_FIREBASE_AUTH_DOMAIN=racewire-stg.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=racewire-stg
VITE_FIREBASE_STORAGE_BUCKET=racewire-stg.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=495883225823
VITE_FIREBASE_APP_ID=1:495883225823:web:0a1b2c3d4e5f6789
VITE_FIREBASE_VAPID_KEY=BFx...long-string-from-3b
VITE_USE_FIREBASE_EMULATORS=false
```

No quotes, no spaces around `=`, no trailing commas — this is a dotenv file, not
JavaScript.

`.env.local` takes the **staging** values, never production. It is gitignored;
never commit real ones. They are not secrets (they ship in the client bundle —
Firestore and Storage rules are what actually protect your data), but pointing
your dev server at production is how test notices end up on the live board.

### 3d. Check it worked

```bash
npm run dev
```

Open http://localhost:5399. If the config is wrong or incomplete the app throws
a startup error naming the missing keys — that is deliberate, not a bug. A
loading board with no error means it connected.

### 3e. Repeat for production

When you create the production project, come back and do 3a–3b again against
it: register a web app, generate its own VAPID key, then sync straight to
GitHub with no local file:

```bash
cp .env.example .env.production.local     # fill with PRODUCTION values
node scripts/sync-github-env.mjs production .env.production.local
rm .env.production.local
```

Each project has its own web app registration and its own VAPID key. Reusing
staging's is the single most common way to end up with a production site
writing into the staging database.

---

## 4. Deploy rules and indexes once, by hand

Do this before the first CI run so the app works the moment it is deployed.
The `notices` list query sorts on `pinned` then `publishedAt`, and without the
composite index the board returns an error rather than an empty state.

```bash
npx firebase-tools deploy \
  --only firestore:rules,firestore:indexes,storage \
  --project staging
```

The two composite indexes, since `firestore.indexes.json` is schema-validated
and cannot carry comments:

| Index | Serves |
| --- | --- |
| `notices` — `pinned` desc, `publishedAt` desc | the main board query in `useNotices()` |
| `notices` — `raceId` asc, `publishedAt` desc | notices filtered to a single race |

---

## 5. Service accounts

You need **two different** service accounts, and the consoles present them in
two different places, which is easy to conflate:

| Account | Where | Used for |
| --- | --- | --- |
| `firebase-adminsdk-…` (already exists) | Firebase console → Project settings → **Service accounts** | step 6 — calling Auth/Firestore as an admin |
| `github-deployer` (you create it) | Google Cloud console → **IAM & Admin → Service Accounts** | step 7 — CI deploys |

The Admin SDK account **cannot deploy** — it has no Hosting, Cloud Functions or
Artifact Registry permissions. The deployer account is a separate, revocable
identity, which is also why it is worth keeping them apart.

### 5a. Admin SDK key — for step 6

Firebase console → gear → **Project settings** → **Service accounts** tab →
**Firebase Admin SDK** → **Generate new private key**. A JSON downloads.

### 5b. Deployer account — for step 7

Google Cloud console → [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
(the **"N service accounts"** link on the Firebase page above goes straight
there):

1. **Create service account**, name it `github-deployer`.
2. Grant these roles:
   - `Firebase Admin` — hosting, rules, indexes
   - `Cloud Functions Admin` — deploy functions
   - `Service Account User` — lets it act as the functions runtime account
   - `Artifact Registry Writer` — functions v2 builds push a container image
   - `Cloud Scheduler Admin` — required by `syncSheetScheduled`, which is an
     `onSchedule` function and so owns a Cloud Scheduler job
3. Keys → **Add key** → JSON → download.

Miss one and the deploy fails partway: rules, indexes and hosting land, then
functions error. Firebase deploys targets in sequence, so a partial success is
normal for a permissions problem rather than an all-or-nothing rollback.

Repeat both for the production project when you create it.

### Handling the keys

These JSON files are real credentials — anyone holding one has full access to
that project. They match the `*serviceAccount*.json` and
`*-firebase-adminsdk-*.json` patterns in `.gitignore`, but do not keep them in
the repo directory at all. Put them somewhere like `~/.secrets/`, and delete the
deployer key once it is pasted into GitHub.

If one leaks, revoke it: Cloud console → the service account → Keys → delete the
key. That is instant and does not affect the project otherwise.

---

## 6. Create the first admin

Admin access is a custom claim on the user, not a Firestore document. The
deployed `grantAdmin` callable requires you to already be an admin, so the first
one has to be set out of band.

1. Console → **Authentication** → Users → **Add user** (your email + a password).
2. Grant the claim, using the **Admin SDK** key from 5a:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-adminsdk.json \
  node scripts/grant-admin.mjs you@example.com
```

Takes an email or a UID. `--revoke` takes the claim away again.

Then **sign out and back in** in the app. Custom claims are baked into the ID
token at sign-in, so an existing session keeps the old permissions until the
token is reissued.

### Do this once per project

Auth users are per-project. The same email in staging and production are two
unrelated accounts with separate UIDs, and a claim granted on one means nothing
on the other. So when you set up production, repeat both parts against it:

1. Console → **switch to the production project** → Authentication → Users →
   Add user.
2. Run the script with **production's** Admin SDK key:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-live-adminsdk.json \
  node scripts/grant-admin.mjs you@example.com
```

Note there is no `--project` flag — **the key file alone decides which project
is modified.** The script prints the project it resolved from the key before
doing anything, so check that line matches what you intended:

```
Project:  racewire-live
Action:   GRANT admin to you@example.com
```

> The obvious-looking `firebase functions:shell` route does **not** work for
> this: its REPL resolves modules from `<repl>` rather than the functions
> directory, so `require('firebase-admin')` throws `MODULE_NOT_FOUND`. Hence the
> script.

---

## 7. GitHub environments

Repo → Settings → **Environments** → create `staging` and `production`.

For **each** environment, add:

**Secret** (encrypted, never printed):

| Name | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | the entire contents of the **`github-deployer`** key from 5b — not the Admin SDK key, which cannot deploy |

**Variables** (public by design — they ship in the bundle, so they are variables
rather than secrets, which keeps them readable and diffable).

Use the **real project ID** here, not the `staging`/`production` alias. The
alias would resolve — `.firebaserc` is committed — but an explicit ID means the
environment states its own target rather than depending on a repo file staying
in sync with it:

| Name | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | the real ID, e.g. `racewire-stg` |
| `VITE_FIREBASE_API_KEY` | from step 3 |
| `VITE_FIREBASE_AUTH_DOMAIN` | from step 3 |
| `VITE_FIREBASE_PROJECT_ID` | from step 3 |
| `VITE_FIREBASE_STORAGE_BUCKET` | from step 3 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from step 3 |
| `VITE_FIREBASE_APP_ID` | from step 3 |
| `VITE_FIREBASE_VAPID_KEY` | from step 3 |

On the `production` environment, consider adding yourself under **Required
reviewers**. That turns a push to `main` into a deploy that waits for your
approval instead of going straight out.

---

## 8. Messaging secrets (optional, when ready)

**Skip this until you actually have a Twilio or WhatsApp account.** Nothing
below is needed to deploy; push notifications work without it, and SMS/WhatsApp
are skipped at runtime until configured.

Enabling a channel is **two steps**, and doing only the first has no effect.

### 8a. Create the secrets

They live in Google Secret Manager, not GitHub, because functions read them at
runtime:

```bash
npx firebase-tools functions:secrets:set TWILIO_ACCOUNT_SID   --project production
npx firebase-tools functions:secrets:set TWILIO_AUTH_TOKEN    --project production
npx firebase-tools functions:secrets:set TWILIO_FROM_NUMBER   --project production
# or, for WhatsApp:
npx firebase-tools functions:secrets:set WHATSAPP_TOKEN            --project production
npx firebase-tools functions:secrets:set WHATSAPP_PHONE_NUMBER_ID  --project production
```

This needs the **Secret Manager API** enabled on the project; the CLI will
offer to enable it.

### 8b. Bind them to the function

Creating a secret does not deliver it to your code. Edit
`functions/src/index.ts`:

```ts
import { defineSecret } from 'firebase-functions/params'

const messagingSecrets = [
  defineSecret('TWILIO_ACCOUNT_SID'),
  defineSecret('TWILIO_AUTH_TOKEN'),
  defineSecret('TWILIO_FROM_NUMBER'),
]
```

then deploy. The binding injects them into `process.env`, which is where
`functions/src/notify/providers/*.ts` read them.

> **Why this is not bound by default.** A bound secret is a *deploy-time*
> dependency — the CLI resolves it against Secret Manager before deploying, and
> a Firebase deploy is atomic. Declaring secrets that have never been created
> therefore fails the entire deploy, taking hosting and Firestore rules down
> with it. The site would be unable to ship until you had a Twilio account.
> Only bind secrets that exist.

For Sheets: share the spreadsheet (Viewer) with
`<project-id>@appspot.gserviceaccount.com`, enable the Sheets API on the
project, then set the `SHEET_ID` and `SHEET_RANGE` params.

---

## How the pipeline behaves

| Event | What happens |
| --- | --- |
| Any PR | Verify, then a Hosting-only preview URL commented on the PR, expiring in 7 days |
| Push to `staging` | Verify, then full deploy to `racewire-stg` |
| Push to `main` | Verify, then full deploy to `racewire-live` |

"Verify" is typecheck (app, service worker, node config and functions), lint,
the two-theme contrast audit, and a production build. Deploy jobs `needs:` it,
so a failing check blocks the deploy.

Full deploy covers hosting, Firestore rules, Firestore indexes, Storage rules
and functions.

Two deliberate choices worth knowing:

- **Previews deploy hosting only.** Rules, indexes, functions and Storage have
  no per-channel isolation — deploying them from a PR would mutate shared
  staging state, so a "preview" would silently change the environment it is
  previewing against.
- **Deploys do not cancel in progress.** Aborting mid-deploy can leave hosting
  and rules on different versions. Concurrent runs queue instead.

Each deploy job rebuilds rather than reusing the verify job's bundle, because
Vite inlines `VITE_*` values at build time — a bundle built with staging config
would point at staging no matter where it is deployed.

---

## Copying an event to another project

Promote an event you have set up and checked on staging:

```bash
cd functions
node scripts/copy-event.mjs UMC2026 \
  --from ~/.secrets/racewire-stg-firebase-adminsdk-<id>.json \
  --to   ~/.secrets/racewire-live-firebase-adminsdk-<id>.json \
  --dry-run
```

`--dry-run` first, always — it reports exactly what would be written and
changes nothing. Drop the flag to do it.

It copies the event document, its notices, races, folders and documents, **and
the Storage objects those documents point at**. That last part matters: a
document's `fileUrl` points at the source bucket, so a Firestore-only copy
leaves production serving files out of staging. It works until staging is
deleted or its rules change, and then every document 404s at once. Files are
re-uploaded to the destination bucket and the URLs rewritten.

| Flag | Effect |
| --- | --- |
| `--dry-run` | report only, write nothing |
| `--overwrite` | replace an event that already exists at the destination |
| `--no-files` | Firestore only, leaving URLs pointed at the source |

Two things it deliberately does **not** do:

- **Admin access does not travel.** Claims live on Auth users, which are
  per-project, so a copy grants nobody anything at the destination. A
  **superAdmin there already covers it** — that is granted once per project and
  applies to every event, including ones created later. Only a per-event
  organiser needs `grant-admin.mjs ... --event <CODE>`, and only once for that
  event.
- **`--overwrite` replaces documents by id; it does not delete.** Anything the
  destination has that the source lacks survives, so this cannot be used to
  make production an exact mirror.

---

## Emailing entry confirmations (SendGrid)

When an entry is submitted, `onEntrySubmitted` emails the entrant a copy with
the generated PDF attached, copying the crew. Until this is set up nothing is
sent and a warning is logged — the entry itself is unaffected.

**Why SendGrid.** Roughly 100 emails a day free, which covers a rally's entries
where Postmark's ~100 a *month* would not. Postmark has better transactional
deliverability if you outgrow the free tier and want to pay; Mailgun's free tier
has changed too often to build on. Check the current allowance on their pricing
page — these move.

### 1. Create the sender

1. Sign up at [sendgrid.com](https://sendgrid.com) and complete the account
   verification they ask for.
2. **Settings → Sender Authentication.** Two options:
   - **Domain authentication** (recommended): add the CNAME records they give
     you to Namecheap for `racewire.app`. Mail then comes from your own domain
     and lands in inboxes rather than spam.
   - **Single sender verification**: quicker, verifies one address by email. Fine
     for testing, noticeably worse deliverability.
3. **Settings → API Keys → Create API Key.** Restricted access, with **Mail
   Send** permission only. Copy it — it is shown once.

### 2. Store the key and the sender

```bash
npx firebase-tools functions:secrets:set SENDGRID_API_KEY --project staging
```

The from-address is not secret, so it goes in `functions/.env` alongside the
Sheets settings:

```
ENTRY_EMAIL_FROM=entries@racewire.app
ENTRY_EMAIL_FROM_NAME=Racewire
ENTRY_EMAIL_REPLY_TO=organiser@example.com
```

`ENTRY_EMAIL_FROM` **must be an address SendGrid has verified**, or every send
is rejected with a 403.

### 3. Bind the secret

Creating a secret does not deliver it to the function. In
`functions/src/index.ts`, on `onEntrySubmitted`:

```ts
import { defineSecret } from 'firebase-functions/params'
const sendgridKey = defineSecret('SENDGRID_API_KEY')

export const onEntrySubmitted = onDocumentUpdated(
  { document: 'events/{eventId}/entries/{entryId}', secrets: [sendgridKey] },
  ...
)
```

Then deploy. **Do not add it before the secret exists** — a bound-but-missing
secret is a deploy-time dependency and fails the whole deploy, hosting and rules
included.

### 4. Check it

Submit a test entry and watch the logs:

```bash
npx firebase-tools functions:log --only onEntrySubmitted --project staging
```

`entry confirmation sent` means it worked. A SendGrid 403 almost always means
the from-address is not verified; a 401 means the key is wrong.

---

## Storage CORS — required before any PDF will open

**Do this once per project.** A new bucket has no CORS configuration, and a
Firebase Storage download URL returns no `Access-Control-Allow-Origin` header
without one.

The failure is confusing because most things still work. A browser navigating
to the URL downloads it fine, and `<img>` renders images normally — neither
needs CORS. But anything reading the bytes with `fetch()` is blocked:

- the PDF viewer (pdf.js renders from an ArrayBuffer) → *"Could not display this
  PDF: Failed to fetch"*
- the Download button (fetches a blob so the app is not navigated away)

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-<deployer>.json \
  node scripts/set-storage-cors.mjs
```

Use the **`github-deployer`** key — it has `storage.buckets.update` through
Firebase Admin. The Admin SDK key does not. Repeat with the production key.

Verify:

```bash
curl -sI -H "Origin: https://example.com" "<a file download URL>" | grep -i access-control
```

`access-control-allow-origin: *` means it worked. The policy allows `GET`/`HEAD`
from any origin, which grants nothing new — these objects are already public by
the Storage rules, and CORS only decides whether JavaScript may read a response
it could already fetch by other means. Naming specific origins would also break
Hosting preview channels, whose URLs are generated per pull request.

---

## Creating events and admins

Two roles, deliberately different:

| Role | Claim | Can |
| --- | --- | --- |
| Super admin | `{ superAdmin: true }` | create and delete events, manage every event |
| Event admin | `{ admin: true, events: ['KRC26'] }` | manage only the listed events |

Creating an event provisions a namespace that other people get access to, so it
stays a super-admin action. An organiser in one country cannot post to another
country's event.

### 1. Make yourself a super admin

Only needed once per project. The Auth user must exist first —
console → **Authentication** → Users → **Add user**.

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-firebase-adminsdk-fbsvc-<id>.json \
  node scripts/grant-admin.mjs you@example.com --super
```

Use the **`firebase-adminsdk-…`** key, not the `github-deployer` one — the
deployer has no Authentication permissions. The script prints which project it
resolved from the key before acting; check that line.

Then sign in to the app at **`/admin/login`** — the app's own login page, not the
Firebase console. Use the email and password you set when adding the user.

If you were *already* signed in when the claim was granted, sign out first
(**`/admin`** → Sign out) and back in. Firebase issues an ID token at sign-in
carrying a snapshot of your claims, cached for about an hour; granting a claim
afterwards cannot reach back into a token that has already been issued. If you
have never signed in, there is nothing to do — your first token has it.

### 2. Create the event

Go to **`/admin`**. As a super admin you get a *Create an event* form:

| Field | Notes |
| --- | --- |
| Short code | Becomes the document id and the URL (`/e/KRC26`). **Permanent** — the form refuses a code that already exists, because saving over one would silently re-home every notice and document under it. |
| Name, country, sport | Shown on the picker and the event header |
| Status | `live` gets a pulsing badge and sorts to the top of the picker |
| Dates | Same start and end for a single-day event |
| Logo | Optional; the picker falls back to the first three letters of the code |

The event appears at `/e/<CODE>` immediately.

### 3. Give an organiser access to that event

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-firebase-adminsdk-fbsvc-<id>.json \
  node scripts/grant-admin.mjs organiser@club.ke --event KRC26
```

`--event` repeats for several events. Grants **union** with what the user
already has, so adding a second event does not revoke the first. `--revoke`
removes all admin access.

They then see only their events at `/admin`, and a **Manage** link on the event
itself.

### Production

Identical, with the `racewire-live` Admin SDK key. Auth users are per-project:
the same email on staging and production are unrelated accounts with different
UIDs and independent claims, so this has to be done twice.

---

## 9. Custom domain (racewire.app, via Namecheap)

Production only. Staging stays on `racewire-stg.web.app` — a custom domain there
buys nothing.

The app itself needs no changes: every URL in it is relative and the PWA
manifest uses `start_url: '/'`, so it works under any origin.

### 9a. Clear Namecheap's defaults first

Namecheap → Domain List → **Manage** → **Advanced DNS**.

A new domain ships with parking records that will fight Firebase. Delete:

- the `CNAME` record for `www` pointing at `parkingpage.namecheap.com`
- any **URL Redirect Record** on `@`

Also confirm the **Nameservers** dropdown (Domain tab) is set to **Namecheap
BasicDNS**. If it points at custom nameservers, the Advanced DNS tab is ignored
entirely and nothing you add there takes effect.

While setting up, set **TTL** to `1 min` on the records you add. You can raise it
to Automatic once everything resolves; a 30-minute TTL turns every mistake into
a 30-minute wait.

### 9b. Add the domain in Firebase

Firebase console → **`racewire-live`** → **Hosting** → **Add custom domain** →
`racewire.app`. Tick "redirect to another domain" only if you want the apex to
redirect; for this app, serve on the apex.

Firebase gives you a **TXT record** for ownership. In Namecheap Advanced DNS →
**Add New Record**:

| Type | Host | Value |
| --- | --- | --- |
| TXT Record | `@` | the string Firebase shows |

Back in Firebase, click **Verify**. This usually takes minutes; Namecheap
propagates quickly with a low TTL.

### 9c. Point the domain at Firebase

**Quick setup lists the A record alongside the TXT**, so you add both in one go
and there is no separate step here — the console does not reveal the A record
only after verifying. Older guides (including an earlier version of this one)
describe a two-phase flow that no longer matches the UI.

Use the value from *your* console; it is not universal, and Firebase currently
issues a single A record rather than the pair older documentation mentions:

| Type | Host | Value |
| --- | --- | --- |
| A Record | `@` | the IP Firebase shows |

Namecheap has no ALIAS/ANAME at the apex, which is why Firebase issues an A
record rather than a CNAME.

Verification is not instant even once DNS is correct: Firebase caches its own
lookups independently of your TTL, so "Records not yet detected" can persist for
tens of minutes after `dig` shows everything published. Confirm with

```bash
dig +short A racewire.app @8.8.8.8
dig +short TXT racewire.app @8.8.8.8
```

and if both are right, wait rather than changing anything. Re-adding correct
records only restarts the clock.

### Redirecting www to the apex

Add `www.racewire.app` as a **second custom domain** in Firebase and choose the
**redirect** option targeting `racewire.app` — not "connect", which would serve
the same site on both and split your URLs. Then add the record Firebase gives
you with Host `www`.

**Do not use Namecheap's URL Redirect Record for this.** It is the obvious
option in Advanced DNS and it cannot work on a `.app` domain: `.app` is
HSTS-preloaded, so browsers will only ever attempt HTTPS to `www.racewire.app`,
and Namecheap's redirector has no valid certificate for your domain. The
browser aborts on a certificate error before any redirect happens, so visitors
see a security warning rather than being forwarded.

Firebase issues a real certificate for `www` and serves a 301 to the apex,
which is why it is the only route that works here.

### 9d. Add the domain to Auth — do not skip this

Firebase console → **Authentication** → **Settings** → **Authorized domains** →
**Add domain** → `racewire.app` (and `www.racewire.app` if used).

Miss it and the site loads fine but **admin sign-in fails** with
`auth/unauthorized-domain`. The board works, so it looks healthy until an
organiser tries to log in — which is exactly when you least want to find out.

### 9e. Expect a certificate wait — and a scary-looking gap

`.app` is an **HSTS-preloaded TLD**: browsers refuse plain HTTP to it, always.
So between DNS resolving and Firebase issuing your certificate, `racewire.app`
does not show a "not found" page — it shows a **security warning**. That is
normal and not a misconfiguration.

Provisioning is usually under an hour and can take up to 24. `racewire-live.web.app`
keeps serving throughout, so there is no outage; just do not print the custom
domain on anything until you have loaded it yourself.

Check progress:

```bash
dig +short racewire.app
curl -sI https://racewire.app | head -3
```

---

## Deleting a project

There is no CLI command — `firebase projects:` offers only `create`,
`addfirebase` and `list`. Deletion is console-only.

**Check nothing still points at it first.** A deleted project cannot be
recovered after 30 days, and its ID is never reusable, so a missed reference
cannot be fixed by recreating it:

```bash
grep -rn '<old-project-id>' --include='*.json' --include='*.yml' --include='*.ts' . | grep -v node_modules
cat .firebaserc
gh variable list --env staging     # and --env production
```

Then: [Firebase console](https://console.firebase.google.com) → the project →
gear → **Project settings** → General → scroll to the bottom → **Delete
project**. You must type the project ID to confirm.

A project with no Firebase attached — for example a bare Cloud project left
behind by a failed `projects:create` — will not appear in the Firebase console.
Delete those from [Cloud Resource Manager](https://console.cloud.google.com/cloud-resource-manager)
instead: tick it → **Delete**.

What deletion does:

- Everything inside goes with it — Firestore data, Storage objects, deployed
  functions, hosting releases, Auth users, service accounts and their keys.
  Billing for the project stops.
- It is a **30-day soft delete**. The project sits in "pending deletion" and can
  be restored from Cloud Resource Manager during that window, which is your
  safety net if you delete the wrong one.
- After 30 days it is irreversible, and **the ID is never released for reuse**
  even then.

Delete the local service account keys for that project too — they are useless
once it is gone, but they are still credentials until the project dies:

```bash
rm -P ~/.secrets/<old-project>-*.json
```

---

## Troubleshooting

**`Failed to add Firebase to Google Cloud Platform project`, with a 403
`PERMISSION_DENIED` on `:addFirebase` in `firebase-debug.log`** — the GCP
project was created but Firebase could not be attached. On an account that has
never used Firebase before, this is the Firebase Terms of Service never having
been accepted and the Firebase Management API never having been enabled;
neither is something the CLI can do. Retrying `projects:addfirebase` will keep
failing.

Fix it in the browser: [console.firebase.google.com](https://console.firebase.google.com)
→ **Create a project** → in the name box, open the dropdown and select the
**existing** Cloud project → accept the terms → finish. It is per-account, so
once one project has been through the console, the CLI works for the rest.

Check `npx firebase-tools projects:list` first — if it says "No projects found"
while a Cloud project clearly exists, this is the cause rather than a quota
limit.

**`HTTP Error: 403, Permission denied`** — the service account is missing a
role from step 5b. Functions v2 in particular needs Artifact Registry Writer.

**`lacks IAM permission "cloudscheduler.jobs.update"`** — `github-deployer` is
missing `Cloud Scheduler Admin`. `syncSheetScheduled` is an `onSchedule`
function, so deploying it creates and updates a Cloud Scheduler job, which
Cloud Functions Admin does not cover. Add the role in Cloud console → IAM, then
re-run the workflow; no code change is needed.

**`Cloud Functions deployment requires the Cloud Build API to be enabled. The
current credentials do not have permission to enable APIs`** — expected on the
first CI deploy of a project, and it aborts the whole command, so hosting and
rules do not deploy either.

Cloud Functions v2 needs several APIs that a brand-new project does not have on.
The CLI tries to enable them, but `github-deployer` deliberately lacks the
`Service Usage Admin` role needed to do that — you do not want CI able to turn
on arbitrary billable APIs.

Enable them once per project, as the project owner:

```bash
npx firebase-tools deploy --only functions --project staging
```

Your own account is an owner, so the CLI enables the APIs and completes the
deploy. Afterwards CI can deploy functions on its own, because the APIs are
already on. Repeat with `--project production`.

If you would rather click, enable these in the Cloud console API library for
each project — `cloudbuild`, `cloudfunctions`, `artifactregistry`, `run`,
`eventarc`, `pubsub`.

The alternative — granting `github-deployer` the `Service Usage Admin` role —
works but widens CI's blast radius permanently to fix a one-time setup step.

**Board shows an error instead of notices** — the composite index is missing.
Run step 4.

**`We failed to modify the IAM policy for the project`** during a functions
deploy — Cloud Functions v2 needs service-agent bindings that a new project
lacks: Pub/Sub must mint tokens for `onSchedule`, and Eventarc must receive and
invoke for the Firestore trigger.

First check you are not accidentally deploying as a service account:

```bash
echo "$GOOGLE_APPLICATION_CREDENTIALS"
```

If that prints a path — likely left exported from step 6 — firebase-tools is
using it instead of your login, and no Admin SDK key can edit IAM. `unset` it
and retry; as project Owner the CLI grants the bindings itself.

If it is empty, grant them by hand. The CLI prints the exact `gcloud` commands;
`brew install --cask google-cloud-sdk` if you do not have it. Or in the Cloud
console → IAM & Admin → IAM → Grant access, on the project:

| Principal | Role |
| --- | --- |
| `service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` | Service Account Token Creator |
| `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` | Cloud Run Invoker |
| `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` | Eventarc Event Receiver |

Tick **Include Google-provided role grants** or the service agents are hidden.

This is one-time per project, and deliberately not something CI can do —
`github-deployer` has no IAM-policy rights, and should not.

**`Secret Manager API has not been used in project ... 403`, or `secret
TWILIO_… does not exist`, during a deploy** — a `defineSecret()` param is bound
to a function but the secret has never been created. Declared secrets are
deploy-time dependencies, so this fails the whole deploy including hosting and
rules. Either create the secret (step 8a) or remove it from `messagingSecrets`
in `functions/src/index.ts`. Out of the box that list is empty precisely so a
fresh project can deploy with no messaging accounts.

**`Service Usage API has not been used in project <id> before or it is
disabled`** — almost always the wrong project, not a disabled API. The CLI will
target any Cloud project your account can see, including one with no Firebase on
it, and the resulting 403 names the API rather than the real problem. Check
against `npx firebase-tools projects:list` and prefer `--project staging` /
`--project production` over typing an ID. If the ID really is right, the link in
the error does enable the API.

**`functions/lib/index.js does not exist`** — the functions TypeScript has not
been compiled. `firebase.json`'s `predeploy` hook builds on deploy, but
`functions:shell` and the emulators do not run it:

```bash
npm --prefix functions run build
```

**`Cannot find module 'firebase-admin'` inside `functions:shell`** — expected;
the REPL resolves modules from `<repl>`, not from `functions/`. Use
`functions/scripts/grant-admin.mjs` (step 6) rather than the shell.

**Renaming a project** — the Firebase CLI cannot do it; `projects:` only offers
`create`, `addfirebase` and `list`. Change the *display name* in console →
Project settings → pencil icon. The *project ID* can never be changed.

**Console created a new project instead of attaching to an existing Cloud
project** — check `npx firebase-tools projects:list` and compare the ID against
what you expected. If it gained a suffix, the console made a fresh project and
your original bare Cloud project is now an unused orphan. Update `.firebaserc`
to the real ID, and delete the orphan in the Cloud console to avoid confusion.

**Admin login succeeds but `/admin` says not authorised** — the claim is set but
the ID token predates it. Sign out and back in.
