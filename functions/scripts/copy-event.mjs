#!/usr/bin/env node
/*
 * Copy one event, and everything under it, from one project to another.
 *
 *   cd functions
 *   node scripts/copy-event.mjs UMC2026 \
 *     --from ~/.secrets/racewire-stg-firebase-adminsdk-....json \
 *     --to   ~/.secrets/racewire-live-firebase-adminsdk-....json
 *
 *   --dry-run     report what would happen, change nothing
 *   --overwrite   replace an event that already exists at the destination
 *   --no-files    Firestore only, leaving file URLs pointing at the source
 *
 * Copies the event document, its notices, races, folders and documents, AND
 * the Storage objects those documents reference.
 *
 * The files matter. A document's fileUrl points at the source bucket, so a
 * Firestore-only copy leaves production serving files out of staging: it works
 * until staging is deleted or its rules change, then every document 404s at
 * once. So each object is re-uploaded to the destination bucket and the URLs
 * are rewritten.
 *
 * Firebase download URLs are not something the Admin SDK hands back. They are
 * assembled from a token stored in object metadata as
 * `firebaseStorageDownloadTokens`, which is what this sets and then formats.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const SUBCOLLECTIONS = ['notices', 'races', 'folders', 'documents']

// ---- arguments ---------------------------------------------------------
const args = process.argv.slice(2)

/*
 * Walked rather than searched, so a value that happens to look like the event
 * code (a key path, say) can never be mistaken for it.
 */
const TAKES_VALUE = new Set(['--from', '--to'])
const options = {}
const positional = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (!arg.startsWith('--')) {
    positional.push(arg)
  } else if (TAKES_VALUE.has(arg)) {
    options[arg] = args[++i]
  } else {
    options[arg] = true
  }
}

const eventCode = positional[0]
const fromKey = options['--from']
const toKey = options['--to']
const dryRun = options['--dry-run'] === true
const overwrite = options['--overwrite'] === true
const withFiles = options['--no-files'] !== true

if (!eventCode || !fromKey || !toKey) {
  console.error(`
Usage:
  cd functions
  node scripts/copy-event.mjs <EVENT_CODE> --from <source-key.json> --to <dest-key.json>

Options:
  --dry-run     report what would happen, change nothing
  --overwrite   replace an event that already exists at the destination
  --no-files    Firestore only (leaves file URLs pointing at the source)
`)
  process.exit(1)
}

const code = eventCode.toUpperCase()

function load(path, name) {
  try {
    return JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? '~'), 'utf8'))
  } catch {
    console.error(`Cannot read the ${name} key at ${path}.`)
    process.exit(1)
  }
}

const fromCreds = load(fromKey, 'source')
const toCreds = load(toKey, 'destination')

if (fromCreds.project_id === toCreds.project_id) {
  console.error('Source and destination are the same project. Nothing to do.')
  process.exit(1)
}

const bucketName = (projectId) => `${projectId}.firebasestorage.app`

const source = initializeApp(
  { credential: cert(fromCreds), storageBucket: bucketName(fromCreds.project_id) },
  'source',
)
const destination = initializeApp(
  { credential: cert(toCreds), storageBucket: bucketName(toCreds.project_id) },
  'destination',
)

const fromDb = getFirestore(source)
const toDb = getFirestore(destination)
const fromBucket = getStorage(source).bucket()
const toBucket = getStorage(destination).bucket()

console.log(`Event:       ${code}`)
console.log(`From:        ${fromCreds.project_id}`)
console.log(`To:          ${toCreds.project_id}`)
console.log(`Files:       ${withFiles ? 'copied' : 'SKIPPED (--no-files)'}`)
console.log(dryRun ? 'Mode:        DRY RUN — nothing will be written\n' : '')

// ---- guards ------------------------------------------------------------
const sourceEvent = await fromDb.collection('events').doc(code).get()
if (!sourceEvent.exists) {
  console.error(`No event "${code}" in ${fromCreds.project_id}.`)
  process.exit(1)
}

