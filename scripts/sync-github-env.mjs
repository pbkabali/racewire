#!/usr/bin/env node
/*
 * Push Firebase web config into a GitHub Actions environment.
 *
 *   node scripts/sync-github-env.mjs staging     .env.local
 *   node scripts/sync-github-env.mjs production  .env.production.local
 *
 * Why this exists: with two Firebase projects you collect the web config
 * twice, but only the staging values have a local home (.env.local, for
 * `npm run dev`). Production values are never used locally -- they exist
 * solely so CI can build a production bundle. Typing eight of them into the
 * GitHub UI is error-prone, and a single wrong character produces a deployed
 * app that silently talks to the wrong project.
 *
 * Sets VARIABLES only. The service account key is a real secret and stays a
 * manual step -- this script never touches secrets.
 *
 * Requires the gh CLI, authenticated with repo admin rights.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [envName, envFile] = process.argv.slice(2)

if (!envName || !envFile) {
  console.error(`
Usage:
  node scripts/sync-github-env.mjs <environment> <env-file>

Examples:
  node scripts/sync-github-env.mjs staging     .env.local
  node scripts/sync-github-env.mjs production  .env.production.local
`)
  process.exit(1)
}

const VITE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}

// ---- parse ---------------------------------------------------------------
let raw
try {
  raw = readFileSync(envFile, 'utf8')
} catch {
  console.error(`Cannot read ${envFile}.`)
  process.exit(1)
}

const env = {}
for (const line of raw.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  // Strip quotes people add out of habit; dotenv treats them as literal.
  env[t.slice(0, i).trim()] = t
    .slice(i + 1)
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
}

// ---- validate ------------------------------------------------------------
const problems = []
for (const key of VITE_KEYS) {
  if (!env[key]) problems.push(`${key} is missing or empty`)
}

const project = env.VITE_FIREBASE_PROJECT_ID
if (project) {
  if (env.VITE_FIREBASE_AUTH_DOMAIN && !env.VITE_FIREBASE_AUTH_DOMAIN.startsWith(`${project}.`)) {
    problems.push(
      `VITE_FIREBASE_AUTH_DOMAIN (${env.VITE_FIREBASE_AUTH_DOMAIN}) does not belong to ${project}`,
    )
  }
  if (
    env.VITE_FIREBASE_STORAGE_BUCKET &&
    !env.VITE_FIREBASE_STORAGE_BUCKET.startsWith(`${project}.`)
  ) {
    problems.push(
      `VITE_FIREBASE_STORAGE_BUCKET (${env.VITE_FIREBASE_STORAGE_BUCKET}) does not belong to ${project}`,
    )
  }
}

// Catches the classic copy-paste-from-the-other-project mistake.
if (
  env.VITE_FIREBASE_APP_ID &&
  env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
  !env.VITE_FIREBASE_APP_ID.startsWith(`1:${env.VITE_FIREBASE_MESSAGING_SENDER_ID}:`)
) {
  problems.push('VITE_FIREBASE_APP_ID does not embed VITE_FIREBASE_MESSAGING_SENDER_ID')
}

if (problems.length) {
  console.error(`Refusing to sync — ${envFile} looks wrong:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

// ---- confirm target ------------------------------------------------------
const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])

console.log(`repo:        ${repo}`)
console.log(`environment: ${envName}`)
console.log(`project:     ${project}`)
console.log('')

// Creating an environment is idempotent; PUT with no body leaves settings alone.
try {
  sh('gh', ['api', '--method', 'PUT', `repos/${repo}/environments/${envName}`, '--silent'])
} catch {
  console.error(`Could not create/confirm environment "${envName}". Check gh permissions.`)
  process.exit(1)
}

// ---- write ---------------------------------------------------------------
const toSet = {
  // The deploy step targets this explicitly rather than via .firebaserc.
  FIREBASE_PROJECT_ID: project,
  ...Object.fromEntries(VITE_KEYS.map((k) => [k, env[k]])),
}
if (env.VITE_FIREBASE_VAPID_KEY) {
  toSet.VITE_FIREBASE_VAPID_KEY = env.VITE_FIREBASE_VAPID_KEY
} else {
  console.log('note: no VAPID key set — in-browser push will be disabled for this environment\n')
}

for (const [name, value] of Object.entries(toSet)) {
  sh('gh', ['variable', 'set', name, '--env', envName, '--body', value])
  console.log(`  set ${name}`)
}

console.log(`
Done. Remaining manual step: the FIREBASE_SERVICE_ACCOUNT secret.

  gh secret set FIREBASE_SERVICE_ACCOUNT --env ${envName} < /path/to/github-deployer-key.json

Secrets are deliberately not handled here.`)
