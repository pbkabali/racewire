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
npx firebase-tools projects:create <your-id> --display-name "Racewire (staging)"
npx firebase-tools projects:create <your-id> --display-name "Racewire"
```

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
2. **Firestore** → Create database → production mode → pick a region close to
   the event. *The region is permanent.*
3. **Storage** → Get started → same region.
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

### 3c. Paste it into `.env.local`

Create the file if it isn't there yet (`cp .env.example .env.local`), then map
the values across. **The names differ from the JS keys** — camelCase becomes
`VITE_FIREBASE_` + SCREAMING_SNAKE:

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

Use the **staging** values here. `.env.local` is gitignored; never commit real
ones. They are not secrets (they ship in the client bundle — Firestore and
Storage rules are what actually protect your data), but keeping staging and
production apart locally still matters.

### 3d. Check it worked

```bash
npm run dev
```

Open http://localhost:5399. If the config is wrong or incomplete the app throws
a startup error naming the missing keys — that is deliberate, not a bug. A
loading board with no error means it connected.

### 3e. The same values go to GitHub later

Step 7 puts these into GitHub **variables** so CI can build with them, once per
environment, plus one extra (`FIREBASE_PROJECT_ID`) that the deploy step uses to
target the right project. Keep this config to hand — you will paste it twice.

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

## 5. Create the first admin

`grantAdmin` requires an existing admin, so the first one has to be granted out
of band.

1. Console → Authentication → Users → **Add user** (your email + a password).
2. Copy the resulting **User UID**.
3. Grant the claim:

```bash
npx firebase-tools functions:shell --project staging
# then, at the prompt:
> require('firebase-admin').auth().setCustomUserClaims('<UID>', { admin: true })
```

Sign out and back in in the app — custom claims only refresh on a new ID token.

---

## 6. Service account for CI

GitHub Actions needs credentials that are not your personal login.

Per project, in the [Google Cloud console](https://console.cloud.google.com/iam-admin/serviceaccounts):

1. **Create service account**, name it `github-deployer`.
2. Grant these roles:
   - `Firebase Admin` — hosting, rules, indexes
   - `Cloud Functions Admin` — deploy functions
   - `Service Account User` — lets it act as the functions runtime account
   - `Artifact Registry Writer` — functions v2 builds push a container image
3. Keys → **Add key** → JSON → download.

That JSON is a real credential. It is matched by the `*serviceAccount*.json` and
`*-firebase-adminsdk-*.json` patterns in `.gitignore`, but do not keep it in the
repo directory at all — paste it into GitHub and delete the file.

---

## 7. GitHub environments

Repo → Settings → **Environments** → create `staging` and `production`.

For **each** environment, add:

**Secret** (encrypted, never printed):

| Name | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON file contents |

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

## 8. Messaging and Sheets secrets (optional, when ready)

These live in Firebase, not GitHub, because functions read them at runtime:

```bash
npx firebase-tools functions:secrets:set WHATSAPP_TOKEN            --project production
npx firebase-tools functions:secrets:set WHATSAPP_PHONE_NUMBER_ID  --project production
npx firebase-tools functions:secrets:set TWILIO_ACCOUNT_SID        --project production
npx firebase-tools functions:secrets:set TWILIO_AUTH_TOKEN         --project production
npx firebase-tools functions:secrets:set TWILIO_FROM_NUMBER        --project production
```

Each provider reports `isConfigured()` false until its secrets exist, and
dispatch skips it — nothing breaks while they are unset.

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

**Functions deploy fails on first run** — the project needs the Cloud Build and
Artifact Registry APIs enabled. Deploying once from your own machine
(`npx firebase-tools deploy --only functions`) prompts to enable them; after
that CI works.

**Board shows an error instead of notices** — the composite index is missing.
Run step 4.

**`Service Usage API has not been used in project <id> before or it is
disabled`** — almost always the wrong project, not a disabled API. The CLI will
target any Cloud project your account can see, including one with no Firebase on
it, and the resulting 403 names the API rather than the real problem. Check
against `npx firebase-tools projects:list` and prefer `--project staging` /
`--project production` over typing an ID. If the ID really is right, the link in
the error does enable the API.

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