const existing = await toDb.collection('events').doc(code).get()
if (existing.exists && !overwrite) {
  console.error(
    `"${code}" already exists in ${toCreds.project_id}.\n` +
      'Pass --overwrite to replace it. Note that overwrite replaces documents by\n' +
      'id and does NOT delete anything the destination has that the source lacks.',
  )
  process.exit(1)
}

// ---- copy the Storage objects -----------------------------------------
/** old storage path -> { path, url } at the destination */
const fileMap = new Map()

if (withFiles) {
  const [objects] = await fromBucket.getFiles({ prefix: `events/${code}/` })
  console.log(`Storage:     ${objects.length} object(s) under events/${code}/`)

  for (const object of objects) {
    const token = randomUUID()

    if (!dryRun) {
      const [buffer] = await object.download()
      const target = toBucket.file(object.name)
      await target.save(buffer, {
        contentType: object.metadata.contentType,
        metadata: {
          cacheControl: object.metadata.cacheControl ?? undefined,
          // This is what makes a public download URL resolvable.
          metadata: { firebaseStorageDownloadTokens: token },
        },
      })
    }

    fileMap.set(object.name, {
      path: object.name,
      url:
        `https://firebasestorage.googleapis.com/v0/b/${toBucket.name}/o/` +
        `${encodeURIComponent(object.name)}?alt=media&token=${token}`,
    })
    console.log(`  ${dryRun ? 'would copy' : 'copied'}  ${object.name}`)
  }
}

/** Point a stored path/url pair at the destination copy, if we have one. */
function remap(data, pathField, urlField) {
  const oldPath = data[pathField]
  if (!oldPath) return data
  const moved = fileMap.get(oldPath)
  if (!moved) return data
  return { ...data, [pathField]: moved.path, [urlField]: moved.url }
}

// ---- copy Firestore ----------------------------------------------------
let written = 0

const eventData = remap(sourceEvent.data(), 'logoPath', 'logoUrl')
if (!dryRun) await toDb.collection('events').doc(code).set(eventData)
written++
console.log(`\nFirestore:   ${dryRun ? 'would write' : 'wrote'} events/${code}`)

for (const name of SUBCOLLECTIONS) {
  const snapshot = await fromDb.collection('events').doc(code).collection(name).get()
  if (snapshot.empty) {
    console.log(`  ${name}: none`)
    continue
  }

  // Batches cap at 500 writes; these collections are far smaller, but chunking
  // costs nothing and removes a cliff nobody would see until race week.
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const chunk = snapshot.docs.slice(i, i + 400)
    const batch = toDb.batch()

    for (const document of chunk) {
      const data =
        name === 'documents'
          ? remap(document.data(), 'filePath', 'fileUrl')
          : document.data()
      batch.set(
        toDb.collection('events').doc(code).collection(name).doc(document.id),
        data,
      )
      written++
    }

    if (!dryRun) await batch.commit()
  }
  console.log(`  ${name}: ${snapshot.size}`)
}

if (dryRun) {
  // Said plainly at the end, not only in the header: the "would copy" lines
  // above read exactly like success, and it is easy to walk away believing the
  // copy happened.
  console.log(
    `\nDRY RUN — NOTHING WAS WRITTEN.\n` +
      `Would have written ${written} document(s) and ${fileMap.size} file(s) ` +
      `to ${toCreds.project_id}.\n\n` +
      `Re-run without --dry-run to do it.`,
  )
} else {
  console.log(
    `\nWrote ${written} document(s) and ${fileMap.size} file(s) to ` +
      `${toCreds.project_id}.`,
  )
}

if (!dryRun) {
  console.log(
    '\nAdmin access does NOT carry across projects. Grant it separately:\n' +
      `  node scripts/grant-admin.mjs <email> --event ${code}   (with the destination key)`,
  )
}
