#!/usr/bin/env node
/*
 * Move filled entry forms for one event from one project to another —
 * for entries filed against the wrong app (staging instead of live).
 *
 *   cd functions
 *   node scripts/copy-entries.mjs UMC2026 \
 *     --from ~/.secrets/racewire-stg-firebase-adminsdk-....json \
 *     --to   ~/.secrets/racewire-live-firebase-adminsdk-....json \
 *     --list
 *
 * `--list` reads both sides and writes nothing. Start there: it prints the
 * entry ids, licences and document ids you need to choose between, and flags
 * the mismatches that would otherwise bite halfway through a copy.
 *
 * Then select what to move and rehearse it:
 *   ... --licence 12345 --licence 12346 --dry-run
 *
 * Then do it, by dropping --dry-run.
 *
 * Selection is mandatory: pass --licence/--entry/--since/--submitted-only, or
 * --all to mean the whole collection. Staging is also where real testing
 * happens, so "copy every entry in staging to production" is a thing you
 * should have to say out loud rather than get by leaving a flag off.
 *
 * Options:
 *   --list              report both sides and exit; writes nothing
 *   --dry-run           report what would happen, change nothing
 *   --all               select every entry (instead of a filter)
 *   --licence <number>  select by licence number (repeatable)
 *   --entry <id>        select by entry id (repeatable)
 *   --since <date>      select entries created at or after an ISO date
 *   --submitted-only    skip drafts
 *   --map-document <stgId=liveId>   the form document has a different id at
 *                       the destination (repeatable)
 *   --create-users      create a destination auth user for a filler who has
 *                       none, so their phone keeps reaching their entry
 *   --overwrite         replace entries that already exist at the destination
 *   --no-files          Firestore only. Note this leaves the copied entries
 *                       with signature and PDF paths that resolve to nothing
 *                       in the destination bucket — an event document at least
 *                       keeps working off the source URL, an entry does not.
 *                       For reading the answers, not for a usable record.
 *   --delete-source     after a verified copy, delete the originals
 *
 * WHAT MAKES THIS DIFFERENT FROM copy-event.mjs
 *
 * An entry is not self-contained the way a notice is. It points at three
 * things that are scoped to the project it was written in, and all three have
 * to be re-pointed or the copy is quietly broken:
 *
 *   uid          The filler's auth uid. Auth is per-project, so a staging uid
 *                names nobody in production. Rules let a filler read their own
 *                entry by `resource.data.uid == request.auth.uid`; carried
 *                over unchanged, the competitor is locked out of their own
 *                form. Admins still see everything, which is exactly why this
 *                goes unnoticed until a competitor calls. So the uid is looked
 *                up afresh at the destination by phone number.
 *
 *   documentId   The library document the form was filled from, and half of
 *                the entry's own id (`{licence}_{documentId}`). If production
 *                got its copy of the form through copy-event.mjs the ids match
 *                and there is nothing to do. If someone created the form on
 *                each side by hand, they do not, and --map-document is how you
 *                say so — it rewrites the field, the entry id, and the Storage
 *                paths that embed the entry id.
 *
 *   Storage      Signatures and the generated PDF live under
 *                events/{code}/entries/{entryId}/ and are read by path through
 *                the SDK, not by public URL — entry files are admin-only, so
 *                unlike event documents there is no download token to mint.
 *                Copying the bytes to the same path is the whole job.
 *
 * Nothing is deleted from the source unless --delete-source is passed, and
 * then only after the copy has been read back and verified.
 */
import { readFileSync } from 'node:fs'

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

// ---- arguments ---------------------------------------------------------
const args = process.argv.slice(2)

/*
 * Walked rather than searched, so a value that happens to look like the event
 * code (a key path, say) can never be mistaken for it.
 */
