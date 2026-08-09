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

Project IDs are globally unique, so `racewire-staging` may be taken. If you pick
different IDs, update `.firebaserc` to match.

```bash
npx firebase-tools login          # opens a browser
npx firebase-tools projects:create racewire-staging --display-name "Racewire (staging)"
npx firebase-tools projects:create racewire-prod    --display-name "Racewire"
```

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

Per project: console → gear → Project settings → **Your apps** → Web (`</>`) →
register. Copy the `firebaseConfig` values.

Also grab the push key: Project settings → **Cloud Messaging** → Web Push
certificates → **Generate key pair**. That is your `VITE_FIREBASE_VAPID_KEY`.

### Local development

```bash
cp .env.example .env.local
```

Fill it with the **staging** values. `.env.local` is gitignored — never commit
real values. (These are not secrets; they ship in the client bundle. Firestore
and Storage rules are what actually protect your data. But keeping staging and
production apart locally still matters.)

---

## 4. Deploy rules and indexes once, by hand

Do this before the first CI run so the app works the moment it is deployed.
The `notices` list query sorts on `pinned` then `publishedAt`, and without the
composite index the board returns an error rather than an empty state.

```bash
npx firebase-tools deploy \
  --only firestore:rules,firestore:indexes,storage \
  --project racewire-staging
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
npx firebase-tools functions:shell --project racewire-staging
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
rather than secrets, which keeps them readable and diffable):

| Name | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `racewire-staging` / `racewire-prod` |
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
npx firebase-tools functions:secrets:set WHATSAPP_TOKEN            --project racewire-prod
npx firebase-tools functions:secrets:set WHATSAPP_PHONE_NUMBER_ID  --project racewire-prod
npx firebase-tools functions:secrets:set TWILIO_ACCOUNT_SID        --project racewire-prod
npx firebase-tools functions:secrets:set TWILIO_AUTH_TOKEN         --project racewire-prod
npx firebase-tools functions:secrets:set TWILIO_FROM_NUMBER        --project racewire-prod
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

**Admin login succeeds but `/admin` says not authorised** — the claim is set but
the ID token predates it. Sign out and back in.
