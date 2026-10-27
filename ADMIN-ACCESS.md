# Admin access

How to give somebody admin rights, take them away, and what to check when it
does not seem to have worked.

## The model

Access lives in Firebase custom claims, not in a database document. Claims
arrive inside the ID token, so the security rules can check them without a
read, and nobody can edit their own.

| Claim | Means |
| --- | --- |
| `{ superAdmin: true }` | Every event, and may create or delete events |
| `{ admin: true, events: ['UMC2026'] }` | Only the events listed |

Per-event is the default on purpose: an organiser with access to one rally
should not be able to post to another by accident.

## Granting

```bash
cd ~/Projects/pbk/racewire/functions

# PRODUCTION
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-live-firebase-adminsdk-fbsvc-2fe7f8e24a.json \
  node scripts/grant-admin.mjs organiser@club.ug --event UMC2026

# STAGING
GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/racewire-stg-firebase-adminsdk-fbsvc-dc30c8a52f.json \
  node scripts/grant-admin.mjs organiser@club.ug --event UMC2026
```

| Flag | Effect |
| --- | --- |
| `--event CODE` | Admin for that event. Repeatable, and unions with existing grants, so adding a second event does not revoke the first |
| `--super` | Every event, plus creating and deleting them |
| `--revoke` | Removes `admin`, `superAdmin` and `events` |

Takes an email or a UID.

## The three things that catch people out

**The key file alone decides which project changes.** There is no `--project`
flag to cross-check against, so the staging key silently grants on staging.
The script prints the project and the action before doing anything — read that
line before letting it run.

**They must sign out and back in, inside the app.** `/admin` → Sign out, then
`/admin/login`. Not the Firebase console. Claims ride inside an ID token minted
at sign-in and cached for about an hour, so a grant cannot reach into a token
already issued. Somebody who has never signed in needs nothing; their first
token carries it.

**The person must already exist in Auth.** If they have never signed in, create
them first: Firebase console → Authentication → Users → Add user.

## When it does not work

| What the script says | What it means |
| --- | --- |
| `No user matching "…"` | They have never signed in. Create the user first |
| `Permission denied` | The service account lacks the Firebase Authentication Admin role |
| `was rejected by Google` | The key file is truncated, edited, or not a service account key. Download a fresh one |

If the script succeeded but the app still refuses them, they are almost
certainly holding an old ID token. Sign out and back in.

## Known gaps

**The deployed `grantAdmin` callable does not work**, in three separate ways:
it gates on `token.admin === true`, which a super admin does not have; it
calls `setCustomUserClaims` with only the new claim, replacing the rest; and
the claim it writes satisfies neither `manages()` in the rules nor
`canManageEvent()` in the client. Nothing calls it today, so it is harmless —
but do not wire a UI to it without fixing it first. The script is the only
working path.

**Grants are not audited.** The audit log under each event records what admins
did, not how they became one, and Firebase keeps no history of claim changes.
Writing a row from this script when it changes a claim is a small job and
would close the gap.
