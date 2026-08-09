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
import { readFileSync } from 'node:fs'

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

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!keyPath) {
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
      'Point it at the Admin SDK key for the project you mean to change\n' +
      '(step 5a of docs/firebase-setup.md).',
  )
  process.exit(1)
}

/*
 * The key file alone decides which project is modified -- there is no --project
 * flag to cross-check against. With separate staging and production projects
 * that is a real hazard: the wrong key silently grants admin on the wrong
 * environment. So state the target plainly before doing anything.
 */
let projectId
try {
  projectId = JSON.parse(readFileSync(keyPath.replace(/^~/, process.env.HOME ?? '~'), 'utf8'))
    .project_id
} catch {
  console.error(`Cannot read or parse the key file at ${keyPath}.`)
  process.exit(1)
}

if (!projectId) {
  console.error(`${keyPath} has no project_id — is it a service account key?`)
  process.exit(1)
}

console.log(`Project:  ${projectId}`)
console.log(`Action:   ${revoke ? 'REVOKE admin from' : 'GRANT admin to'} ${target}\n`)

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
  } else if (/OAuth2 access token|DECODER routines|invalid_grant/.test(error?.message ?? '')) {
    console.error(
      `The key at ${keyPath} was rejected by Google.\n` +
        'Usually it is truncated, edited, or not a service account key at all.\n' +
        'Download a fresh one: Firebase console -> Project settings -> Service accounts\n' +
        '-> Generate new private key.',
    )
  } else {
    console.error(error?.message ?? error)
  }
  process.exit(1)
}
