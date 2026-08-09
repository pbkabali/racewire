#!/usr/bin/env node
/*
 * Grant or revoke the `admin` custom claim.
 *
 * Solves the bootstrap problem: the deployed `grantAdmin` callable requires an
 * existing admin, so the first one has to be created out of band.
 *
 * Lives here rather than in the repo-root scripts/ folder purely so that
 * `firebase-admin` resolves -- it is a dependency of functions/, not the app.
 *
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     node scripts/grant-admin.mjs you@example.com
 *
 *   ... --revoke   to take the claim away
 *
 * Accepts an email or a UID. The service account needs the Firebase
 * Authentication Admin role (the CI deployer key from step 6 has it).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const args = process.argv.slice(2)
const revoke = args.includes('--revoke')
const target = args.find((a) => !a.startsWith('--'))

if (!target) {
  console.error(`
Usage:
  cd functions
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \\
    node scripts/grant-admin.mjs <email-or-uid> [--revoke]
`)
  process.exit(1)
}

const projectId =
  process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? undefined

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
      'Point it at the service account JSON from step 6 of docs/firebase-setup.md.',
  )
  process.exit(1)
}

initializeApp({ credential: applicationDefault(), projectId })

const auth = getAuth()

try {
  // Look up by email first; fall back to treating the argument as a UID.
  const user = target.includes('@')
    ? await auth.getUserByEmail(target)
    : await auth.getUser(target)

  const claims = { ...(user.customClaims ?? {}) }
  if (revoke) {
    delete claims.admin
  } else {
    claims.admin = true
  }

  await auth.setCustomUserClaims(user.uid, claims)

  console.log(
    `${revoke ? 'Revoked' : 'Granted'} admin for ${user.email ?? user.uid} (uid ${user.uid})`,
  )
  console.log(
    '\nThey must sign out and back in -- custom claims only appear in a freshly\n' +
      'minted ID token, so an existing session keeps the old permissions.',
  )
} catch (error) {
  const code = error?.errorInfo?.code ?? error?.code ?? ''

  if (code === 'auth/user-not-found') {
    console.error(
      `No user matching "${target}".\n` +
        'Create one first: Firebase console -> Authentication -> Users -> Add user.',
    )
  } else if (code.includes('permission') || error?.code === 7) {
    console.error(
      'Permission denied. The service account needs the "Firebase Authentication Admin" role.',
    )
  } else {
    console.error(error?.message ?? error)
  }
  process.exit(1)
}
