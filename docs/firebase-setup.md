# Firebase setup & deployment

Everything here is a one-time setup. Once done, pushing to `staging` or `main`
deploys automatically.

The repo already contains `firebase.json`, `firestore.rules`,
`firestore.indexes.json`, `storage.rules` and the Cloud Functions — you are
creating the projects those files deploy *into*, not writing any config.

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

- The console usually appends a random suffix (`racewire-prod-eda04`) rather
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
    "default": "racewire-staging-eda04",
    "staging": "racewire-staging-eda04",
    "production": "racewire-prod"
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
  authDomain: "racewire-staging-eda04.firebaseapp.com",
  projectId: "racewire-staging-eda04",
  storageBucket: "racewire-staging-eda04.firebasestorage.app",
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
  < ~/.secrets/racewire-prod-deployer.json
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
VITE_FIREBASE_AUTH_DOMAIN=racewire-staging-eda04.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=racewire-staging-eda04
VITE_FIREBASE_STORAGE_BUCKET=racewire-staging-eda04.firebasestorage.app
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
3. Keys → **Add key** → JSON → download.

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
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-staging-adminsdk.json \
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
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-prod-adminsdk.json \
  node scripts/grant-admin.mjs you@example.com
```

Note there is no `--project` flag — **the key file alone decides which project
is modified.** The script prints the project it resolved from the key before
doing anything, so check that line matches what you intended:

```
Project:  racewire-prod
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
| `FIREBASE_PROJECT_ID` | the real ID, e.g. `racewire-staging-eda04` |
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
| Push to `staging` | Verify, then full deploy to `racewire-staging` |
| Push to `main` | Verify, then full deploy to `racewire-prod` |

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
role from step 6. Functions v2 in particular needs Artifact Registry Writer.

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
