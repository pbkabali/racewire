import { GoogleAuth } from 'google-auth-library'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

/*
 * Google Sheets -> Firestore, one way.
 *
 * Organisers keep editing the spreadsheet they already use; Firestore stays the
 * single source the app reads, so offline caching and realtime listeners keep
 * working. Nothing in the app talks to Sheets directly.
 *
 * Setup: share the sheet (Viewer is enough) with the function's service account,
 *   <project-id>@appspot.gserviceaccount.com
 * and enable the Sheets API on the project.
 */

/*
 * Configured through the environment, not firebase-functions params.
 *
 * A defineString() param with no value makes the CLI PROMPT for one at deploy
 * time. That is merely annoying locally and fatal in CI, which deploys with
 * --non-interactive: the prompt becomes an error and takes the whole atomic
 * deploy down with it, hosting and rules included.
 *
 * Set these in `functions/.env` (or `.env.<project-id>` for one project only);
 * firebase-tools loads those files and ships them as runtime env vars. CI
 * writes that file from the SHEET_ID / SHEET_RANGE repo variables.
 *
 * Unset simply means the sync is skipped -- see syncRacesFromSheet below.
 */
const sheetId = () => process.env.SHEET_ID ?? ''
const sheetRange = () => process.env.SHEET_RANGE || 'Races!A1:E'

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})

type RaceRow = {
  id: string
  name: string
  category: string
  startsAt: Timestamp | null
  status: 'scheduled' | 'running' | 'finished' | 'cancelled'
}

const VALID_STATUSES = new Set(['scheduled', 'running', 'finished', 'cancelled'])

/** Pull the sheet and mirror it into the `races` collection. Returns rows written. */
export async function syncRacesFromSheet(): Promise<number> {
  const id = sheetId()
  if (!id) {
    logger.warn('syncRacesFromSheet skipped: SHEET_ID is not set')
    return 0
  }

  const client = await auth.getClient()
  const token = await client.getAccessToken()

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/` +
    `${encodeURIComponent(sheetRange())}?valueRenderOption=UNFORMATTED_VALUE`

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token.token}` },
  })

  if (!response.ok) {
    throw new Error(`Sheets API ${response.status}: ${await response.text()}`)
  }

  const { values } = (await response.json()) as { values?: unknown[][] }
  if (!values || values.length < 2) {
    logger.info('sheet has no data rows')
    return 0
  }

  const [header, ...rows] = values as [string[], ...unknown[][]]
  const columns = header.map((h) => String(h).trim().toLowerCase())
  const races = rows.map((row) => toRace(columns, row)).filter((r): r is RaceRow => r !== null)

  const db = getFirestore()
  const batch = db.batch()
  for (const race of races) {
    // merge:true so hand-corrections made in the admin UI to fields the sheet
    // does not own are not wiped on the next sync.
    batch.set(db.collection('races').doc(race.id), race, { merge: true })
  }
  await batch.commit()

  logger.info('synced races from sheet', { rows: races.length, skipped: rows.length - races.length })
  return races.length
}

function toRace(columns: string[], row: unknown[]): RaceRow | null {
  const cell = (name: string): string => {
    const index = columns.indexOf(name)
    if (index === -1) return ''
    return row[index] === undefined || row[index] === null ? '' : String(row[index]).trim()
  }

  const id = cell('id')
  const name = cell('name')
  // A row without an id or name is almost always a spacer or a stray note.
  if (!id || !name) return null

  const status = cell('status').toLowerCase()

  return {
    id,
    name,
    category: cell('category'),
    startsAt: parseStartsAt(cell('startsat') || cell('start') || cell('time')),
    status: (VALID_STATUSES.has(status) ? status : 'scheduled') as RaceRow['status'],
  }
}

/**
 * Sheets returns unformatted dates as a serial number: days since 1899-12-30.
 * Anything else is handed to Date, and an unparseable value becomes null rather
 * than an Invalid Date that would poison the ordering on the schedule screen.
 */
function parseStartsAt(raw: string): Timestamp | null {
  if (!raw) return null

  const serial = Number(raw)
  if (Number.isFinite(serial) && serial > 0) {
    const epoch = Date.UTC(1899, 11, 30)
    return Timestamp.fromMillis(epoch + serial * 86_400_000)
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : Timestamp.fromDate(parsed)
}