const TAKES_VALUE = new Set(['--from', '--to', '--since'])
const REPEATABLE = new Set(['--licence', '--entry', '--map-document'])
const options = {}
const lists = { '--licence': [], '--entry': [], '--map-document': [] }
const positional = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (!arg.startsWith('--')) {
    positional.push(arg)
  } else if (REPEATABLE.has(arg)) {
    lists[arg].push(args[++i])
  } else if (TAKES_VALUE.has(arg)) {
    options[arg] = args[++i]
  } else {
    options[arg] = true
  }
}

const eventCode = positional[0]
const fromKey = options['--from']
const toKey = options['--to']
const listOnly = options['--list'] === true
const dryRun = options['--dry-run'] === true
const selectAll = options['--all'] === true
const submittedOnly = options['--submitted-only'] === true
const createUsers = options['--create-users'] === true
const overwrite = options['--overwrite'] === true
const withFiles = options['--no-files'] !== true
const deleteSource = options['--delete-source'] === true
const licences = new Set(lists['--licence'].map((l) => l.toUpperCase()))
const entryIds = new Set(lists['--entry'])

const usage = `
Usage:
  cd functions
  node scripts/copy-entries.mjs <EVENT_CODE> --from <source-key.json> --to <dest-key.json> --list

Start with --list. Then select entries and --dry-run. Then run for real.

  --list              report both sides and exit; writes nothing
  --dry-run           report what would happen, change nothing
  --all               select every entry (instead of a filter)
  --licence <number>  select by licence number (repeatable)
  --entry <id>        select by entry id (repeatable)
  --since <date>      select entries created at or after an ISO date
  --submitted-only    skip drafts
  --map-document <stgId=liveId>   form document has a different id there
  --create-users      create a destination auth user for a filler who has none
  --overwrite         replace entries that already exist at the destination
  --no-files          Firestore only; signature/PDF paths will not resolve
  --delete-source     after a verified copy, delete the originals
`

if (!eventCode || !fromKey || !toKey) {
  console.error(usage)
  process.exit(1)
}

let since = null
if (options['--since']) {
  since = new Date(options['--since'])
  if (Number.isNaN(since.getTime())) {
    console.error(`--since "${options['--since']}" is not a date I can read.`)
    process.exit(1)
  }
}

const hasFilter = licences.size > 0 || entryIds.size > 0 || since || submittedOnly

if (!listOnly && !hasFilter && !selectAll) {
  console.error(
    'Nothing selected.\n\n' +
      'Run with --list first to see what is there, then select entries with\n' +
      '--licence / --entry / --since / --submitted-only, or pass --all to mean\n' +
      'every entry in the event.\n' +
      usage,
  )
  process.exit(1)
}

