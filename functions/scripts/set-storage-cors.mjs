#!/usr/bin/env node
/*
 * Apply a CORS policy to the project's Storage bucket.
 *
 * Why this is needed: a Firebase Storage download URL serves the file happily
 * to a browser navigation or an <img>, but returns NO Access-Control-Allow-Origin
 * header by default. Anything that reads the bytes with fetch() is therefore
 * blocked cross-origin:
 *
 *   - pdf.js renders from an ArrayBuffer  -> "Failed to fetch"
 *   - downloadAttachment() fetches a blob -> same
 *
 * A new bucket has no CORS configuration at all, so this bites the first time
 * anyone opens a PDF and not before.
 *
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/<project>-<deployer>.json \
 *     node scripts/set-storage-cors.mjs
 *
 * Needs storage.buckets.update — the github-deployer key has it via Firebase
 * Admin; the Admin SDK key does not.
 */
import { readFileSync } from 'node:fs'

import { GoogleAuth } from 'google-auth-library'

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!keyPath) {
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
      'Point it at the github-deployer key for the project you mean to change.',
  )
  process.exit(1)
}

let projectId
try {
  projectId = JSON.parse(readFileSync(keyPath.replace(/^~/, process.env.HOME ?? '~'), 'utf8'))
    .project_id
} catch {
  console.error(`Cannot read or parse the key file at ${keyPath}.`)
  process.exit(1)
}

const bucket = process.env.STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`

/*
 * origin "*" is deliberate.
 *
 * These objects are already world-readable — the Storage rules allow public
 * read so a spectator can download a bulletin without signing in, and anyone
 * can curl the URL today. CORS does not gate that; it only decides whether
 * JavaScript may read a response it could already fetch by other means. So "*"
 * grants no access that does not already exist.
 *
 * Listing specific origins would also break Hosting preview channels, whose
 * URLs are generated per pull request and cannot be enumerated in advance.
 *
 * Methods stay read-only: uploads go through the Firebase SDK, which handles
 * its own CORS, and there is no reason to permit cross-origin writes here.
 */
const cors = [
  {
    origin: ['*'],
    method: ['GET', 'HEAD'],
    responseHeader: ['Content-Type', 'Content-Length', 'Content-Disposition', 'Content-Range'],
    maxAgeSeconds: 3600,
  },
]

console.log(`Project:  ${projectId}`)
console.log(`Bucket:   ${bucket}\n`)

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/devstorage.full_control'],
})

const client = await auth.getClient()

try {
  const response = await client.request({
    url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=cors`,
    method: 'PATCH',
    data: { cors },
  })

  console.log('CORS applied:')
  console.log(JSON.stringify(response.data, null, 2))
  console.log('\nVerify with:')
  console.log(`  curl -sI -H "Origin: https://example.com" "<a file download URL>" | grep -i access-control`)
} catch (error) {
  const status = error?.response?.status
  const detail = error?.response?.data?.error?.message ?? error.message

  if (status === 403) {
    console.error(
      `Permission denied setting CORS on ${bucket}.\n` +
        'The key needs storage.buckets.update — use the github-deployer key\n' +
        '(Firebase Admin role), not the Admin SDK key.',
    )
  } else if (status === 404) {
    console.error(
      `No bucket named ${bucket}.\n` +
        'Check the name in the Firebase console under Storage, and pass it as\n' +
        'STORAGE_BUCKET=... if it differs from <project-id>.firebasestorage.app.',
    )
  } else {
    console.error(detail)
  }
  process.exit(1)
}
