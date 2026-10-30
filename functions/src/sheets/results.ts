import { GoogleAuth } from 'google-auth-library'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'

/*
 * Read-only, and the same auth the race sync uses.
 *
 * Setup per project: share the spreadsheet (Viewer is enough) with the
 * functions' service account, then nothing else is needed -- no API key, no
 * publishing the sheet to the web, and the sheet stays private to everybody
 * who has not been given it.
 */
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})

/** One row of the sheet, exactly as the sheet has it. */
export type ResultsTable = {
  header: string[]
  rows: string[][]
}

/**
 * Mirror a range, rather than parse it into a results model.
 *
 * What the columns mean is the organiser's business: a rally sheet carries
 * position, number, crew, car, times and penalties in whatever order and
 * wording that event uses, and it changes between events and sometimes
 * between legs. Reading it as a table means the app is never wrong about a
 * schema it was never told, and a column added mid-rally appears instead of
 * being silently dropped.
 *
 * Blank trailing rows are cut: a sheet almost always has formatting below the
 * last real entry, and those arrive as empty arrays.
 */
export async function fetchResultsTable(
  sheetId: string,
  range: string,
): Promise<ResultsTable | null> {
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
    `${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token.token}` },
  })

  if (!response.ok) {
    const body = await response.text()

    /*
     * Name the account that was refused.
     *
     * A 403 here almost always means the sheet was shared with the wrong
     * address -- the Admin SDK key is the obvious guess and is not what
     * functions run as. Google's message does not say which identity was
     * turned away, so the organiser is left guessing between two plausible
     * service accounts while a rally is running. Asking the credentials who
     * they are turns that into a copy-paste.
     */
    if (response.status === 403 || response.status === 404) {
      const who = await auth
        .getCredentials()
        .then((c) => c.client_email ?? '')
        .catch(() => '')

      /*
       * A disabled API and an unshared sheet both arrive as 403, and the
       * advice for them is completely different. Leading with "share the
       * sheet" when the API is switched off sends the organiser to the
       * sharing dialog, where everything already looks correct.
       */
      const disabled = body.includes('SERVICE_DISABLED')

      throw new Error(
        `Sheets API ${response.status}. ` +
          (disabled
            ? 'Enable the Google Sheets API on this project, then retry. '
            : (who ? `Share the sheet with ${who} (Viewer). ` : '') +
              'Check the spreadsheet id and that the tab in the range exists. ') +
          body,
      )
    }

    throw new Error(`Sheets API ${response.status}: ${body}`)
  }

  const { values } = (await response.json()) as { values?: unknown[][] }
  if (!values?.length) return null

  /*
   * FORMATTED_VALUE, not UNFORMATTED. Times are the whole point here, and a
   * rally sheet holds them as durations the API would otherwise hand back as
   * fractions of a day -- 0.000416 instead of 00:36.0. The sheet already
   * knows how it wants them shown.
   */
  const table = values.map((row) => row.map((cell) => (cell == null ? '' : String(cell).trim())))

  const [header = [], ...body] = table
  const width = Math.max(header.length, ...body.map((r) => r.length), 0)

  const padded = body
    .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
    // A row with nothing in it is spacing, not a competitor.
    .filter((row) => row.some((cell) => cell !== ''))

  return {
    header: Array.from({ length: width }, (_, i) => header[i] ?? ''),
    rows: padded,
  }
}

/**
 * Refresh one event's live results from its sheet.
 *
 * Written to a single document rather than a row per competitor: the table
 * changes as a whole every time it is recomputed, one document means one read
 * for the app and one write here, and a classification arriving half-updated
 * would be worse than one arriving a minute late.
 */
export async function syncEventResults(eventId: string): Promise<number> {
  const db = getFirestore()
  const snapshot = await db.collection('events').doc(eventId).get()
  const event = snapshot.data()

  const sheetId = String(event?.resultsSheetId ?? '').trim()
  const range = String(event?.resultsSheetRange ?? '').trim()
  if (!sheetId || !range) return 0

  const table = await fetchResultsTable(sheetId, range)

  await db
    .collection('events')
    .doc(eventId)
    .collection('liveResults')
    .doc('current')
    .set({
      header: table?.header ?? [],
      rows: table?.rows ?? [],
      fetchedAt: FieldValue.serverTimestamp(),
      // Kept so a wrong-looking table can be traced to the range it came from
      // without guessing which tab somebody pointed it at.
      sourceRange: range,
    })

  const count = table?.rows.length ?? 0
  logger.info('live results synced', { eventId, rows: count, range })
  return count
}

/**
 * Every event that has a results sheet configured.
 *
 * Returns how many were synced, so the caller can tell a rally weekend from
 * an ordinary Tuesday and not burn a minute of function time waiting around
 * when there is nothing to wait for.
 */
export async function syncAllEventResults(): Promise<number> {
  const events = await getFirestore().collection('events').get()
  let synced = 0

  for (const event of events.docs) {
    const data = event.data()
    if (!String(data.resultsSheetId ?? '').trim()) continue

    try {
      await syncEventResults(event.id)
      synced++
    } catch (cause) {
      /*
       * One event's sheet failing must not stop the others. A revoked share,
       * a renamed tab or a deleted spreadsheet is a per-event fault, and on a
       * rally weekend two events can be running at once.
       */
      logger.error('live results sync failed', {
        eventId: event.id,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return synced
}