/** stg document id -> live document id */
const documentMap = new Map()
for (const pair of lists['--map-document']) {
  const [from, to] = (pair ?? '').split('=')
  if (!from || !to) {
    console.error(`--map-document wants <stgId=liveId>, got "${pair}".`)
    process.exit(1)
  }
  documentMap.set(from, to)
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
const toAuth = getAuth(destination)
const fromBucket = getStorage(source).bucket()
const toBucket = getStorage(destination).bucket()

const entriesRef = (db) => db.collection('events').doc(code).collection('entries')

console.log(`Event:       ${code}`)
console.log(`From:        ${fromCreds.project_id}`)
console.log(`To:          ${toCreds.project_id}`)

// ---- guards ------------------------------------------------------------
const sourceEvent = await fromDb.collection('events').doc(code).get()
if (!sourceEvent.exists) {
  console.error(`No event "${code}" in ${fromCreds.project_id}.`)
  process.exit(1)
}

const destEvent = await toDb.collection('events').doc(code).get()
if (!destEvent.exists) {
  console.error(
    `No event "${code}" in ${toCreds.project_id}.\n\n` +
      'Entries hang off an event, and the form they were filled from lives in\n' +
      "that event's documents. Copy the event across first:\n" +
      `  node scripts/copy-event.mjs ${code} --from <src> --to <dst>`,
  )
  process.exit(1)
}

// ---- survey ------------------------------------------------------------
const sourceEntries = await entriesRef(fromDb).get()
const destEntries = await entriesRef(toDb).get()
const destDocuments = await toDb
  .collection('events')
  .doc(code)
  .collection('documents')
  .get()
const destDocumentIds = new Set(destDocuments.docs.map((d) => d.id))
const destLicences = await toDb.collection('events').doc(code).collection('licences').get()
const destLicenceNumbers = new Set(destLicences.docs.map((d) => d.id))

const when = (timestamp) => timestamp?.toDate?.().toISOString().slice(0, 16) ?? '-'

if (listOnly) {
  for (const [label, snapshot] of [
    [fromCreds.project_id, sourceEntries],
    [toCreds.project_id, destEntries],
  ]) {
    console.log(`\n${label} — ${snapshot.size} entr${snapshot.size === 1 ? 'y' : 'ies'}`)
    for (const document of snapshot.docs) {
      const data = document.data()
      console.log(
        `  ${document.id}
      licence ${data.licenceNumber}   status ${data.status}   created ${when(data.createdAt)}   submitted ${when(data.submittedAt)}
      documentId ${data.documentId}   uid ${data.uid}   phone ${data.phone}
      files ${[...Object.values(data.signatures ?? {}), data.pdfPath].filter(Boolean).length}`,
      )
    }
  }

  console.log(`\nForm documents in ${toCreds.project_id}: ${[...destDocumentIds].join(', ') || 'none'}`)

  const unmatched = [
    ...new Set(
      sourceEntries.docs
        .map((d) => d.data().documentId)
        .filter((id) => id && !destDocumentIds.has(id)),
    ),
  ]
  if (unmatched.length) {
    console.log(
      `\nMISMATCH: these documentIds on source entries do not exist at the\n` +
        `destination: ${unmatched.join(', ')}\n` +
        `The form was created separately on each side. Pass --map-document\n` +
        `<thisId=destinationId> for each, or the copied entries will point at a\n` +
        `form that is not there.`,
    )
  } else {
    console.log('\nDocument ids line up. No --map-document needed.')
  }

  const clashes = sourceEntries.docs.filter((d) => destEntries.docs.some((x) => x.id === d.id))
  if (clashes.length) {
    console.log(
      `\nALREADY AT THE DESTINATION: ${clashes.map((d) => d.id).join(', ')}\n` +
        'Copying these needs --overwrite, and overwriting discards whatever the\n' +
        'destination currently holds for them. Check those first.',
    )
  }

  console.log('\n--list wrote nothing. Select entries and re-run with --dry-run.')
  process.exit(0)
}

// ---- selection ---------------------------------------------------------
const selected = sourceEntries.docs.filter((document) => {
  const data = document.data()
  if (submittedOnly && data.status !== 'submitted') return false
  if (since && (data.createdAt?.toDate?.() ?? new Date(0)) < since) return false
  if (licences.size && !licences.has(String(data.licenceNumber).toUpperCase())) return false
  if (entryIds.size && !entryIds.has(document.id)) return false
  return true
})

/*
 * A licence or entry named on the command line that matched nothing is a typo
 * far more often than it is an empty set, and silently copying the other four
 * of five is the kind of partial success nobody checks.
 */
const matchedLicences = new Set(
  selected.map((d) => String(d.data().licenceNumber).toUpperCase()),
)
const missingLicences = [...licences].filter((l) => !matchedLicences.has(l))
const missingEntries = [...entryIds].filter((id) => !selected.some((d) => d.id === id))
if (missingLicences.length || missingEntries.length) {
  console.error(
    `\nNot found in ${fromCreds.project_id}: ` +
      [...missingLicences, ...missingEntries].join(', ') +
      '\nNothing was copied. Run --list to see what is actually there.',
  )
  process.exit(1)
}

if (!selected.length) {
  console.error('\nNo entries matched. Nothing to do.')
  process.exit(1)
}

console.log(`Selected:    ${selected.length} of ${sourceEntries.size} entr(y/ies)`)
console.log(`Files:       ${withFiles ? 'copied' : 'SKIPPED (--no-files)'}`)
if (dryRun) console.log('Mode:        DRY RUN — nothing will be written')

// ---- check the destination can hold them -------------------------------
const problems = []

for (const document of selected) {
  const data = document.data()
  const newDocumentId = documentMap.get(data.documentId) ?? data.documentId
  if (!destDocumentIds.has(newDocumentId)) {
    problems.push(
      `${document.id}: documentId ${newDocumentId} does not exist in ${toCreds.project_id}` +
        (documentMap.has(data.documentId) ? ' (after --map-document)' : ''),
    )
  }
  const newId = `${data.licenceNumber}_${newDocumentId}`
  if (destEntries.docs.some((d) => d.id === newId) && !overwrite) {
    problems.push(`${newId}: already exists at the destination; --overwrite to replace`)
  }
}

if (problems.length) {
  console.error('\nStopping. Nothing was written:\n  ' + problems.join('\n  '))
  console.error('\nRun --list for the full picture on both sides.')
  process.exit(1)
}

for (const document of selected) {
  const number = document.data().licenceNumber
  if (!destLicenceNumbers.has(String(number))) {
    console.warn(
      `  note: licence ${number} is not on the destination's licence list. The` +
        ` entry copies fine and admins will see it; that competitor just cannot` +
        ` pass the entry gate there until the licence is imported.`,
    )
  }
}

// ---- resolve the filler's identity at the destination ------------------
/** source uid -> destination uid */
const uidMap = new Map()
const unlinked = []

for (const document of selected) {
  const { uid, phone } = document.data()
  if (!uid || uidMap.has(uid)) continue

  if (!phone) {
    unlinked.push(`${document.id}: no phone on the entry, so no way to find the filler`)
    continue
  }

  try {
    const user = await toAuth.getUserByPhoneNumber(phone)
    uidMap.set(uid, user.uid)
    console.log(`  ${phone}: ${uid} -> ${user.uid}`)
  } catch (cause) {
    if (cause.code !== 'auth/user-not-found') throw cause

    if (!createUsers) {
      unlinked.push(`${document.id}: no destination user for ${phone}`)
      continue
    }
    if (dryRun) {
      console.log(`  ${phone}: would create a destination user`)
      continue
    }
    /*
     * Phone sign-in attaches to an existing record with that number, so
     * creating it now means the uid this copy writes is the uid they get when
     * they next pass OTP — rather than a fresh one that cannot see the entry.
     */
    const user = await toAuth.createUser({ phoneNumber: phone })
    uidMap.set(uid, user.uid)
    console.log(`  ${phone}: created ${user.uid}`)
  }
}

if (unlinked.length) {
  console.warn(
    `\nFillers with no account at the destination:\n  ` +
      unlinked.join('\n  ') +
      `\n\nTheir entries still copy, and organisers see them in the admin panel\n` +
      `with the PDF intact. What breaks is only the competitor reopening their\n` +
      `own form in the live app: rules match on uid, and theirs names a staging\n` +
      `account. Pass --create-users to make the accounts now so their phone\n` +
      `reaches the entry, or leave it if the entries are finished with.`,
  )
}

// ---- copy the Storage objects -----------------------------------------
/** source object path -> destination object path */
const fileMap = new Map()
let filesCopied = 0

if (withFiles) {
  for (const document of selected) {
    const data = document.data()
    const newDocumentId = documentMap.get(data.documentId) ?? data.documentId
    const newId = `${data.licenceNumber}_${newDocumentId}`

    const [objects] = await fromBucket.getFiles({
      prefix: `events/${code}/entries/${document.id}/`,
    })

    for (const object of objects) {
      // Only the entry id segment moves; whatever the file is called is kept.
      const target = object.name.replace(
        `events/${code}/entries/${document.id}/`,
        `events/${code}/entries/${newId}/`,
      )

      if (!dryRun) {
        const [buffer] = await object.download()
        await toBucket.file(target).save(buffer, {
          contentType: object.metadata.contentType,
          metadata: { cacheControl: object.metadata.cacheControl ?? undefined },
        })
      }

      fileMap.set(object.name, target)
      filesCopied++
      console.log(`  ${dryRun ? 'would copy' : 'copied'}  ${target}`)
    }
  }
  console.log(`Storage:     ${filesCopied} object(s)`)
}

/*
 * Entry files are admin-only and fetched by path through the SDK, so there is
 * no download token to mint here — unlike event documents, whose public URLs
 * copy-event.mjs has to rebuild.
 */
function movedPath(path) {
  if (!path) return path
  if (!withFiles) return path
  return fileMap.get(path) ?? path
}

// ---- copy Firestore ----------------------------------------------------
const copied = []
let written = 0

for (let i = 0; i < selected.length; i += 400) {
  const chunk = selected.slice(i, i + 400)
  const batch = toDb.batch()

  for (const document of chunk) {
    const data = document.data()
    const newDocumentId = documentMap.get(data.documentId) ?? data.documentId
    const newId = `${data.licenceNumber}_${newDocumentId}`

    const signatures = Object.fromEntries(
      Object.entries(data.signatures ?? {}).map(([party, path]) => [party, movedPath(path)]),
    )

    batch.set(entriesRef(toDb).doc(newId), {
      ...data,
      documentId: newDocumentId,
      uid: uidMap.get(data.uid) ?? data.uid,
      signatures,
      pdfPath: movedPath(data.pdfPath) ?? null,
    })

    copied.push({ sourceId: document.id, newId })
    written++
  }

  if (!dryRun) await batch.commit()
}

console.log(`\nFirestore:   ${dryRun ? 'would write' : 'wrote'} ${written} entr(y/ies)`)
for (const { sourceId, newId } of copied) {
  console.log(`  ${sourceId}${sourceId === newId ? '' : `  ->  ${newId}`}`)
}

if (dryRun) {
  // Said plainly at the end, not only in the header: the "would copy" lines
  // above read exactly like success, and it is easy to walk away believing the
  // copy happened.
  console.log(
    `\nDRY RUN — NOTHING WAS WRITTEN.\n` +
      `Would have written ${written} entr(y/ies) and ${filesCopied} file(s) to ` +
      `${toCreds.project_id}.\n\nRe-run without --dry-run to do it.`,
  )
  process.exit(0)
}

// ---- verify, then optionally clear the source --------------------------
/*
 * Read back rather than trust the batch. --delete-source is irreversible and
 * the only thing standing between a bad copy and lost entries, so it is gated
 * on the destination actually holding each document.
 */
const verified = []
for (const { sourceId, newId } of copied) {
  const snapshot = await entriesRef(toDb).doc(newId).get()
  if (snapshot.exists) verified.push({ sourceId, newId })
  else console.error(`  VERIFY FAILED: ${newId} is not readable at the destination`)
}

console.log(`\nWrote ${written} entr(y/ies) and ${filesCopied} file(s) to ${toCreds.project_id}.`)
console.log(`Verified ${verified.length} of ${written} at the destination.`)

if (deleteSource) {
  if (verified.length !== written) {
    console.error(
      '\nNOT deleting anything from the source: some entries did not verify.\n' +
        'The copies that did land are still there; fix the rest and re-run.',
    )
    process.exit(1)
  }

  for (const { sourceId } of verified) {
    if (withFiles) {
      const [objects] = await fromBucket.getFiles({
        prefix: `events/${code}/entries/${sourceId}/`,
      })
      // Files before the document, matching the admin panel's delete order: a
      // record with missing files is recoverable, orphaned signatures with
      // nothing pointing at them are not.
      for (const object of objects) await object.delete()
    }
    await entriesRef(fromDb).doc(sourceId).delete()
    console.log(`  deleted from source: ${sourceId}`)
  }
  console.log(`\nRemoved ${verified.length} entr(y/ies) from ${fromCreds.project_id}.`)
} else {
  console.log(
    `\nThe originals are still in ${fromCreds.project_id}. Check the live admin\n` +
      `panel — the entries listed, the PDFs opening — then re-run the same\n` +
      `command with --delete-source to clear them, or leave them as they are.`,
  )
}
